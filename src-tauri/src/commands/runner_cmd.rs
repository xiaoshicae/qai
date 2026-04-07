use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

use crate::db::init::{DbState, HttpClient};
use crate::models::execution::ChainResult;
use crate::runner::batch::{self, BatchResult};

/// 运行器状态，管理每次运行的取消令牌
/// 每次运行使用独立的取消令牌，避免多个运行互相干扰
pub struct RunnerState {
    /// 当前运行的取消令牌（None 表示无运行中的任务）
    current_cancel: Mutex<Option<Arc<AtomicBool>>>,
}

impl RunnerState {
    pub fn new() -> Self {
        Self {
            current_cancel: Mutex::new(None),
        }
    }

    fn lock_inner(&self) -> std::sync::MutexGuard<'_, Option<Arc<AtomicBool>>> {
        self.current_cancel
            .lock()
            .unwrap_or_else(|e| e.into_inner())
    }

    /// 开始新运行，返回取消令牌
    /// 会取消之前的运行（如果存在）
    fn start_run(&self) -> Arc<AtomicBool> {
        let token = Arc::new(AtomicBool::new(false));
        let mut guard = self.lock_inner();
        // 如果有正在运行的任务，先取消它
        if let Some(old_token) = guard.take() {
            old_token.store(true, Ordering::Release);
        }
        *guard = Some(token.clone());
        token
    }

    /// 取消当前运行
    fn cancel_current(&self) {
        if let Some(token) = self.lock_inner().take() {
            token.store(true, Ordering::Release);
        }
    }

    /// 运行结束，清除令牌
    fn end_run(&self) {
        *self.lock_inner() = None;
    }
}

#[tauri::command]
pub async fn cancel_run(runner: State<'_, RunnerState>) -> Result<(), String> {
    runner.cancel_current();
    Ok(())
}

#[tauri::command]
pub async fn run_collection(
    app: AppHandle,
    db: State<'_, DbState>,
    http: State<'_, HttpClient>,
    runner: State<'_, RunnerState>,
    collection_id: String,
    parent_id: Option<String>,
    concurrency: Option<usize>,
    exclude_ids: Option<Vec<String>>,
    dry_run: Option<bool>,
) -> Result<BatchResult, String> {
    let dry_run = dry_run.unwrap_or(false);
    // 获取本次运行的取消令牌（会取消之前正在运行的任务）
    let cancel_token = runner.start_run();
    // 使用 inner 函数确保 end_run() 在所有退出路径都被调用
    let result = run_collection_inner(
        &app,
        &db,
        &http,
        cancel_token,
        &collection_id,
        parent_id,
        concurrency,
        exclude_ids,
        dry_run,
    )
    .await;
    runner.end_run();
    result
}

