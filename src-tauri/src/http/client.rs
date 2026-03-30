use std::time::Instant;
use base64::Engine;
use uuid::Uuid;

use crate::models::execution::{Execution, ExecutionResult};
use crate::models::item::{CollectionItem, HttpResponse};

/// 检测响应是否为流式（SSE / chunked text）
fn is_streaming_response(headers: &reqwest::header::HeaderMap) -> bool {
    let ct = headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    ct.contains("text/event-stream")
        || ct.contains("text/plain") && headers.get("transfer-encoding")
            .and_then(|v| v.to_str().ok())
            .map_or(false, |v| v.contains("chunked"))
}

/// 智能执行：自动检测响应类型，流式响应通过回调逐块推送
pub async fn execute_smart(
    client: &reqwest::Client,
    item: &CollectionItem,
    on_chunk: Option<Box<dyn Fn(super::stream::StreamChunk) + Send + Sync + 'static>>,
) -> Result<ExecutionResult, anyhow::Error> {
    let builder = super::request_builder::build_request(client, item).await?;

    let start = Instant::now();
    let resp = builder.send().await?;

    let status = resp.status().as_u16();
    let status_text = resp.status().canonical_reason().unwrap_or("").to_string();
    let resp_headers = super::response::extract_headers(resp.headers());

    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let should_stream = on_chunk.is_some() && is_streaming_response(resp.headers());

    let is_binary = content_type.starts_with("audio/")
        || content_type.starts_with("image/")
        || content_type.starts_with("video/")
        || content_type == "application/octet-stream";

    let (body, size_bytes) = if should_stream {
        // 流式读取
        use futures_util::StreamExt;
        let on_chunk = on_chunk.unwrap();
        let mut stream = resp.bytes_stream();
        let mut full_body = String::new();
        let mut chunk_index: u32 = 0;
        let mut buf = String::new();
        let stream_item_id = item.id.clone();

        while let Some(chunk_result) = stream.next().await {
            let bytes = chunk_result?;
            let text = String::from_utf8_lossy(&bytes);
            buf.push_str(&text);

            while let Some(pos) = buf.find('\n') {
                let line = buf[..pos].to_string();
                buf = buf[pos + 1..].to_string();
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with(':') { continue; }

                if let Some(data) = trimmed.strip_prefix("data:") {
                    let data = data.trim();
                    if data == "[DONE]" {
                        on_chunk(super::stream::StreamChunk { item_id: stream_item_id.clone(), chunk: "[DONE]".to_string(), chunk_index, done: true });
                    } else {
                        full_body.push_str(data);
                        full_body.push('\n');
                        on_chunk(super::stream::StreamChunk { item_id: stream_item_id.clone(), chunk: data.to_string(), chunk_index, done: false });
                    }
                } else {
                    full_body.push_str(trimmed);
                    full_body.push('\n');
                    on_chunk(super::stream::StreamChunk { item_id: stream_item_id.clone(), chunk: trimmed.to_string(), chunk_index, done: false });
                }
                chunk_index += 1;
            }
        }
        if !buf.trim().is_empty() {
            let trimmed = buf.trim();
            if let Some(data) = trimmed.strip_prefix("data:") { full_body.push_str(data.trim()); }
            else { full_body.push_str(trimmed); }
        }
        let size = full_body.len() as u64;
        (full_body, size)
    } else if is_binary {
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

    let time_ms = start.elapsed().as_millis() as u64;
    let execution_id = Uuid::new_v4().to_string();
    let is_success = super::response::is_success_status(status, item.expect_status);

    Ok(ExecutionResult {
        execution_id,
        item_id: item.id.clone(),
        item_name: item.name.clone(),
        request_url: item.url.clone(),
        request_method: item.method.clone(),
        status: super::response::status_string(is_success),
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

/// 普通执行（向后兼容）
pub async fn execute(client: &reqwest::Client, item: &CollectionItem) -> Result<ExecutionResult, anyhow::Error> {
    execute_smart(client, item, None).await
}

/// 将 ExecutionResult 转为数据库可存储的 Execution
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::item::KeyValuePair;

    fn make_item() -> CollectionItem {
        CollectionItem {
            id: "item-1".into(),
            collection_id: "coll-1".into(),
            parent_id: None,
            item_type: "request".into(),
            name: "Login".into(),
            sort_order: 0,
            method: "POST".into(),
            url: "http://api.example.com/login".into(),
            headers: "[]".into(),
            query_params: "[]".into(),
            body_type: "json".into(),
            body_content: r#"{"user":"test"}"#.into(),
            extract_rules: "[]".into(),
            description: "".into(),
            expect_status: 200,
            poll_config: "".into(),
            protocol: "http".into(),
            created_at: "".into(),
            updated_at: "".into(),
        }
    }

    fn make_result(url: &str, method: &str) -> ExecutionResult {
        ExecutionResult {
            execution_id: "exec-1".into(),
            item_id: "item-1".into(),
            item_name: "Login".into(),
            request_url: url.into(),
            request_method: method.into(),
            status: "success".into(),
            response: Some(HttpResponse {
                status: 200,
                status_text: "OK".into(),
                headers: vec![KeyValuePair { key: "content-type".into(), value: "application/json".into(), enabled: true, field_type: String::new() }],
                body: r#"{"ok":true}"#.into(),
                time_ms: 150,
                size_bytes: 11,
            }),
            assertion_results: vec![],
            error_message: None,
        }
    }

    #[test]
    fn test_to_execution_uses_result_url() {
        let item = make_item();
        let result = make_result("http://real-api.com/login", "POST");
        let exec = to_execution(&item, &result);
        assert_eq!(exec.request_url, "http://real-api.com/login");
        assert_eq!(exec.request_method, "POST");
    }

    #[test]
    fn test_to_execution_basic_fields() {
        let item = make_item();
        let result = make_result("http://api.com", "GET");
        let exec = to_execution(&item, &result);
        assert_eq!(exec.id, "exec-1");
        assert_eq!(exec.item_id, "item-1");
        assert_eq!(exec.collection_id, "coll-1");
        assert!(exec.batch_id.is_none());
        assert_eq!(exec.status, "success");
        assert_eq!(exec.response_status, Some(200));
        assert_eq!(exec.response_time_ms, 150);
        assert_eq!(exec.response_size, 11);
    }

    #[test]
    fn test_to_execution_with_response_body() {
        let item = make_item();
        let result = make_result("http://a.com", "GET");
        let exec = to_execution(&item, &result);
        assert_eq!(exec.response_body.as_deref(), Some(r#"{"ok":true}"#));
    }

    #[test]
    fn test_to_execution_no_response() {
        let item = make_item();
        let mut result = make_result("http://a.com", "GET");
        result.response = None;
        let exec = to_execution(&item, &result);
        assert!(exec.response_status.is_none());
        assert!(exec.response_body.is_none());
        assert_eq!(exec.response_time_ms, 0);
        assert_eq!(exec.response_size, 0);
        assert_eq!(exec.response_headers, "{}");
    }

    #[test]
    fn test_to_execution_serializes_headers() {
        let item = make_item();
        let result = make_result("http://a.com", "GET");
        let exec = to_execution(&item, &result);
        assert!(exec.response_headers.contains("content-type"));
    }

    #[test]
    fn test_to_execution_executed_at_is_set() {
        let item = make_item();
        let result = make_result("http://a.com", "GET");
        let exec = to_execution(&item, &result);
        assert!(!exec.executed_at.is_empty());
    }
}
