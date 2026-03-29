use std::time::Instant;
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use uuid::Uuid;

use crate::models::execution::ExecutionResult;
use crate::models::item::{CollectionItem, HttpResponse, KeyValuePair};

/// 将 http(s) URL 转换为 ws(s) URL
fn to_ws_url(url: &str) -> String {
    url.replace("https://", "wss://")
        .replace("http://", "ws://")
}

/// 从 headers 中提取 Bearer token
fn extract_token(headers_json: &str) -> Option<String> {
    let headers: Vec<KeyValuePair> = serde_json::from_str(headers_json).unwrap_or_default();
    for kv in headers.iter().filter(|kv| kv.enabled) {
        if kv.key.eq_ignore_ascii_case("authorization") {
            let val = kv.value.trim();
            if val.starts_with("Bearer ") {
                return Some(val[7..].to_string());
            }
            return Some(val.to_string());
        }
    }
    None
}

/// 执行 WebSocket 请求，对标 e2e/run_cases.py 的 _do_websocket 流程：
/// 连接 → 认证 → 发送 payload → 接收二进制/文本帧 → 映射为 HttpResponse
pub async fn execute(item: &CollectionItem) -> Result<ExecutionResult, anyhow::Error> {
    let ws_url = to_ws_url(&item.url);
    let execution_id = Uuid::new_v4().to_string();
    let start = Instant::now();

    // 1. 建立 WebSocket 连接
    let (ws_stream, _resp) = connect_async(&ws_url).await
        .map_err(|e| anyhow::anyhow!("WebSocket 连接失败: {}", e))?;
    let (mut write, mut read) = ws_stream.split();

    // 2. 发送认证消息（如果有 Authorization header）
    if let Some(token) = extract_token(&item.headers) {
        let auth_msg = serde_json::json!({"token": token});
        write.send(Message::Text(auth_msg.to_string().into())).await?;

        // 等待认证响应
        if let Some(Ok(msg)) = read.next().await {
            if let Message::Text(text) = msg {
                if let Ok(data) = serde_json::from_str::<serde_json::Value>(&text) {
                    if data.get("status").and_then(|v| v.as_str()) != Some("authenticated") {
                        let err = data.get("error").and_then(|v| v.as_str()).unwrap_or("未知认证错误");
                        return Ok(make_error_result(&execution_id, item, start, &format!("认证失败: {}", err)));
                    }
                }
            }
        }
    }

    // 3. 发送 payload（body_content 作为 JSON 消息）
    if !item.body_content.is_empty() {
        write.send(Message::Text(item.body_content.clone().into())).await?;
    }

    // 4. 接收循环：收集二进制数据和文本消息
    let mut total_binary_bytes: u64 = 0;
    let mut text_messages: Vec<serde_json::Value> = Vec::new();
    let mut complete_msg: Option<serde_json::Value> = None;
    let mut fail_reason: Option<String> = None;

    let timeout = tokio::time::Duration::from_secs(30);

    loop {
        let msg = tokio::time::timeout(timeout, read.next()).await;

        match msg {
            Err(_) => {
                fail_reason = Some(format!("接收超时 ({}s)", timeout.as_secs()));
                break;
            }
            Ok(None) => break, // 连接关闭
            Ok(Some(Err(e))) => {
                fail_reason = Some(format!("接收错误: {}", e));
                break;
            }
            Ok(Some(Ok(frame))) => match frame {
                Message::Binary(data) => {
                    total_binary_bytes += data.len() as u64;
                }
                Message::Text(text) => {
                    if let Ok(msg_json) = serde_json::from_str::<serde_json::Value>(&text) {
                        // 检查错误
                        if msg_json.get("error").is_some()
                            || msg_json.get("type").and_then(|v| v.as_str()) == Some("error")
                        {
                            let err = msg_json.get("error")
                                .and_then(|v| v.as_str())
                                .unwrap_or(&text);
                            fail_reason = Some(err.to_string());
                            break;
                        }

                        // 检查完成消息
                        let msg_type = msg_json.get("type").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
                        let msg_status = msg_json.get("status").and_then(|v| v.as_str()).unwrap_or("").to_lowercase();
                        let done_types = ["complete", "completed", "done", "finished", "end"];
                        let done_statuses = ["complete", "completed", "done", "success", "succeeded", "finished"];

                        if done_types.contains(&msg_type.as_str()) || done_statuses.contains(&msg_status.as_str()) {
                            complete_msg = Some(msg_json.clone());
                        }

                        // billing 消息表示流程结束
                        if msg_type == "billing" {
                            text_messages.push(msg_json);
                            break;
                        }

                        text_messages.push(msg_json);
                    }
                }
                Message::Close(_) => break,
                _ => {}
            },
        }
    }

    // 5. 关闭连接
    let _ = write.close().await;
    let time_ms = start.elapsed().as_millis() as u64;

    // 6. 构建结果
    if let Some(reason) = fail_reason {
        return Ok(ExecutionResult {
            execution_id,
            item_id: item.id.clone(),
            item_name: item.name.clone(),
            status: crate::models::status::FAILED.to_string(),
            response: Some(HttpResponse {
                status: 0,
                status_text: "WebSocket Error".into(),
                headers: vec![],
                body: serde_json::to_string(&text_messages).unwrap_or_default(),
                time_ms,
                size_bytes: total_binary_bytes,
            }),
            assertion_results: vec![],
            error_message: Some(reason),
        });
    }

    let is_success = total_binary_bytes > 0 || complete_msg.is_some();
    let status_code: u16 = if is_success { 200 } else { 0 };

    // body 优先存 complete 消息，否则存所有文本消息
    let body = if let Some(ref cm) = complete_msg {
        serde_json::to_string_pretty(cm).unwrap_or_default()
    } else {
        serde_json::to_string_pretty(&text_messages).unwrap_or_default()
    };

    let expected = item.expect_status;
    let result_status = if expected > 0 {
        if status_code == expected { crate::models::status::SUCCESS } else { crate::models::status::FAILED }
    } else if is_success {
        crate::models::status::SUCCESS
    } else {
        crate::models::status::FAILED
    };

    Ok(ExecutionResult {
        execution_id,
        item_id: item.id.clone(),
        item_name: item.name.clone(),
        status: result_status.to_string(),
        response: Some(HttpResponse {
            status: status_code,
            status_text: if is_success { "OK".into() } else { "No Data".into() },
            headers: vec![
                KeyValuePair { key: "x-ws-binary-bytes".into(), value: total_binary_bytes.to_string(), enabled: true, field_type: String::new() },
                KeyValuePair { key: "x-ws-text-messages".into(), value: text_messages.len().to_string(), enabled: true, field_type: String::new() },
            ],
            body,
            time_ms,
            size_bytes: total_binary_bytes,
        }),
        assertion_results: vec![],
        error_message: if is_success { None } else { Some("未收到数据".into()) },
    })
}

