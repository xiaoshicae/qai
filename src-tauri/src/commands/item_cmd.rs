use tauri::{AppHandle, Emitter, State};

use crate::db::init::{DbState, HttpClient};
use crate::models::assertion::Assertion;
use crate::models::execution::ExecutionResult;
use crate::models::item::CollectionItem;
use crate::runner::assertion::apply_assertions;

/// 从 DB 加载 item + assertions，并应用环境变量替换
fn prepare_request(db: &DbState, id: &str) -> Result<(CollectionItem, Vec<Assertion>), String> {
    let conn = db.conn()?;
    let raw_item = crate::db::item::get(&conn, id).map_err(|e| e.to_string())?;
    let assertions = crate::db::assertion::list_by_item(&conn, id).map_err(|e| e.to_string())?;
    let var_map = crate::db::environment::get_active_var_map(&conn);
    let item = crate::http::vars::apply_vars(&raw_item, &var_map);
    Ok((item, assertions))
}

/// 执行断言 + 保存执行记录
fn finalize_result(
    db: &DbState,
    item: &CollectionItem,
    result: &mut ExecutionResult,
    assertions: &[Assertion],
) -> Result<(), String> {
    apply_assertions(result, assertions);
    let conn = db.conn()?;
    let execution = crate::http::client::to_execution(item, result);
    crate::db::execution::save(&conn, &execution).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn create_item(
    db: State<'_, DbState>,
    collection_id: String,
    parent_id: Option<String>,
    item_type: Option<String>,
    name: String,
    method: Option<String>,
) -> Result<CollectionItem, String> {
    let conn = db.conn()?;
    let itype = item_type.as_deref().unwrap_or("request");
    let m = method.as_deref().unwrap_or("GET");
    crate::db::item::create(&conn, &collection_id, parent_id.as_deref(), itype, &name, m)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_item(db: State<'_, DbState>, id: String) -> Result<CollectionItem, String> {
    let conn = db.conn()?;
    crate::db::item::get(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_item(
    db: State<'_, DbState>,
    id: String,
    payload: crate::models::item::UpdateItemPayload,
) -> Result<CollectionItem, String> {
    let conn = db.conn()?;
    // expect_status 同步由断言编辑器的 update_assertion 反向驱动，
    // 此处仅在显式传入且与当前值不同时才同步，避免覆盖用户在断言编辑器中的修改
    if let Some(es) = payload.expect_status {
        let current = crate::db::item::get(&conn, &id)
            .map(|item| item.expect_status)
            .unwrap_or(0);
        if es != current {
            crate::db::assertion::sync_status_code_assertion(&conn, &id, es)
                .map_err(|e| e.to_string())?;
        }
    }
    crate::db::item::update(&conn, &id, &payload).map_err(|e| e.to_string())
}

#[derive(serde::Deserialize)]
pub struct ItemOrder {
    pub id: String,
    pub sort_order: i32,
}

#[tauri::command]
pub fn reorder_items(db: State<'_, DbState>, items: Vec<ItemOrder>) -> Result<(), String> {
    let mut conn = db.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for item in &items {
        tx.execute(
            "UPDATE collection_items SET sort_order = ?1 WHERE id = ?2",
            rusqlite::params![item.sort_order, item.id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn duplicate_item(db: State<'_, DbState>, id: String) -> Result<CollectionItem, String> {
    let mut conn = db.conn()?;
    crate::db::item::duplicate(&mut conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_item(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.conn()?;
    crate::db::item::delete(&conn, &id).map_err(|e| e.to_string())
}

/// 保留旧命令名以兼容前端，但内部统一用 execute_smart
#[tauri::command]
pub async fn send_request_stream(
    app: AppHandle,
    db: State<'_, DbState>,
    http: State<'_, HttpClient>,
    id: String,
    dry_run: Option<bool>,
) -> Result<ExecutionResult, String> {
    send_request(app, db, http, id, dry_run).await
}

/// 智能发送：自动检测流式响应，通过 event 逐块推送
#[tauri::command]
pub async fn send_request(
    app: AppHandle,
    db: State<'_, DbState>,
    http: State<'_, HttpClient>,
    id: String,
    dry_run: Option<bool>,
) -> Result<ExecutionResult, String> {
    let dry_run = dry_run.unwrap_or(false);
    let (item, assertions) = prepare_request(&db, &id)?;

    let mut result = if dry_run {
        crate::http::client::mock_execute(&item).await
    } else if item.protocol == "websocket" {
        crate::websocket::client::execute(&item)
            .await
            .map_err(|e| e.to_string())?
    } else {
        let app_clone = app.clone();
        crate::http::client::execute_smart(
            &http.0,
            &item,
            Some(Box::new(move |chunk| {
                let _ = app_clone.emit("stream-chunk", &chunk);
            })),
        )
        .await
        .map_err(|e| e.to_string())?
    };

    if dry_run {
        apply_assertions(&mut result, &assertions);
    } else {
        finalize_result(&db, &item, &mut result, &assertions)?;
        crate::http::emit_request_log_with_item(&app, &result, &item);
    }
    Ok(result)
}

/// 快速调试：智能执行，自动检测流式
#[tauri::command]
pub async fn quick_test(
    app: AppHandle,
    db: State<'_, DbState>,
    http: State<'_, HttpClient>,
    payload: crate::models::item::QuickTestPayload,
) -> Result<ExecutionResult, String> {
    let mut item = payload.to_temp_item();

    {
        let conn = db.conn()?;
        let var_map = crate::db::environment::get_active_var_map(&conn);
        item = crate::http::vars::apply_vars(&item, &var_map);
    }

    let mut result = if item.protocol == "websocket" {
        crate::websocket::client::execute(&item)
            .await
            .map_err(|e| e.to_string())?
    } else {
        let app_clone = app.clone();
        crate::http::client::execute_smart(
            &http.0,
            &item,
            Some(Box::new(move |chunk| {
                let _ = app_clone.emit("stream-chunk", &chunk);
            })),
        )
        .await
        .map_err(|e| e.to_string())?
    };

    result.item_name = item.url.clone();
    crate::http::emit_request_log_with_item(&app, &result, &item);
    Ok(result)
}

/// 保留旧命令名以兼容前端
#[tauri::command]
pub async fn quick_test_stream(
    app: AppHandle,
    db: State<'_, DbState>,
    http: State<'_, HttpClient>,
    payload: crate::models::item::QuickTestPayload,
) -> Result<ExecutionResult, String> {
    quick_test(app, db, http, payload).await
}

/// 预览文件最大大小（20MB）
const MAX_PREVIEW_SIZE: u64 = 20 * 1024 * 1024;

/// 读取本地图片文件，返回 data URI（base64）用于前端缩略图预览
#[tauri::command]
pub fn read_file_preview(path: String) -> Result<Option<String>, String> {
    // 验证路径安全性
    let canonical = match crate::http::request_builder::validate_file_path(&path) {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };
    let ext = canonical
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "webm" => "audio/webm",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        _ => return Ok(None),
    };
    // 检查文件大小
    let metadata = std::fs::metadata(&canonical).map_err(|e| e.to_string())?;
    if metadata.len() > MAX_PREVIEW_SIZE {
        return Err(format!("文件过大 ({}MB)", metadata.len() / 1024 / 1024));
    }
    let bytes = std::fs::read(&canonical).map_err(|e| e.to_string())?;
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(Some(format!("data:{};base64,{}", mime, encoded)))
}

#[tauri::command]
pub fn parse_curl(curl_command: String) -> Result<crate::http::curl::CurlParseResult, String> {
    crate::http::curl::parse_curl(&curl_command)
}

#[tauri::command]
pub fn export_curl(db: State<'_, DbState>, id: String) -> Result<String, String> {
    let conn = db.conn()?;
    let raw_item = crate::db::item::get(&conn, &id).map_err(|e| e.to_string())?;
    // 应用环境变量替换，让导出的 curl 包含实际值
    let var_map = crate::db::environment::get_active_var_map(&conn);
    let item = crate::http::vars::apply_vars(&raw_item, &var_map);
    let headers: Vec<crate::models::item::KeyValuePair> =
        serde_json::from_str(&item.headers).unwrap_or_default();
    Ok(crate::http::curl::to_curl(
        &item.method,
        &item.url,
        &headers,
        &item.body_type,
        &item.body_content,
    ))
}
