use tauri::{AppHandle, Emitter, State};

use crate::db::init::{DbState, HttpClient};
use crate::models::execution::ChainResult;
use crate::runner::batch::{self, BatchResult};

#[tauri::command]
pub async fn run_collection(
    app: AppHandle,
    db: State<'_, DbState>,
    http: State<'_, HttpClient>,
    collection_id: String,
    folder_id: Option<String>,
    concurrency: Option<usize>,
) -> Result<BatchResult, String> {
    // 分离：chain folder 内的请求用链式执行，其余并行
    let (normal_requests, chain_groups, var_map) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;

        let all_requests = crate::db::request::list_by_collection(&conn, &collection_id)
            .map_err(|e| e.to_string())?;

        let filtered: Vec<_> = all_requests
            .into_iter()
            .filter(|r| {
                if let Some(ref fid) = folder_id {
                    r.folder_id.as_deref() == Some(fid.as_str())
                } else {
                    true
                }
            })
            .filter(|r| !r.url.is_empty())
            .collect();

        let var_map = if let Ok(Some(env)) = crate::db::environment::get_active(&conn) {
            crate::http::vars::build_var_map(&env.variables)
        } else {
            std::collections::HashMap::new()
        };

        // 找出所有 chain folder
        let folders = {
            let mut stmt = conn.prepare(
                "SELECT id, collection_id, parent_folder_id, name, sort_order, created_at, updated_at, is_chain FROM folders WHERE collection_id = ?1 AND is_chain = 1"
            ).map_err(|e| e.to_string())?;
            let rows = stmt.query_map(rusqlite::params![collection_id], |row| {
                Ok(row.get::<_, String>(0)?)
            }).map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<String>, _>>().map_err(|e| e.to_string())?
        };
        let chain_folder_ids: std::collections::HashSet<String> = folders.into_iter().collect();

        let mut normal = Vec::new();
        // chain folder id -> Vec<(req, assertions)> 按 sort_order 排序（已排好）
        let mut chains: std::collections::HashMap<String, Vec<_>> = std::collections::HashMap::new();

        for req in filtered {
            let assertions = crate::db::assertion::list_by_request(&conn, &req.id)
                .map_err(|e| e.to_string())?;
            if let Some(ref fid) = req.folder_id {
                if chain_folder_ids.contains(fid) {
                    chains.entry(fid.clone()).or_default().push((req, assertions));
                    continue;
                }
            }
            let req = crate::http::vars::apply_vars(&req, &var_map);
            normal.push((req, assertions));
        }

        (normal, chains, var_map)
    };

    if normal_requests.is_empty() && chain_groups.is_empty() {
        return Err("没有可执行的请求".to_string());
    }

    let batch_id = uuid::Uuid::new_v4().to_string();
    let mut all_results: Vec<crate::models::execution::ExecutionResult> = Vec::new();
    let start = std::time::Instant::now();

    // 1. 先执行所有 chain groups（顺序执行每条链）
    for (_folder_id, steps) in &chain_groups {
        let chain_result = crate::runner::chain::run_chain(
            &http.0,
            steps.clone(),
            var_map.clone(),
            _folder_id.clone(),
            String::new(),
            |_| {},
        ).await;

        for step in chain_result.steps {
            // 发送进度事件
            let progress = batch::TestProgress {
                batch_id: batch_id.clone(),
                request_id: step.execution_result.request_id.clone(),
                request_name: step.execution_result.request_name.clone(),
                status: step.execution_result.status.clone(),
                current: all_results.len() as u32 + 1,
                total: (normal_requests.len() + chain_groups.values().map(|v| v.len()).sum::<usize>()) as u32,
            };
            let _ = app.emit("test-progress", &progress);
            all_results.push(step.execution_result);
        }
    }

    // 2. 并行执行普通请求
    if !normal_requests.is_empty() {
        let chain_done = all_results.len() as u32;
        let total = chain_done + normal_requests.len() as u32;
        let app_clone = app.clone();
        let batch_id_clone = batch_id.clone();
        let normal_result = batch::run_batch(
            &http.0,
            normal_requests,
            concurrency.unwrap_or(5),
            move |mut progress| {
                progress.batch_id = batch_id_clone.clone();
                progress.current += chain_done;
                progress.total = total;
                let _ = app_clone.emit("test-progress", &progress);
            },
        ).await;
        all_results.extend(normal_result.results);
    }

    let total_time = start.elapsed().as_millis() as u64;
    let passed = all_results.iter().filter(|r| r.status == "success").count() as u32;
    let failed = all_results.iter().filter(|r| r.status == "failed").count() as u32;
    let errors = all_results.iter().filter(|r| r.status == "error").count() as u32;

    let batch_result = BatchResult {
        batch_id: batch_id.clone(),
        total: all_results.len() as u32,
        passed,
        failed,
        errors,
        total_time_ms: total_time,
        results: all_results,
    };

    // 保存执行记录
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        for result in &batch_result.results {
            let exec = crate::models::execution::Execution {
                id: result.execution_id.clone(),
                request_id: result.request_id.clone(),
                batch_id: Some(batch_id.clone()),
                status: result.status.clone(),
                request_url: String::new(),
                request_method: String::new(),
                request_headers: "{}".to_string(),
                request_body: None,
                response_status: result.response.as_ref().map(|r| r.status),
                response_headers: result.response.as_ref().map(|r| serde_json::to_string(&r.headers).unwrap_or_default()).unwrap_or_else(|| "{}".to_string()),
                response_body: result.response.as_ref().map(|r| r.body.clone()),
                response_time_ms: result.response.as_ref().map(|r| r.time_ms).unwrap_or(0),
                response_size: result.response.as_ref().map(|r| r.size_bytes).unwrap_or(0),
                assertion_results: serde_json::to_string(&result.assertion_results).unwrap_or_default(),
                error_message: result.error_message.clone(),
                executed_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            };
            let _ = crate::db::execution::save(&conn, &exec);
        }
    }

    Ok(batch_result)
}