fn make_error_result(execution_id: &str, item: &CollectionItem, start: Instant, error: &str) -> ExecutionResult {
    ExecutionResult {
        execution_id: execution_id.to_string(),
        item_id: item.id.clone(),
        item_name: item.name.clone(),
        status: crate::models::status::ERROR.to_string(),
        response: Some(HttpResponse {
            status: 0,
            status_text: "Error".into(),
            headers: vec![],
            body: String::new(),
            time_ms: start.elapsed().as_millis() as u64,
            size_bytes: 0,
        }),
        assertion_results: vec![],
        error_message: Some(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_to_ws_url() {
        assert_eq!(to_ws_url("http://localhost:8080/api/ws"), "ws://localhost:8080/api/ws");
        assert_eq!(to_ws_url("https://api.example.com/ws"), "wss://api.example.com/ws");
        assert_eq!(to_ws_url("ws://already.ws/path"), "ws://already.ws/path");
    }

    #[test]
    fn test_extract_token_bearer() {
        let headers = r#"[{"key":"Authorization","value":"Bearer abc123","enabled":true}]"#;
        assert_eq!(extract_token(headers), Some("abc123".into()));
    }

    #[test]
    fn test_extract_token_raw() {
        let headers = r#"[{"key":"Authorization","value":"raw-token","enabled":true}]"#;
        assert_eq!(extract_token(headers), Some("raw-token".into()));
    }

    #[test]
    fn test_extract_token_none() {
        let headers = r#"[{"key":"Content-Type","value":"application/json","enabled":true}]"#;
        assert_eq!(extract_token(headers), None);
    }

    #[test]
    fn test_extract_token_disabled() {
        let headers = r#"[{"key":"Authorization","value":"Bearer abc","enabled":false}]"#;
        assert_eq!(extract_token(headers), None);
    }

    #[test]
    fn test_extract_token_case_insensitive() {
        let headers = r#"[{"key":"authorization","value":"Bearer tok","enabled":true}]"#;
        assert_eq!(extract_token(headers), Some("tok".into()));
    }

    #[test]
    fn test_extract_token_empty_headers() {
        assert_eq!(extract_token("[]"), None);
        assert_eq!(extract_token("invalid"), None);
    }
}
