use tauri::{AppHandle, Emitter, State};

use crate::db::init::{DbState, HttpClient};
use crate::models::execution::ExecutionResult;
use crate::models::request::ApiRequest;
use crate::runner::assertion::evaluate_assertions;

#[tauri::command]
pub fn create_request(
    db: State<'_, DbState>,
    collection_id: String,
    folder_id: Option<String>,
    name: String,
    method: String,
) -> Result<ApiRequest, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::request::create(&conn, &collection_id, folder_id.as_deref(), &name, &method)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_request(db: State<'_, DbState>, id: String) -> Result<ApiRequest, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::request::get(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_request(
    db: State<'_, DbState>,
    id: String,
    name: Option<String>,
    method: Option<String>,
    url: Option<String>,
    headers: Option<String>,
    query_params: Option<String>,
    body_type: Option<String>,
    body_content: Option<String>,
    extract_rules: Option<String>,
    description: Option<String>,
    expect_status: Option<u16>,
) -> Result<ApiRequest, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::request::update(
        &conn,
        &id,
        name.as_deref(),
        method.as_deref(),
        url.as_deref(),
        headers.as_deref(),
        query_params.as_deref(),
        body_type.as_deref(),
        body_content.as_deref(),
        extract_rules.as_deref(),
        description.as_deref(),
        expect_status,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_request(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::request::delete(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_request_stream(
    app: AppHandle,
    db: State<'_, DbState>,
    http: State<'_, HttpClient>,
    id: String,
) -> Result<ExecutionResult, String> {
    let (req, assertions) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let raw_req = crate::db::request::get(&conn, &id).map_err(|e| e.to_string())?;
        let assertions = crate::db::assertion::list_by_request(&conn, &id).map_err(|e| e.to_string())?;

        let req = if let Ok(Some(env)) = crate::db::environment::get_active(&conn) {
            let var_map = crate::http::vars::build_var_map(&env.variables);
            crate::http::vars::apply_vars(&raw_req, &var_map)
        } else {
            raw_req
        };
        (req, assertions)
    };

    let app_clone = app.clone();
    let mut result = crate::http::stream::execute_stream(&http.0, &req, move |chunk| {
        let _ = app_clone.emit("stream-chunk", &chunk);
    }).await.map_err(|e| e.to_string())?;

    if let Some(ref response) = result.response {
        if !assertions.is_empty() {
            result.assertion_results = evaluate_assertions(&assertions, response);
            if result.assertion_results.iter().any(|a| !a.passed) {
                result.status = "failed".to_string();
            }
        }
    }

    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let execution = crate::http::client::to_execution(&req, &result);
        crate::db::execution::save(&conn, &execution).map_err(|e| e.to_string())?;
    }

    Ok(result)
}

#[tauri::command]
pub async fn send_request(
    db: State<'_, DbState>,
    http: State<'_, HttpClient>,
    id: String,
) -> Result<ExecutionResult, String> {
    let (req, assertions) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let raw_req = crate::db::request::get(&conn, &id).map_err(|e| e.to_string())?;
        let assertions = crate::db::assertion::list_by_request(&conn, &id).map_err(|e| e.to_string())?;

        // 读取活跃环境变量并替换 {{KEY}}
        let req = if let Ok(Some(env)) = crate::db::environment::get_active(&conn) {
            let var_map = crate::http::vars::build_var_map(&env.variables);
            crate::http::vars::apply_vars(&raw_req, &var_map)
        } else {
            raw_req
        };
        (req, assertions)
    };

    let mut result = crate::http::client::execute(&http.0, &req).await.map_err(|e| e.to_string())?;

    // 执行断言
    if let Some(ref response) = result.response {
        if !assertions.is_empty() {
            result.assertion_results = evaluate_assertions(&assertions, response);
            // 如果有断言失败，更新状态
            if result.assertion_results.iter().any(|a| !a.passed) {
                result.status = "failed".to_string();
            }
        }
    }

    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let execution = crate::http::client::to_execution(&req, &result);
        crate::db::execution::save(&conn, &execution).map_err(|e| e.to_string())?;
    }

    Ok(result)
}
