use std::time::Instant;
use futures_util::StreamExt;
use uuid::Uuid;

use crate::models::execution::ExecutionResult;
use crate::models::item::{CollectionItem, HttpResponse, KeyValuePair};

#[derive(Clone, serde::Serialize)]
pub struct StreamChunk {
    pub item_id: String,
    pub chunk: String,      // SSE data 内容
    pub chunk_index: u32,
    pub done: bool,
}

/// 流式执行请求，解析 SSE 事件并通过回调逐步推送
pub async fn execute_stream(
    client: &reqwest::Client,
    item: &CollectionItem,
    on_chunk: impl Fn(StreamChunk) + Send + Sync + 'static,
) -> Result<ExecutionResult, anyhow::Error> {
    let headers: Vec<KeyValuePair> = serde_json::from_str(&item.headers).unwrap_or_default();
    let query_params: Vec<KeyValuePair> = serde_json::from_str(&item.query_params).unwrap_or_default();

    let mut builder = match item.method.to_uppercase().as_str() {
        "POST" => client.post(&item.url),
        "PUT" => client.put(&item.url),
        "DELETE" => client.delete(&item.url),
        "PATCH" => client.patch(&item.url),
        "HEAD" => client.head(&item.url),
        _ => client.get(&item.url),
    };

    for kv in headers.iter().filter(|kv| kv.enabled) {
        builder = builder.header(&kv.key, &kv.value);
    }

    let enabled_params: Vec<(&str, &str)> = query_params
        .iter()
        .filter(|kv| kv.enabled)
        .map(|kv| (kv.key.as_str(), kv.value.as_str()))
        .collect();
    builder = builder.query(&enabled_params);

    match item.body_type.as_str() {
        "json" => {
            if !item.body_content.is_empty() {
                let json_value: serde_json::Value = serde_json::from_str(&item.body_content)
                    .unwrap_or(serde_json::Value::String(item.body_content.clone()));
                builder = builder.json(&json_value);
            }
        }
        "raw" => {
            if !item.body_content.is_empty() {
                builder = builder.body(item.body_content.clone());
            }
        }
        "form" => {
            let form_data: Vec<KeyValuePair> =
                serde_json::from_str(&item.body_content).unwrap_or_default();
            let form: Vec<(&str, &str)> = form_data
                .iter()
                .filter(|kv| kv.enabled)
                .map(|kv| (kv.key.as_str(), kv.value.as_str()))
                .collect();
            builder = builder.form(&form);
        }
        _ => {}
    }

    let start = Instant::now();
    let resp = builder.send().await?;

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

    let ttfb = start.elapsed().as_millis() as u64;

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

    // 尝试从 SSE 事件中提取 content 拼接为可读文本
    let readable_body = extract_sse_content(&full_body);

    Ok(ExecutionResult {
        execution_id,
        item_id: item.id.clone(),
        item_name: item.name.clone(),
        status: if status >= 200 && status < 400 {
            "success".to_string()
        } else {
            "failed".to_string()
        },
        response: Some(HttpResponse {
            status,
            status_text,
            headers: resp_headers,
            body: readable_body,
            time_ms: total_time,
            size_bytes,
        }),
        assertion_results: vec![],
        error_message: Some(format!("TTFB: {}ms | Chunks: {}", ttfb, chunk_index)),
    })
}

/// 从 SSE JSON 事件中提取 content 文本（兼容 OpenAI 格式）
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
