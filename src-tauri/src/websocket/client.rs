use futures_util::{SinkExt, StreamExt};
use std::time::Instant;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use uuid::Uuid;

use crate::models::execution::ExecutionResult;
use crate::models::item::{CollectionItem, HttpResponse, KeyValuePair};
use crate::models::Status;

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
            if let Some(stripped) = val.strip_prefix("Bearer ") {
                return Some(stripped.to_string());
            }
            return Some(val.to_string());
        }
    }
    None
}

/// 解析 body_content 为消息列表（仅当 JSON 数组且元素全为对象时识别为多步）
fn parse_messages(body_content: &str) -> Vec<serde_json::Value> {
    let trimmed = body_content.trim();
    if trimmed.is_empty() {
        return vec![];
    }
    if trimmed.starts_with('[') {
        if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(trimmed) {
            if !arr.is_empty() && arr.iter().all(|v| v.is_object()) {
                return arr;
            }
        }
    }
    if let Ok(obj) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if obj.is_object() {
            return vec![obj];
        }
    }
    vec![]
}

/// 判断 body_content 是否为 JSON 数组格式（多步模式）
fn is_multi_step_body(body_content: &str) -> bool {
    let trimmed = body_content.trim();
    if !trimmed.starts_with('[') {
        return false;
    }
    serde_json::from_str::<Vec<serde_json::Value>>(trimmed)
        .map(|arr| !arr.is_empty() && arr.iter().all(|v| v.is_object()))
        .unwrap_or(false)
}

/// 检查 JSON 消息是否为完成信号
fn is_done_signal(json: &serde_json::Value) -> bool {
    let msg_type = json
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();
    let msg_status = json
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();
    let done_types = [
        "complete",
        "completed",
        "done",
        "finished",
        "end",
        "billing",
    ];
    let done_statuses = [
        "complete",
        "completed",
        "done",
        "success",
        "succeeded",
        "finished",
    ];
    done_types.contains(&msg_type.as_str()) || done_statuses.contains(&msg_status.as_str())
}

/// 检查 JSON 消息是否为错误
fn is_error_message(json: &serde_json::Value) -> bool {
    json.get("error").is_some() || json.get("type").and_then(|v| v.as_str()) == Some("error")
}

/// WebSocket 连接超时时间
const WS_CONNECT_TIMEOUT_SECS: u64 = 15;

/// 执行 WebSocket 请求
/// - body_content 为 JSON 数组时：多步模式（用户完全控制每条消息内容）
/// - body_content 为 JSON 对象时：单步模式（自动认证 + 发送 payload）
pub async fn execute(item: &CollectionItem) -> Result<ExecutionResult, anyhow::Error> {
    let ws_url = to_ws_url(&item.url);
    let execution_id = Uuid::new_v4().to_string();
    let start = Instant::now();

    // 带超时的连接，防止慢服务器无限挂起
    let (ws, _) = tokio::time::timeout(
        std::time::Duration::from_secs(WS_CONNECT_TIMEOUT_SECS),
        connect_async(&ws_url),
    )
    .await
    .map_err(|_| anyhow::anyhow!("WebSocket 连接超时 ({}s)", WS_CONNECT_TIMEOUT_SECS))?
    .map_err(|e| anyhow::anyhow!("WebSocket 连接失败: {}", e))?;

    if is_multi_step_body(&item.body_content) {
        let messages = parse_messages(&item.body_content);
        execute_steps(execution_id, item, ws, &messages, start).await
    } else {
        execute_single(execution_id, item, ws, start).await
    }
}

