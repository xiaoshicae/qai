pub mod client;
pub mod curl;
pub mod request_builder;
pub mod response;
pub mod stream;
pub mod vars;

use crate::models::execution::ExecutionResult;
use crate::models::item::{CollectionItem, KeyValuePair};

/// 请求日志事件（推送到前端 Console 面板）
#[derive(Clone, serde::Serialize)]
pub struct RequestLog {
    pub id: String,
    pub timestamp: String,
    pub method: String,
    pub url: String,
    pub status: Option<u16>,
    pub status_text: String,
    pub time_ms: u64,
    pub size_bytes: u64,
    pub error: Option<String>,
    /// 请求头（JSON 数组字符串，仅单请求有）
    pub request_headers: Vec<KeyValuePair>,
    /// Body 类型：none/json/raw/form-data/urlencoded
    pub body_type: String,
    /// 响应头
    pub response_headers: Vec<KeyValuePair>,
}

impl RequestLog {
    pub fn from_result(result: &ExecutionResult, item: Option<&CollectionItem>) -> Self {
        let (status, status_text, time_ms, size_bytes, response_headers) =
            if let Some(ref resp) = result.response {
                (
                    Some(resp.status),
                    resp.status_text.clone(),
                    resp.time_ms,
                    resp.size_bytes,
                    resp.headers.clone(),
                )
            } else {
                (None, String::new(), 0, 0, vec![])
            };

        let (request_headers, body_type) = if let Some(item) = item {
            let headers: Vec<KeyValuePair> =
                serde_json::from_str(&item.headers).unwrap_or_default();
            (
                headers.into_iter().filter(|kv| kv.enabled).collect(),
                item.body_type.clone(),
            )
        } else {
            (vec![], String::new())
        };

        Self {
            id: result.execution_id.clone(),
            timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
            method: result.request_method.clone(),
            url: result.request_url.clone(),
            status,
            status_text,
            time_ms,
            size_bytes,
            error: result.error_message.clone(),
            request_headers,
            body_type,
            response_headers,
        }
    }
}

/// 发射请求日志事件到前端（带请求详情）
pub fn emit_request_log_with_item(
    app: &tauri::AppHandle,
    result: &ExecutionResult,
    item: &CollectionItem,
) {
    use tauri::Emitter;
    let log = RequestLog::from_result(result, Some(item));
    let _ = app.emit("request-log", &log);
}

/// 发射请求日志事件到前端（仅结果，无请求详情）
pub fn emit_request_log(app: &tauri::AppHandle, result: &ExecutionResult) {
    use tauri::Emitter;
    let log = RequestLog::from_result(result, None);
    let _ = app.emit("request-log", &log);
}