#[tauri::command]
pub async fn run_chain(
    app: AppHandle,
    db: State<'_, DbState>,
    http: State<'_, HttpClient>,
    folder_id: String,
) -> Result<ChainResult, String> {
    let (steps, base_vars, folder_name) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;

        let folder = crate::db::collection::get_folder(&conn, &folder_id)
            .map_err(|e| e.to_string())?;
        if !folder.is_chain {
            return Err("该文件夹不是请求链".to_string());
        }

        let requests = crate::db::request::list_by_folder(&conn, &folder_id)
            .map_err(|e| e.to_string())?;

        let var_map = if let Ok(Some(env)) = crate::db::environment::get_active(&conn) {
            crate::http::vars::build_var_map(&env.variables)
        } else {
            std::collections::HashMap::new()
        };

        let mut steps = Vec::new();
        for req in requests {
            let assertions = crate::db::assertion::list_by_request(&conn, &req.id)
                .map_err(|e| e.to_string())?;
            steps.push((req, assertions));
        }

        (steps, var_map, folder.name)
    };

    if steps.is_empty() {
        return Err("请求链中没有请求".to_string());
    }

    let app_clone = app.clone();
    let chain_result = crate::runner::chain::run_chain(
        &http.0,
        steps,
        base_vars,
        folder_id,
        folder_name,
        move |progress| {
            let _ = app_clone.emit("chain-progress", &progress);
        },
    )
    .await;

    // 保存每步执行记录
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        for step in &chain_result.steps {
            let result = &step.execution_result;
            let exec = crate::models::execution::Execution {
                id: result.execution_id.clone(),
                request_id: result.request_id.clone(),
                batch_id: Some(chain_result.chain_id.clone()),
                status: result.status.clone(),
                request_url: String::new(),
                request_method: String::new(),
                request_headers: "{}".to_string(),
                request_body: None,
                response_status: result.response.as_ref().map(|r| r.status),
                response_headers: result.response.as_ref().map(|r| serde_json::to_string(&r.headers).unwrap_or_default()).unwrap_or_else(|| "{}".to_string()),
                response_body: result.response.as_ref().map(|r| r.body.clone()),
                response_time_ms: result.response.as_ref().map(|r| r.time_ms).unwrap_or(0),
                response_size: result.response.as_ref().map(|r| r.size_bytes).unwrap_or(0),
                assertion_results: serde_json::to_string(&result.assertion_results).unwrap_or_default(),
                error_message: result.error_message.clone(),
                executed_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            };
            let _ = crate::db::execution::save(&conn, &exec);
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
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::execution::list_recent(&conn, limit.unwrap_or(50)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_request_runs(
    db: State<'_, DbState>,
    request_id: String,
    limit: Option<u32>,
) -> Result<Vec<crate::db::execution::RunRecord>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::execution::list_by_request(&conn, &request_id, limit.unwrap_or(20)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_collection_status(
    db: State<'_, DbState>,
    collection_id: String,
) -> Result<Vec<crate::db::execution::RequestLastStatus>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::execution::get_last_status_for_collection(&conn, &collection_id).map_err(|e| e.to_string())
}