/// 多步模式：逐条发送消息，每步收集响应并记录结果
async fn execute_steps<S>(
    execution_id: String,
    item: &CollectionItem,
    mut ws: S,
    messages: &[serde_json::Value],
    start: Instant,
) -> Result<ExecutionResult, anyhow::Error>
where
    S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>>
        + SinkExt<Message>
        + Unpin,
    <S as futures_util::Sink<Message>>::Error: std::fmt::Display,
{
    let total = messages.len();
    let mut steps: Vec<serde_json::Value> = Vec::new();
    let mut total_binary: u64 = 0;
    let mut total_text: usize = 0;
    let mut overall_error: Option<String> = None;

    for (i, msg) in messages.iter().enumerate() {
        let step_start = Instant::now();
        let is_last = i == total - 1;
        let step_num = i + 1;

        // 发送消息
        let msg_str = serde_json::to_string(msg).unwrap_or_default();
        if let Err(e) = ws.send(Message::Text(msg_str.into())).await {
            steps.push(serde_json::json!({
                "step": step_num, "sent": msg, "received": [],
                "binary_bytes": 0, "status": crate::models::status::ERROR,
                "error": format!("发送失败: {}", e),
                "time_ms": step_start.elapsed().as_millis() as u64,
            }));
            overall_error = Some(format!("步骤 {} 发送失败: {}", step_num, e));
            break;
        }

        // 接收响应：中间步骤等首条文本即返回，最后一步收集至完成
        let (received, bytes, err) = if is_last {
            collect_responses(&mut ws, 30, false).await
        } else {
            collect_responses(&mut ws, 10, true).await
        };

        total_binary += bytes;
        total_text += received.len();
        let status = if err.is_some() {
            crate::models::status::ERROR
        } else {
            crate::models::status::SUCCESS
        };

        steps.push(serde_json::json!({
            "step": step_num, "sent": msg, "received": received,
            "binary_bytes": bytes, "status": status,
            "error": err, "time_ms": step_start.elapsed().as_millis() as u64,
        }));

        if let Some(ref e) = err {
            overall_error = Some(format!("步骤 {}: {}", step_num, e));
            break;
        }
    }

    let _ = ws.close().await;
    let time_ms = start.elapsed().as_millis() as u64;
    let is_success = overall_error.is_none();
    let status_code: u16 = if is_success { 200 } else { 0 };

    let body = serde_json::to_string_pretty(&serde_json::json!({
        "_ws_steps": true,
        "steps": steps,
        "total_binary_bytes": total_binary,
        "total_text_messages": total_text,
    }))
    .unwrap_or_default();

    let expected = item.expect_status;
    let result_status = if expected > 0 {
        if status_code == expected {
            Status::Success
        } else {
            Status::Failed
        }
    } else if is_success {
        Status::Success
    } else {
        Status::Failed
    };

    Ok(ExecutionResult {
        execution_id,
        item_id: item.id.clone(),
        item_name: item.name.clone(),
        request_url: item.url.clone(),
        request_method: "WS".to_string(),
        status: result_status.as_str().to_string(),
        response: Some(HttpResponse {
            status: status_code,
            status_text: if is_success {
                "OK".into()
            } else {
                "Failed".into()
            },
            headers: vec![
                KeyValuePair {
                    key: "x-ws-binary-bytes".into(),
                    value: total_binary.to_string(),
                    enabled: true,
                    field_type: String::new(),
                },
                KeyValuePair {
                    key: "x-ws-text-messages".into(),
                    value: total_text.to_string(),
                    enabled: true,
                    field_type: String::new(),
                },
                KeyValuePair {
                    key: "x-ws-steps".into(),
                    value: total.to_string(),
                    enabled: true,
                    field_type: String::new(),
                },
            ],
            body,
            time_ms,
            size_bytes: total_binary,
        }),
        assertion_results: vec![],
        error_message: overall_error,
    })
}

/// 从 WebSocket 收集响应
/// - stop_on_first_text: true 时收到首条文本即返回（中间步骤），false 时收集到完成信号或超时
async fn collect_responses<S>(
    ws: &mut S,
    timeout_secs: u64,
    stop_on_first_text: bool,
) -> (Vec<serde_json::Value>, u64, Option<String>)
where
    S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    let timeout_dur = tokio::time::Duration::from_secs(timeout_secs);
    let mut received: Vec<serde_json::Value> = Vec::new();
    let mut binary_bytes: u64 = 0;

    loop {
        match tokio::time::timeout(timeout_dur, ws.next()).await {
            Err(_) => {
                // 超时：最后一步无数据视为错误，其余情况正常结束
                if !stop_on_first_text && received.is_empty() && binary_bytes == 0 {
                    return (
                        received,
                        binary_bytes,
                        Some(format!("接收超时 ({}s)", timeout_secs)),
                    );
                }
                break;
            }
            Ok(None) => break,
            Ok(Some(Err(e))) => {
                return (received, binary_bytes, Some(format!("接收错误: {}", e)));
            }
            Ok(Some(Ok(frame))) => match frame {
                Message::Binary(data) => {
                    binary_bytes += data.len() as u64;
                }
                Message::Text(text) => {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                        if is_error_message(&json) {
                            let err = json
                                .get("error")
                                .and_then(|v| v.as_str())
                                .unwrap_or(&text)
                                .to_string();
                            received.push(json);
                            return (received, binary_bytes, Some(err));
                        }
                        let done = is_done_signal(&json);
                        received.push(json);
                        if done || stop_on_first_text {
                            break;
                        }
                    }
                }
                Message::Close(_) => break,
                _ => {}
            },
        }
    }

    (received, binary_bytes, None)
}

