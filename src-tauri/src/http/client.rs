use std::time::Instant;
use base64::Engine;
use uuid::Uuid;

use crate::models::execution::{Execution, ExecutionResult};
use crate::models::item::{CollectionItem, HttpResponse, KeyValuePair};

pub async fn execute(client: &reqwest::Client, item: &CollectionItem) -> Result<ExecutionResult, anyhow::Error> {
    let builder = super::request_builder::build_request(client, item).await?;

    let start = Instant::now();
    let resp = builder.send().await?;
    let time_ms = start.elapsed().as_millis() as u64;

    let status = resp.status().as_u16();
    let status_text = resp.status().canonical_reason().unwrap_or("").to_string();
    let resp_headers: Vec<KeyValuePair> = resp
        .headers()
        .iter()
        .map(|(k, v)| KeyValuePair {
            key: k.to_string(),
            value: v.to_str().unwrap_or("").to_string(),
            enabled: true,
            field_type: String::new(),
        })
        .collect();

    // 检测二进制响应（音频等），base64 编码以便前端播放
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let is_binary = content_type.starts_with("audio/")
        || content_type.starts_with("image/")
        || content_type.starts_with("video/")
        || content_type == "application/octet-stream";

    let (body, size_bytes) = if is_binary {
        let bytes = resp.bytes().await?;
        let size = bytes.len() as u64;
        let encoded = format!(
            "data:{};base64,{}",
            content_type,
            base64::engine::general_purpose::STANDARD.encode(&bytes)
        );
        (encoded, size)
    } else {
        let text = resp.text().await?;
        let size = text.len() as u64;
        (text, size)
    };

    let execution_id = Uuid::new_v4().to_string();

    let expected = item.expect_status;
    let is_success = if expected > 0 {
        status == expected
    } else {
        status >= 200 && status < 400
    };

    Ok(ExecutionResult {
        execution_id,
        item_id: item.id.clone(),
        item_name: item.name.clone(),
        request_url: item.url.clone(),
        request_method: item.method.clone(),
        status: if is_success { crate::models::status::SUCCESS.to_string() } else { crate::models::status::FAILED.to_string() },
        response: Some(HttpResponse {
            status,
            status_text,
            headers: resp_headers,
            body,
            time_ms,
            size_bytes,
        }),
        assertion_results: vec![],
        error_message: None,
    })
}

pub fn to_execution(item: &CollectionItem, result: &ExecutionResult) -> Execution {
    let (response_status, response_headers, response_body, response_time_ms, response_size) =
        if let Some(ref resp) = result.response {
            (
                Some(resp.status),
                serde_json::to_string(&resp.headers).unwrap_or_default(),
                Some(resp.body.clone()),
                resp.time_ms,
                resp.size_bytes,
            )
        } else {
            (None, "{}".to_string(), None, 0, 0)
        };

    Execution {
        id: result.execution_id.clone(),
        item_id: item.id.clone(),
        collection_id: item.collection_id.clone(),
        batch_id: None,
        status: result.status.clone(),
        request_url: result.request_url.clone(),
        request_method: result.request_method.clone(),
        response_status,
        response_headers,
        response_body,
        response_time_ms,
        response_size,
        assertion_results: serde_json::to_string(&result.assertion_results).unwrap_or_default(),
        error_message: result.error_message.clone(),
        executed_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    }
}