async fn run_collection_inner(
    app: &AppHandle,
    db: &DbState,
    http: &HttpClient,
    cancel_token: Arc<AtomicBool>,
    collection_id: &str,
    parent_id: Option<String>,
    concurrency: Option<usize>,
    exclude_ids: Option<Vec<String>>,
    dry_run: bool,
) -> Result<BatchResult, String> {
    let excluded: std::collections::HashSet<String> =
        exclude_ids.unwrap_or_default().into_iter().collect();
    // 分离：chain 类型 item 内的子请求用链式执行，其余并行
    let (normal_items, chain_groups, chain_names, var_map) = {
        let conn = db.conn()?;

        // 获取所有 items，排除禁用项（含 chain 容器及其子项）
        let mut all_items = if let Some(ref pid) = parent_id {
            crate::db::item::list_by_parent(&conn, pid).map_err(|e| e.to_string())?
        } else {
            crate::db::item::list_by_collection(&conn, collection_id).map_err(|e| e.to_string())?
        };
        if !excluded.is_empty() {
            // 排除被禁用的顶层 item（chain 容器或独立 request），以及其子项
            all_items.retain(|item| {
                !excluded.contains(&item.id)
                    && !item
                        .parent_id
                        .as_ref()
                        .is_some_and(|pid| excluded.contains(pid))
            });
        }

        let var_map = crate::db::environment::get_active_var_map(&conn);

        // 区分 chain 容器和普通 request，同时记录 chain 名称
        let mut chain_names: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        let chain_item_ids: std::collections::HashSet<String> = all_items
            .iter()
            .filter(|i| i.item_type == crate::models::ItemType::Chain.as_str())
            .map(|i| {
                chain_names.insert(i.id.clone(), i.name.clone());
                i.id.clone()
            })
            .collect();

        // 收集所有 request items（含 chain 子请求），以及 chain 的嵌套子项
        let mut all_request_items: Vec<&crate::models::item::CollectionItem> = all_items
            .iter()
            .filter(|i| i.item_type == crate::models::ItemType::Request.as_str())
            .collect();

        // chain 下可能有嵌套子 items 不在 all_items 中
        let mut extra_children = Vec::new();
        for chain_id in &chain_item_ids {
            let has_child = all_items
                .iter()
                .any(|i| i.parent_id.as_deref() == Some(chain_id));
            if !has_child {
                let children =
                    crate::db::item::list_by_parent(&conn, chain_id).map_err(|e| e.to_string())?;
                extra_children.extend(children);
            }
        }
        all_request_items.extend(
            extra_children
                .iter()
                .filter(|i| i.item_type == crate::models::ItemType::Request.as_str()),
        );

        // 批量查询所有 assertions（消除 N+1）
        let request_ids: Vec<String> = all_request_items.iter().map(|i| i.id.clone()).collect();
        let mut assertions_map =
            crate::db::assertion::list_by_items(&conn, &request_ids).map_err(|e| e.to_string())?;

        let mut normal = Vec::new();
        let mut chains: std::collections::HashMap<String, Vec<_>> =
            std::collections::HashMap::new();

        // 分配 items 到 normal 或 chains
        for item in &all_items {
            if item.item_type == crate::models::ItemType::Request.as_str() {
                let assertions = assertions_map.remove(&item.id).unwrap_or_default();
                if item.url.is_empty() {
                    continue;
                }
                if let Some(ref pid) = item.parent_id {
                    if chain_item_ids.contains(pid) {
                        chains
                            .entry(pid.clone())
                            .or_default()
                            .push((item.clone(), assertions));
                        continue;
                    }
                }
                let item = crate::http::vars::apply_vars(item, &var_map);
                normal.push((item, assertions));
            }
        }

        // 处理嵌套的 chain 子请求
        for child in &extra_children {
            if child.item_type == crate::models::ItemType::Request.as_str() && !child.url.is_empty()
            {
                let assertions = assertions_map.remove(&child.id).unwrap_or_default();
                if let Some(ref pid) = child.parent_id {
                    chains
                        .entry(pid.clone())
                        .or_default()
                        .push((child.clone(), assertions));
                }
            }
        }

        (normal, chains, chain_names, var_map)
    };

    log::info!(
        "[run_collection] chain_groups={}, normal_items={}",
        chain_groups.len(),
        normal_items.len()
    );
    for (cid, steps) in &chain_groups {
        let name = chain_names.get(cid).cloned().unwrap_or_default();
        log::info!(
            "[run_collection] chain '{}' ({}) has {} steps",
            name,
            cid,
            steps.len()
        );
    }

    if normal_items.is_empty() && chain_groups.is_empty() {
        return Err("没有可执行的请求".to_string());
    }

    let batch_id = uuid::Uuid::new_v4().to_string();
    let mut all_results: Vec<crate::models::execution::ExecutionResult> = Vec::new();
    let start = std::time::Instant::now();

    // 1. 先执行所有 chain groups（顺序执行每条链）
    let overall_total =
        (normal_items.len() + chain_groups.values().map(|v| v.len()).sum::<usize>()) as u32;
    for (chain_item_id, steps) in &chain_groups {
        if cancel_token.load(Ordering::Relaxed) {
            break;
        }
        let name = chain_names.get(chain_item_id).cloned().unwrap_or_default();
        let step_ids: Vec<String> = steps.iter().map(|(item, _)| item.id.clone()).collect();
        let step_names: Vec<String> = steps.iter().map(|(item, _)| item.name.clone()).collect();
        let app_chain = app.clone();
        let batch_id_chain = batch_id.clone();
        let chain_offset = all_results.len() as u32;
        let cancel_chain = cancel_token.clone();
        let app_result_chain = app.clone();
        let chain_result = crate::runner::chain::run_chain(
            &http.0,
            steps.clone(),
            var_map.clone(),
            chain_item_id.clone(),
            name,
            Some(cancel_chain),
            move |progress| {
                let step_item_id = step_ids
                    .get(progress.step_index as usize)
                    .cloned()
                    .unwrap_or_default();
                let step_name = step_names
                    .get(progress.step_index as usize)
                    .cloned()
                    .unwrap_or(progress.step_name.clone());
                let _ = app_chain.emit(
                    "test-progress",
                    &batch::TestProgress {
                        batch_id: batch_id_chain.clone(),
                        item_id: step_item_id,
                        item_name: step_name,
                        status: progress.status.clone(),
                        current: chain_offset + progress.step_index + 1,
                        total: overall_total,
                    },
                );
            },
            Some(Box::new(move |result| {
                let _ = app_result_chain.emit("execution-result", result);
            })),
            dry_run,
        )
        .await;

        let chain_failed = chain_result.status != crate::models::Status::Success.as_str();
        for step in chain_result.steps {
            all_results.push(step.execution_result);
        }
        if chain_failed {
            break;
        }
    }

    // 2. 并行执行普通请求（链全部成功且未取消时才执行）
    let any_chain_failed = all_results
        .iter()
        .any(|r| r.status != crate::models::Status::Success.as_str());
    let was_cancelled = cancel_token.load(Ordering::Relaxed);
    if !normal_items.is_empty() && !any_chain_failed && !was_cancelled {
        let chain_done = all_results.len() as u32;
        let total = chain_done + normal_items.len() as u32;
        let app_clone = app.clone();
        let app_result_batch = app.clone();
        let batch_id_clone = batch_id.clone();
        let normal_result = batch::run_batch(
            &http.0,
            normal_items,
            concurrency.unwrap_or(crate::DEFAULT_CONCURRENCY),
            cancel_token.clone(),
            move |mut progress| {
                progress.batch_id = batch_id_clone.clone();
                progress.current += chain_done;
                progress.total = total;
                let _ = app_clone.emit("test-progress", &progress);
            },
            move |result| {
                let _ = app_result_batch.emit("execution-result", result);
            },
            dry_run,
        )
        .await;
        all_results.extend(normal_result.results);
    }

    let total_time = start.elapsed().as_millis() as u64;
    let passed = all_results
        .iter()
        .filter(|r| r.status == crate::models::Status::Success.as_str())
        .count() as u32;
    let failed = all_results
        .iter()
        .filter(|r| r.status == crate::models::Status::Failed.as_str())
        .count() as u32;
    let errors = all_results
        .iter()
        .filter(|r| r.status == crate::models::Status::Error.as_str())
        .count() as u32;

    let batch_result = BatchResult {
        batch_id: batch_id.clone(),
        total: all_results.len() as u32,
        passed,
        failed,
        errors,
        total_time_ms: total_time,
        results: all_results,
    };

    // 发射请求日志 + 保存执行记录（dry-run 跳过持久化）
    if !dry_run {
        let conn = db.conn()?;
        for result in &batch_result.results {
            crate::http::emit_request_log(&app, result);
            if let Ok(item) = crate::db::item::get(&conn, &result.item_id) {
                let mut exec = crate::http::client::to_execution(&item, result);
                exec.batch_id = Some(batch_id.clone());
                if let Err(e) = crate::db::execution::save(&conn, &exec) {
                    log::warn!("保存执行记录失败 [{}]: {e}", result.item_id);
                }
            }
        }
    }

    Ok(batch_result)
}

