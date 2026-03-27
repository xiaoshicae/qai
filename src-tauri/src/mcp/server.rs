use rusqlite::Connection;
use serde_json::{json, Value};

use super::protocol::{JsonRpcRequest, JsonRpcResponse};
use super::tools;

pub fn handle_request(conn: &Connection, line: &str) -> JsonRpcResponse {
    let req: JsonRpcRequest = match serde_json::from_str(line) {
        Ok(r) => r,
        Err(e) => return JsonRpcResponse::error(None, -32700, format!("Parse error: {e}")),
    };

    let id = req.id.clone();

    match req.method.as_str() {
        "initialize" => {
            JsonRpcResponse::success(id, json!({
                "protocolVersion": "2024-11-05",
                "capabilities": { "tools": {} },
                "serverInfo": {
                    "name": "qai",
                    "version": "0.1.0"
                }
            }))
        }

        "notifications/initialized" => {
            // 客户端确认，无需响应
            JsonRpcResponse::success(id, json!({}))
        }

        "tools/list" => {
            JsonRpcResponse::success(id, json!({
                "tools": tools::list_tools()
            }))
        }

        "tools/call" => {
            let params = req.params.unwrap_or(json!({}));
            let tool_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));

            match tools::call_tool(conn, tool_name, &args) {
                Ok(result) => JsonRpcResponse::success(id, json!({
                    "content": [{ "type": "text", "text": result }]
                })),
                Err(e) => JsonRpcResponse::success(id, json!({
                    "content": [{ "type": "text", "text": format!("Error: {e}") }],
                    "isError": true
                })),
            }
        }

        _ => JsonRpcResponse::error(id, -32601, format!("Method not found: {}", req.method)),
    }
}
