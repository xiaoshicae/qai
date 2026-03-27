use tauri::{AppHandle, Emitter, State};

use crate::db::init::{DbState, HttpClient};
use crate::models::execution::ExecutionResult;
use crate::models::item::CollectionItem;
use crate::runner::assertion::evaluate_assertions;

#[tauri::command]
pub fn create_item(
    db: State<'_, DbState>,
    collection_id: String,
    parent_id: Option<String>,
    item_type: Option<String>,
    name: String,
    method: Option<String>,
) -> Result<CollectionItem, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let itype = item_type.as_deref().unwrap_or("request");
    let m = method.as_deref().unwrap_or("GET");
    crate::db::item::create(&conn, &collection_id, parent_id.as_deref(), itype, &name, m)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_item(db: State<'_, DbState>, id: String) -> Result<CollectionItem, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::item::get(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_item(
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
    parent_id: Option<Option<String>>,
) -> Result<CollectionItem, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let pid = parent_id.map(|outer| outer.as_deref().map(|s| s.to_string()));
    let pid_ref = pid.as_ref().map(|o| o.as_deref());
    crate::db::item::update(
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
        pid_ref,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_item(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::item::delete(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_request_stream(
    app: AppHandle,
    db: State<'_, DbState>,
    http: State<'_, HttpClient>,
    id: String,
) -> Result<ExecutionResult, String> {
    let (item, assertions) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let raw_item = crate::db::item::get(&conn, &id).map_err(|e| e.to_string())?;
        let assertions = crate::db::assertion::list_by_item(&conn, &id).map_err(|e| e.to_string())?;

        let item = if let Ok(Some(env)) = crate::db::environment::get_active(&conn) {
            let var_map = crate::http::vars::build_var_map(&env.variables);
            crate::http::vars::apply_vars(&raw_item, &var_map)
        } else {
            raw_item
        };
        (item, assertions)
    };

    let app_clone = app.clone();
    let mut result = crate::http::stream::execute_stream(&http.0, &item, move |chunk| {
        let _ = app_clone.emit("stream-chunk", &chunk);
    }).await.map_err(|e| e.to_string())?;

    if let Some(ref response) = result.response {
        if !assertions.is_empty() {
            result.assertion_results = evaluate_assertions(&assertions, response);
            if result.assertion_results.iter().any(|a| !a.passed) {
                result.status = "failed".to_string();
            } else {
                result.status = "success".to_string();
            }
        }
    }

    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let execution = crate::http::client::to_execution(&item, &result);
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
    let (item, assertions) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let raw_item = crate::db::item::get(&conn, &id).map_err(|e| e.to_string())?;
        let assertions = crate::db::assertion::list_by_item(&conn, &id).map_err(|e| e.to_string())?;

        // 读取活跃环境变量并替换 {{KEY}}
        let item = if let Ok(Some(env)) = crate::db::environment::get_active(&conn) {
            let var_map = crate::http::vars::build_var_map(&env.variables);
            crate::http::vars::apply_vars(&raw_item, &var_map)
        } else {
            raw_item
        };
        (item, assertions)
    };

    let mut result = crate::http::client::execute(&http.0, &item).await.map_err(|e| e.to_string())?;

    // 执行断言
    if let Some(ref response) = result.response {
        if !assertions.is_empty() {
            result.assertion_results = evaluate_assertions(&assertions, response);
            if result.assertion_results.iter().any(|a| !a.passed) {
                result.status = "failed".to_string();
            } else {
                result.status = "success".to_string();
            }
        }
    }

    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let execution = crate::http::client::to_execution(&item, &result);
        crate::db::execution::save(&conn, &execution).map_err(|e| e.to_string())?;
    }

    Ok(result)
}