/// 单步模式（向后兼容）：自动认证 + 发送 payload + 收集响应
async fn execute_single<S>(
    execution_id: String,
    item: &CollectionItem,
    mut ws: S,
    start: Instant,
) -> Result<ExecutionResult, anyhow::Error>
where
    S: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>>
        + SinkExt<Message>
        + Unpin,
    <S as futures_util::Sink<Message>>::Error: std::fmt::Display,
{
    // 自动认证（仅当有 Authorization header 时）
    if let Some(token) = extract_token(&item.headers) {
        let auth_msg = serde_json::json!({"token": token});
        ws.send(Message::Text(auth_msg.to_string().into()))
            .await
            .map_err(|e| anyhow::anyhow!("发送认证消息失败: {}", e))?;

        if let Some(Ok(Message::Text(text))) = ws.next().await {
            if let Ok(data) = serde_json::from_str::<serde_json::Value>(&text) {
                if data.get("status").and_then(|v| v.as_str()) != Some("authenticated") {
                    let err = data
                        .get("error")
                        .and_then(|v| v.as_str())
                        .unwrap_or("未知认证错误");
                    // 认证失败时关闭 socket，防止资源泄漏
                    let _ = ws.close().await;
                    return Ok(make_error_result(
                        &execution_id,
                        item,
                        start,
                        &format!("认证失败: {}", err),
                    ));
                }
            }
        }
    }

    // 发送 payload
    if !item.body_content.is_empty() {
        ws.send(Message::Text(item.body_content.clone().into()))
            .await
            .map_err(|e| anyhow::anyhow!("发送消息失败: {}", e))?;
    }

    // 收集响应
    let (text_messages, total_binary_bytes, fail_reason) =
        collect_responses(&mut ws, 30, false).await;
    let _ = ws.close().await;
    let time_ms = start.elapsed().as_millis() as u64;

    if let Some(reason) = fail_reason {
        return Ok(ExecutionResult {
            execution_id,
            item_id: item.id.clone(),
            item_name: item.name.clone(),
            request_url: item.url.clone(),
            request_method: "WS".to_string(),
            status: Status::Failed.as_str().to_string(),
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

    let complete_msg = text_messages.iter().find(|m| is_done_signal(m));
    let is_success = total_binary_bytes > 0 || complete_msg.is_some();
    let status_code: u16 = if is_success { 200 } else { 0 };

    let body = if let Some(cm) = complete_msg {
        serde_json::to_string_pretty(cm).unwrap_or_default()
    } else {
        serde_json::to_string_pretty(&text_messages).unwrap_or_default()
    };

    let expected = item.expect_status;
    let result_status = if expected > 0 {
        if status_code == expected {
            Status::Success
        } else {
            Status::Failed
        }
    } else if is_success {
        Status::Success
    } else {
        Status::Failed
    };

    Ok(ExecutionResult {
        execution_id,
        item_id: item.id.clone(),
        item_name: item.name.clone(),
        request_url: item.url.clone(),
        request_method: "WS".to_string(),
        status: result_status.as_str().to_string(),
        response: Some(HttpResponse {
            status: status_code,
            status_text: if is_success {
                "OK".into()
            } else {
                "No Data".into()
            },
            headers: vec![
                KeyValuePair {
                    key: "x-ws-binary-bytes".into(),
                    value: total_binary_bytes.to_string(),
                    enabled: true,
                    field_type: String::new(),
                },
                KeyValuePair {
                    key: "x-ws-text-messages".into(),
                    value: text_messages.len().to_string(),
                    enabled: true,
                    field_type: String::new(),
                },
            ],
            body,
            time_ms,
            size_bytes: total_binary_bytes,
        }),
        assertion_results: vec![],
        error_message: if is_success {
            None
        } else {
            Some("未收到数据".into())
        },
    })
}

fn make_error_result(
    execution_id: &str,
    item: &CollectionItem,
    start: Instant,
    error: &str,
) -> ExecutionResult {
    ExecutionResult {
        execution_id: execution_id.to_string(),
        item_id: item.id.clone(),
        item_name: item.name.clone(),
        request_url: item.url.clone(),
        request_method: "WS".to_string(),
        status: Status::Error.as_str().to_string(),
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
        assert_eq!(
            to_ws_url("http://localhost:8080/api/ws"),
            "ws://localhost:8080/api/ws"
        );
        assert_eq!(
            to_ws_url("https://api.example.com/ws"),
            "wss://api.example.com/ws"
        );
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

    #[test]
    fn test_parse_messages_array() {
        let body = r#"[{"token":"abc"},{"text":"hello"}]"#;
        let msgs = parse_messages(body);
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0]["token"], "abc");
        assert_eq!(msgs[1]["text"], "hello");
    }

    #[test]
    fn test_parse_messages_single_object() {
        let body = r#"{"text":"hello"}"#;
        let msgs = parse_messages(body);
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0]["text"], "hello");
    }

    #[test]
    fn test_parse_messages_empty() {
        assert!(parse_messages("").is_empty());
        assert!(parse_messages("  ").is_empty());
    }

    #[test]
    fn test_is_multi_step_body() {
        assert!(is_multi_step_body(r#"[{"a":1},{"b":2}]"#));
        assert!(is_multi_step_body(r#"[{"a":1}]"#));
        assert!(!is_multi_step_body(r#"{"a":1}"#));
        assert!(!is_multi_step_body(r#"[1,2,3]"#));
        assert!(!is_multi_step_body(""));
    }

    #[test]
    fn test_is_done_signal() {
        assert!(is_done_signal(&serde_json::json!({"type": "complete"})));
        assert!(is_done_signal(&serde_json::json!({"status": "done"})));
        assert!(is_done_signal(&serde_json::json!({"type": "billing"})));
        assert!(!is_done_signal(&serde_json::json!({"type": "data"})));
        assert!(!is_done_signal(&serde_json::json!({"text": "hello"})));
    }

    #[test]
    fn test_is_error_message() {
        assert!(is_error_message(&serde_json::json!({"error": "bad"})));
        assert!(is_error_message(&serde_json::json!({"type": "error"})));
        assert!(!is_error_message(&serde_json::json!({"type": "data"})));
    }
}
