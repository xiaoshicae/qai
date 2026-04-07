use futures_util::StreamExt;
use std::time::Instant;
use uuid::Uuid;

use crate::models::execution::ExecutionResult;
use crate::models::item::{CollectionItem, HttpResponse};

#[derive(Clone, serde::Serialize)]
pub struct StreamChunk {
    pub item_id: String,
    pub chunk: String, // SSE data 内容
    pub chunk_index: u32,
    pub done: bool,
}

/// 流式执行请求，解析 SSE 事件并通过回调逐步推送
pub async fn execute_stream(
    client: &reqwest::Client,
    item: &CollectionItem,
    on_chunk: impl Fn(StreamChunk) + Send + Sync + 'static,
) -> Result<ExecutionResult, anyhow::Error> {
    let builder = super::request_builder::build_request(client, item).await?;

    let start = Instant::now();
    let resp = builder.send().await?;

    let status = resp.status().as_u16();
    let status_text = resp.status().canonical_reason().unwrap_or("").to_string();
    let resp_headers = super::response::extract_headers(resp.headers());

    let _ttfb = start.elapsed().as_millis() as u64;

    // 流式读取响应体
    let mut stream = resp.bytes_stream();
    let mut full_body = String::new();
    let mut chunk_index: u32 = 0;
    let mut buf = String::new();

    let stream_item_id = item.id.clone();
    while let Some(chunk_result) = stream.next().await {
        let bytes = chunk_result?;
        let text = String::from_utf8_lossy(&bytes);
        buf.push_str(&text);

        // 按行解析 SSE 事件
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].to_string();
            buf = buf[pos + 1..].to_string();

            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with(':') {
                continue;
            }

            if let Some(data) = trimmed.strip_prefix("data:") {
                let data = data.trim();
                if data == "[DONE]" {
                    on_chunk(StreamChunk {
                        item_id: stream_item_id.clone(),
                        chunk: "[DONE]".to_string(),
                        chunk_index,
                        done: true,
                    });
                    chunk_index += 1;
                } else {
                    full_body.push_str(data);
                    full_body.push('\n');
                    on_chunk(StreamChunk {
                        item_id: stream_item_id.clone(),
                        chunk: data.to_string(),
                        chunk_index,
                        done: false,
                    });
                    chunk_index += 1;
                }
            } else {
                // 非 SSE 格式，也作为原始行推送
                full_body.push_str(trimmed);
                full_body.push('\n');
                on_chunk(StreamChunk {
                    item_id: stream_item_id.clone(),
                    chunk: trimmed.to_string(),
                    chunk_index,
                    done: false,
                });
                chunk_index += 1;
            }
        }
    }

    // 处理缓冲区剩余内容
    if !buf.trim().is_empty() {
        let trimmed = buf.trim();
        if let Some(data) = trimmed.strip_prefix("data:") {
            let data = data.trim();
            full_body.push_str(data);
        } else {
            full_body.push_str(trimmed);
        }
    }

    let total_time = start.elapsed().as_millis() as u64;
    let size_bytes = full_body.len() as u64;
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
            body: full_body,
            time_ms: total_time,
            size_bytes,
        }),
        assertion_results: vec![],
        error_message: None,
    })
}

/// 从 SSE JSON 事件中提取 content 文本（兼容 OpenAI 格式）
#[cfg(test)]
fn extract_sse_content(raw: &str) -> String {
    let mut content_parts: Vec<String> = Vec::new();

    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            // OpenAI chat completions 格式
            if let Some(choices) = json.get("choices").and_then(|c| c.as_array()) {
                for choice in choices {
                    if let Some(delta) = choice.get("delta") {
                        if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
                            content_parts.push(content.to_string());
                        }
                    }
                    // 非 streaming 格式
                    if let Some(message) = choice.get("message") {
                        if let Some(content) = message.get("content").and_then(|c| c.as_str()) {
                            content_parts.push(content.to_string());
                        }
                    }
                }
            }
        }
    }

    if content_parts.is_empty() {
        // 非 OpenAI 格式，返回原始内容
        raw.to_string()
    } else {
        content_parts.join("")
    }
}

#[cfg(test)]
mod tests {
    use super::extract_sse_content;

    #[test]
    fn test_openai_streaming_delta() {
        let raw = r#"{"choices":[{"delta":{"content":"Hello"}}]}
{"choices":[{"delta":{"content":" World"}}]}"#;
        assert_eq!(extract_sse_content(raw), "Hello World");
    }

    #[test]
    fn test_openai_non_streaming() {
        let raw = r#"{"choices":[{"message":{"content":"Full response"}}]}"#;
        assert_eq!(extract_sse_content(raw), "Full response");
    }

    #[test]
    fn test_non_openai_passthrough() {
        let raw = "just plain text response";
        assert_eq!(extract_sse_content(raw), raw);
    }

    #[test]
    fn test_empty_input() {
        assert_eq!(extract_sse_content(""), "");
    }

    #[test]
    fn test_mixed_lines_with_empty() {
        let raw = r#"
{"choices":[{"delta":{"content":"A"}}]}

{"choices":[{"delta":{"content":"B"}}]}
"#;
        assert_eq!(extract_sse_content(raw), "AB");
    }

    #[test]
    fn test_no_content_in_delta() {
        let raw = r#"{"choices":[{"delta":{"role":"assistant"}}]}"#;
        assert_eq!(extract_sse_content(raw), raw);
    }

    #[test]
    fn test_invalid_json_passthrough() {
        let raw = "not json {{{";
        assert_eq!(extract_sse_content(raw), raw);
    }
}
