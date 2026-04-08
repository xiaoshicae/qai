use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Semaphore;

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

#[allow(clippy::too_many_arguments)]
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

/// 执行单元：保持表格顺序，chain 和普通请求统一编排
#[allow(clippy::large_enum_variant)]
enum ExecUnit {
    Single(
        crate::models::item::CollectionItem,
        Vec<crate::models::assertion::Assertion>,
    ),
    Chain {
        chain_id: String,
        name: String,
        steps: Vec<(
            crate::models::item::CollectionItem,
            Vec<crate::models::assertion::Assertion>,
        )>,
    },
}

impl ExecUnit {
    /// 该执行单元包含的请求数（chain 计子步骤数）
    fn request_count(&self) -> u32 {
        match self {
            ExecUnit::Single(..) => 1,
            ExecUnit::Chain { steps, .. } => steps.len() as u32,
        }
    }
}

#[allow(clippy::too_many_arguments)]
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

    // ── 1. 按表格顺序构建有序执行单元列表 ──
    let (ordered, var_map) = {
        let conn = db.conn()?;

        let mut all_items = if let Some(ref pid) = parent_id {
            crate::db::item::list_by_parent(&conn, pid).map_err(|e| e.to_string())?
        } else {
            crate::db::item::list_by_collection(&conn, collection_id).map_err(|e| e.to_string())?
        };
        if !excluded.is_empty() {
            all_items.retain(|item| {
                !excluded.contains(&item.id)
                    && !item
                        .parent_id
                        .as_ref()
                        .is_some_and(|pid| excluded.contains(pid))
            });
        }

        let var_map = crate::db::environment::get_active_var_map(&conn);

        // 识别 chain 容器
        let chain_item_ids: std::collections::HashSet<String> = all_items
            .iter()
            .filter(|i| i.item_type == crate::models::ItemType::Chain.as_str())
            .map(|i| i.id.clone())
            .collect();

        // 收集所有 request items 用于批量加载断言
        let mut all_request_items: Vec<&crate::models::item::CollectionItem> = all_items
            .iter()
            .filter(|i| i.item_type == crate::models::ItemType::Request.as_str())
            .collect();

        // chain 子项可能不在 all_items 中（嵌套加载）
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

        // 批量查询断言（消除 N+1）
        let request_ids: Vec<String> = all_request_items.iter().map(|i| i.id.clone()).collect();
        let mut assertions_map =
            crate::db::assertion::list_by_items(&conn, &request_ids).map_err(|e| e.to_string())?;

        // 先构建 chain → steps 映射
        let mut chain_steps: std::collections::HashMap<
            String,
            Vec<(
                crate::models::item::CollectionItem,
                Vec<crate::models::assertion::Assertion>,
            )>,
        > = std::collections::HashMap::new();

        for item in &all_items {
            if item.item_type != crate::models::ItemType::Request.as_str() || item.url.is_empty() {
                continue;
            }
            if let Some(ref pid) = item.parent_id {
                if chain_item_ids.contains(pid) {
                    let assertions = assertions_map.remove(&item.id).unwrap_or_default();
                    chain_steps
                        .entry(pid.clone())
                        .or_default()
                        .push((item.clone(), assertions));
                }
            }
        }
        for child in &extra_children {
            if child.item_type == crate::models::ItemType::Request.as_str() && !child.url.is_empty()
            {
                let assertions = assertions_map.remove(&child.id).unwrap_or_default();
                if let Some(ref pid) = child.parent_id {
                    chain_steps
                        .entry(pid.clone())
                        .or_default()
                        .push((child.clone(), assertions));
                }
            }
        }

        // 按 sort_order 遍历 all_items，构建有序执行单元
        let mut units: Vec<ExecUnit> = Vec::new();
        for item in &all_items {
            if item.item_type == crate::models::ItemType::Chain.as_str() {
                if let Some(steps) = chain_steps.remove(&item.id) {
                    if !steps.is_empty() {
                        units.push(ExecUnit::Chain {
                            chain_id: item.id.clone(),
                            name: item.name.clone(),
                            steps,
                        });
                    }
                }
            } else if item.item_type == crate::models::ItemType::Request.as_str() {
                // 跳过 chain 子请求和空 URL
                if item
                    .parent_id
                    .as_ref()
                    .is_some_and(|pid| chain_item_ids.contains(pid))
                {
                    continue;
                }
                if item.url.is_empty() {
                    continue;
                }
                let assertions = assertions_map.remove(&item.id).unwrap_or_default();
                let item = crate::http::vars::apply_vars(item, &var_map);
                units.push(ExecUnit::Single(item, assertions));
            }
        }

        (units, var_map)
    };

    let overall_total: u32 = ordered.iter().map(|u| u.request_count()).sum();

    log::info!(
        "[run_collection] units={}, total_requests={}",
        ordered.len(),
        overall_total
    );
    for unit in &ordered {
        if let ExecUnit::Chain {
            chain_id,
            name,
            steps,
        } = unit
        {
            log::info!(
                "[run_collection] chain '{}' ({}) has {} steps",
                name,
                chain_id,
                steps.len()
            );
        }
    }

    if overall_total == 0 {
        return Err("没有可执行的请求".to_string());
    }

    // ── 2. 按序入队、并发执行 ──
    let batch_id = uuid::Uuid::new_v4().to_string();
    let start = std::time::Instant::now();
    let concurrency = concurrency.unwrap_or(crate::DEFAULT_CONCURRENCY);
    let semaphore = Arc::new(Semaphore::new(concurrency));
    let completed = Arc::new(AtomicU32::new(0));

    let mut handles: Vec<tokio::task::JoinHandle<Vec<crate::models::execution::ExecutionResult>>> =
        Vec::new();

    for unit in ordered {
        if cancel_token.load(Ordering::Relaxed) {
            break;
        }

        // 按序获取 permit —— 确保从上往下依次启动
        let permit = semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| e.to_string())?;

        match unit {
            ExecUnit::Single(item, assertions) => {
                let client = http.0.clone();
                let ct = cancel_token.clone();
                let app_c = app.clone();
                let bid = batch_id.clone();
                let done_counter = completed.clone();

                handles.push(tokio::spawn(async move {
                    if ct.load(Ordering::Relaxed) {
                        drop(permit);
                        return vec![];
                    }

                    let _ = app_c.emit(
                        "test-progress",
                        &batch::TestProgress {
                            batch_id: bid.clone(),
                            item_id: item.id.clone(),
                            item_name: item.name.clone(),
                            status: crate::models::Status::Running.as_str().to_string(),
                            current: done_counter.load(Ordering::Relaxed) + 1,
                            total: overall_total,
                        },
                    );

                    let exec_future = if dry_run {
                        Ok(crate::http::client::mock_execute(&item).await)
                    } else if item.protocol == "websocket" {
                        crate::websocket::client::execute(&item).await
                    } else {
                        crate::http::client::execute(&client, &item).await
                    };
                    let mut result = match exec_future {
                        Ok(r) => r,
                        Err(e) => crate::models::execution::ExecutionResult {
                            execution_id: uuid::Uuid::new_v4().to_string(),
                            item_id: item.id.clone(),
                            item_name: item.name.clone(),
                            request_url: item.url.clone(),
                            request_method: item.method.clone(),
                            status: crate::models::Status::Error.as_str().to_string(),
                            response: None,
                            assertion_results: vec![],
                            error_message: Some(e.to_string()),
                        },
                    };

                    crate::runner::assertion::apply_assertions(&mut result, &assertions);
                    let _ = app_c.emit("execution-result", &result);

                    let done = done_counter.fetch_add(1, Ordering::Relaxed) + 1;
                    let _ = app_c.emit(
                        "test-progress",
                        &batch::TestProgress {
                            batch_id: bid,
                            item_id: item.id.clone(),
                            item_name: item.name.clone(),
                            status: result.status.clone(),
                            current: done,
                            total: overall_total,
                        },
                    );

                    drop(permit);
                    vec![result]
                }));
            }

            ExecUnit::Chain {
                chain_id,
                name,
                steps,
            } => {
                let client = http.0.clone();
                let ct = cancel_token.clone();
                let app_c = app.clone();
                let bid = batch_id.clone();
                let done_counter = completed.clone();
                let vm = var_map.clone();

                let step_ids: Vec<String> = steps.iter().map(|(item, _)| item.id.clone()).collect();
                let step_names: Vec<String> =
                    steps.iter().map(|(item, _)| item.name.clone()).collect();

                handles.push(tokio::spawn(async move {
                    if ct.load(Ordering::Relaxed) {
                        drop(permit);
                        return vec![];
                    }

                    let app_progress = app_c.clone();
                    let bid_p = bid.clone();
                    let ids_cb = step_ids.clone();
                    let names_cb = step_names.clone();
                    let done_cb = done_counter.clone();

                    let app_result_cb = app_c.clone();

                    let chain_result = crate::runner::chain::run_chain(
                        &client,
                        steps,
                        vm,
                        chain_id,
                        name,
                        Some(ct),
                        move |progress| {
                            let sid = ids_cb
                                .get(progress.step_index as usize)
                                .cloned()
                                .unwrap_or_default();
                            let sname = names_cb
                                .get(progress.step_index as usize)
                                .cloned()
                                .unwrap_or(progress.step_name.clone());
                            let _ = app_progress.emit(
                                "test-progress",
                                &batch::TestProgress {
                                    batch_id: bid_p.clone(),
                                    item_id: sid,
                                    item_name: sname,
                                    status: progress.status.clone(),
                                    current: done_cb.load(Ordering::Relaxed)
                                        + progress.step_index
                                        + 1,
                                    total: overall_total,
                                },
                            );
                        },
                        Some(Box::new(move |result| {
                            let _ = app_result_cb.emit("execution-result", result);
                        })),
                        dry_run,
                    )
                    .await;

                    let mut results = Vec::new();
                    for step in chain_result.steps {
                        done_counter.fetch_add(1, Ordering::Relaxed);
                        results.push(step.execution_result);
                    }

                    drop(permit);
                    results
                }));
            }
        }
    }

    // ── 3. 收集结果 ──
    let mut all_results = Vec::new();
    for handle in handles {
        if let Ok(results) = handle.await {
            all_results.extend(results);
        }
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
            crate::http::emit_request_log(app, result);
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