#[tauri::command]
pub async fn run_chain(
    app: AppHandle,
    db: State<'_, DbState>,
    http: State<'_, HttpClient>,
    item_id: String,
    dry_run: Option<bool>,
) -> Result<ChainResult, String> {
    let dry_run = dry_run.unwrap_or(false);
    let (steps, base_vars, item_name) = {
        let conn = db.conn()?;

        let chain_item = crate::db::item::get(&conn, &item_id).map_err(|e| e.to_string())?;
        if chain_item.item_type != crate::models::ItemType::Chain.as_str() {
            return Err("该节点不是请求链".to_string());
        }

        let children =
            crate::db::item::list_by_parent(&conn, &item_id).map_err(|e| e.to_string())?;

        let var_map = crate::db::environment::get_active_var_map(&conn);

        let request_children: Vec<_> = children
            .iter()
            .filter(|c| c.item_type == crate::models::ItemType::Request.as_str())
            .collect();
        let child_ids: Vec<String> = request_children.iter().map(|c| c.id.clone()).collect();
        let mut assertions_map =
            crate::db::assertion::list_by_items(&conn, &child_ids).map_err(|e| e.to_string())?;
        let steps: Vec<_> = request_children
            .into_iter()
            .map(|child| {
                let assertions = assertions_map.remove(&child.id).unwrap_or_default();
                (child.clone(), assertions)
            })
            .collect();

        (steps, var_map, chain_item.name)
    };

    if steps.is_empty() {
        return Err("请求链中没有请求".to_string());
    }

    let app_clone = app.clone();
    let app_result = app.clone();
    let chain_result = crate::runner::chain::run_chain(
        &http.0,
        steps,
        base_vars,
        item_id,
        item_name,
        None,
        move |progress| {
            let _ = app_clone.emit("chain-progress", &progress);
        },
        Some(Box::new(move |result| {
            let _ = app_result.emit("execution-result", result);
        })),
        dry_run,
    )
    .await;

    // 发射请求日志 + 保存每步执行记录（dry-run 跳过持久化）
    if !dry_run {
        let conn = db.conn()?;
        for step in &chain_result.steps {
            let result = &step.execution_result;
            crate::http::emit_request_log(&app, result);
            if let Ok(item) = crate::db::item::get(&conn, &result.item_id) {
                let mut exec = crate::http::client::to_execution(&item, result);
                exec.batch_id = Some(chain_result.chain_id.clone());
                if let Err(e) = crate::db::execution::save(&conn, &exec) {
                    log::warn!("保存执行记录失败 [{}]: {e}", result.item_id);
                }
            }
        }
    }

    Ok(chain_result)
}

