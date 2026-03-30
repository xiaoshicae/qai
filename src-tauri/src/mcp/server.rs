use rusqlite::Connection;
use serde_json::json;

use super::protocol::{JsonRpcRequest, JsonRpcResponse};
use super::tools;

/// QAI 数据模型说明，写入 MCP initialize 响应，帮助 AI 理解上下文
const INSTRUCTIONS: &str = "\
QAI is an API testing tool (like Postman). Data model:

- **Groups**: Sidebar folders for organizing collections (nestable via parent_id)
- **Collections**: Test suites containing items
- **Items**: Nodes in a collection tree (type: request | folder | chain)
  - request: HTTP request with method, URL, headers, body, assertions
  - folder: container for organizing requests
  - chain: sequence of requests executed in order; steps can extract response values as variables for subsequent steps
- **Assertions**: Validation rules on responses (status_code, json_path, body_contains, response_time, header_contains)
- **Environments**: Named variable sets (e.g. dev/staging/prod). Only one active at a time. Variables are substituted in requests via {{key}} syntax.
- **Executions**: Historical records of test runs with response data and assertion results

Typical workflow: create collection → add items → add assertions → configure environment → run tests → inspect results.";

pub fn handle_request(
    conn: &Connection,
    client: &reqwest::Client,
    rt: &tokio::runtime::Runtime,
    line: &str,
) -> JsonRpcResponse {
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
                "serverInfo": { "name": "qai", "version": "0.2.0" },
                "instructions": INSTRUCTIONS
            }))
        }

        "notifications/initialized" => JsonRpcResponse::success(id, json!({})),

        "tools/list" => {
            JsonRpcResponse::success(id, json!({ "tools": tools::list_tools() }))
        }

        "tools/call" => {
            let params = req.params.unwrap_or(json!({}));
            let tool_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));

            match tools::call_tool(conn, client, rt, tool_name, &args) {
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
