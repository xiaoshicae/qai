use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Semaphore;

use crate::db::init::{DbState, HttpClient};
use crate::errors::AppError;
use crate::models::execution::ChainResult;
use crate::runner::batch::{self, BatchResult};
use crate::runner::orchestrator::{self, ExecUnit};

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
pub async fn cancel_run(runner: State<'_, RunnerState>) -> Result<(), AppError> {
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
) -> Result<BatchResult, AppError> {
    let dry_run = dry_run.unwrap_or(false);
    let cancel_token = runner.start_run();
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
) -> Result<BatchResult, AppError> {
    let excluded: std::collections::HashSet<String> =
        exclude_ids.unwrap_or_default().into_iter().collect();

    // ── 1. 通过 orchestrator 构建有序执行单元 ──
    let (ordered, var_map) = {
        let conn = db.conn()?;
        orchestrator::build_exec_units(&conn, collection_id, parent_id.as_deref(), &excluded)?
    };

    let overall_total: u32 = ordered.iter().map(|u| u.request_count()).sum();

    log::info!(
        "[run_collection] units={}, total_requests={}",
        ordered.len(),
        overall_total
    );

    if overall_total == 0 {
        return Err("没有可执行的请求".into());
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

        let permit = semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| AppError::Generic(e.to_string()))?;

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
        match handle.await {
            Ok(results) => all_results.extend(results),
            Err(e) => log::warn!("任务执行异常: {e}"),
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

    // 保存执行记录（dry-run 跳过）
    if !dry_run {
        let conn = db.conn()?;
        for result in &batch_result.results {
            crate::http::emit_request_log(app, result);
        }
        orchestrator::save_results(&conn, &batch_result.results, &batch_id)?;
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
) -> Result<ChainResult, AppError> {
    let dry_run = dry_run.unwrap_or(false);
    let (steps, base_vars, item_name) = {
        let conn = db.conn()?;
        let chain_item = crate::db::item::get(&conn, &item_id)?;
        if chain_item.item_type != crate::models::ItemType::Chain.as_str() {
            return Err("该节点不是请求链".into());
        }
        orchestrator::build_chain_steps(&conn, &item_id)?
    };

    if steps.is_empty() {
        return Err("请求链中没有请求".into());
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

    // 保存执行记录（dry-run 跳过）
    if !dry_run {
        let conn = db.conn()?;
        let results: Vec<_> = chain_result
            .steps
            .iter()
            .map(|s| &s.execution_result)
            .collect();
        for result in &results {
            crate::http::emit_request_log(&app, result);
        }
        // save_results 需要 slice，收集引用转为 owned
        let owned: Vec<_> = results.into_iter().cloned().collect();
        orchestrator::save_results(&conn, &owned, &chain_result.chain_id)?;
    }

    Ok(chain_result)
}

#[tauri::command]
pub fn export_report_html(batch_result: BatchResult) -> Result<String, AppError> {
    Ok(crate::report::html::generate_html_report(&batch_result))
}

#[tauri::command]
pub fn list_history(
    db: State<'_, DbState>,
    limit: Option<u32>,
) -> Result<Vec<crate::db::execution::HistoryEntry>, AppError> {
    let conn = db.conn()?;
    Ok(crate::db::execution::list_recent(
        &conn,
        limit.unwrap_or(crate::DEFAULT_HISTORY_LIMIT),
    )?)
}

#[tauri::command]
pub fn list_history_filtered(
    db: State<'_, DbState>,
    status: Option<String>,
    method: Option<String>,
    keyword: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<crate::db::execution::HistoryEntry>, AppError> {
    let conn = db.conn()?;
    Ok(crate::db::execution::list_filtered(
        &conn,
        status.as_deref(),
        method.as_deref(),
        keyword.as_deref(),
        limit.unwrap_or(crate::DEFAULT_HISTORY_LIMIT),
        offset.unwrap_or(0),
    )?)
}

#[tauri::command]
pub fn history_stats(
    db: State<'_, DbState>,
) -> Result<crate::db::execution::HistoryStats, AppError> {
    let conn = db.conn()?;
    Ok(crate::db::execution::get_stats(&conn)?)
}

#[tauri::command]
pub fn delete_history(db: State<'_, DbState>, id: String) -> Result<(), AppError> {
    let conn = db.conn()?;
    Ok(crate::db::execution::delete_one(&conn, &id)?)
}

#[tauri::command]
pub fn clear_history(db: State<'_, DbState>) -> Result<u64, AppError> {
    let conn = db.conn()?;
    Ok(crate::db::execution::clear_all(&conn)?)
}

#[tauri::command]
pub fn list_item_runs(
    db: State<'_, DbState>,
    item_id: String,
    limit: Option<u32>,
) -> Result<Vec<crate::db::execution::RunRecord>, AppError> {
    let conn = db.conn()?;
    Ok(crate::db::execution::list_by_item(
        &conn,
        &item_id,
        limit.unwrap_or(crate::DEFAULT_ITEM_RUNS_LIMIT),
    )?)
}

#[tauri::command]
pub fn get_collection_status(
    db: State<'_, DbState>,
    collection_id: String,
) -> Result<Vec<crate::db::execution::ItemLastStatus>, AppError> {
    let conn = db.conn()?;
    Ok(crate::db::execution::get_last_status_for_collection(
        &conn,
        &collection_id,
    )?)
}
