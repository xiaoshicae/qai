use tauri::{AppHandle, Emitter, State};

use crate::db::init::{DbState, HttpClient};
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
    let requests_with_assertions = {
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

        // 读取活跃环境变量
        let var_map = if let Ok(Some(env)) = crate::db::environment::get_active(&conn) {
            crate::http::vars::build_var_map(&env.variables)
        } else {
            std::collections::HashMap::new()
        };

        let mut result = Vec::new();
        for req in filtered {
            let assertions = crate::db::assertion::list_by_request(&conn, &req.id)
                .map_err(|e| e.to_string())?;
            let req = crate::http::vars::apply_vars(&req, &var_map);
            result.push((req, assertions));
        }
        result
    };

    if requests_with_assertions.is_empty() {
        return Err("没有可执行的请求".to_string());
    }

    let app_clone = app.clone();
    let batch_result = batch::run_batch(
        &http.0,
        requests_with_assertions,
        concurrency.unwrap_or(5),
        move |progress| {
            let _ = app_clone.emit("test-progress", &progress);
        },
    )
    .await;

    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        for result in &batch_result.results {
            let exec = crate::models::execution::Execution {
                id: result.execution_id.clone(),
                request_id: result.request_id.clone(),
                batch_id: Some(batch_result.batch_id.clone()),
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
                executed_at: chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            };
            let _ = crate::db::execution::save(&conn, &exec);
        }
    }

    Ok(batch_result)
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