#[tauri::command]
pub fn export_report_html(batch_result: BatchResult) -> Result<String, String> {
    Ok(crate::report::html::generate_html_report(&batch_result))
}

#[tauri::command]
pub fn list_history(
    db: State<'_, DbState>,
    limit: Option<u32>,
) -> Result<Vec<crate::db::execution::HistoryEntry>, String> {
    let conn = db.conn()?;
    crate::db::execution::list_recent(&conn, limit.unwrap_or(crate::DEFAULT_HISTORY_LIMIT))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_history_filtered(
    db: State<'_, DbState>,
    status: Option<String>,
    method: Option<String>,
    keyword: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<crate::db::execution::HistoryEntry>, String> {
    let conn = db.conn()?;
    crate::db::execution::list_filtered(
        &conn,
        status.as_deref(),
        method.as_deref(),
        keyword.as_deref(),
        limit.unwrap_or(crate::DEFAULT_HISTORY_LIMIT),
        offset.unwrap_or(0),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn history_stats(db: State<'_, DbState>) -> Result<crate::db::execution::HistoryStats, String> {
    let conn = db.conn()?;
    crate::db::execution::get_stats(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_history(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.conn()?;
    crate::db::execution::delete_one(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_history(db: State<'_, DbState>) -> Result<u64, String> {
    let conn = db.conn()?;
    crate::db::execution::clear_all(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_item_runs(
    db: State<'_, DbState>,
    item_id: String,
    limit: Option<u32>,
) -> Result<Vec<crate::db::execution::RunRecord>, String> {
    let conn = db.conn()?;
    crate::db::execution::list_by_item(
        &conn,
        &item_id,
        limit.unwrap_or(crate::DEFAULT_ITEM_RUNS_LIMIT),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_collection_status(
    db: State<'_, DbState>,
    collection_id: String,
) -> Result<Vec<crate::db::execution::ItemLastStatus>, String> {
    let conn = db.conn()?;
    crate::db::execution::get_last_status_for_collection(&conn, &collection_id)
        .map_err(|e| e.to_string())
}
