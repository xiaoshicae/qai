use rusqlite::Connection;
use serde_json::json;

use super::protocol::{JsonRpcRequest, JsonRpcResponse};
use super::tools;

/// QAI 数据模型说明，写入 MCP initialize 响应，帮助 AI 理解上下文
const INSTRUCTIONS: &str = "\
You are connected to **QAI**, an AI-powered API testing tool (similar to Postman). \
All test data lives in QAI's database — use QAI tools to query and operate on it. \
Do NOT search the user's codebase for test cases, modules, or collections.

## Data Model

- **Groups**: Sidebar folders for organizing collections (nestable via parent_id). \
Users often call them \"modules\" or \"categories\" (e.g. TEXT, IMAGE, VIDEO, AUTH).
- **Collections**: Test suites inside groups, containing items (test cases).
- **Items**: Nodes in a collection tree. Types:
  - `request`: HTTP test case with method, URL, headers, body, assertions
  - `folder`: organizational container for requests
  - `chain`: ordered sequence of requests; each step can extract response values as variables for the next step
- **Assertions**: Validation rules on HTTP responses (status_code, json_path, body_contains, response_time, header_contains)
- **Environments**: Named variable sets (e.g. Dev/Staging/Prod). Only one active at a time. Variables are auto-substituted in requests via `{{key}}` syntax.
- **Executions**: Historical records of test runs with response data and assertion results

## How to Interpret User Requests

When the user mentions tests, test cases, modules, suites, APIs, or collections, \
they are referring to QAI's data, **NOT** code files or code test frameworks like cargo test / jest / pytest. \
Always use QAI tools instead of searching the codebase or running shell test commands.

Common user intents and the tools to use:

| User says | Action |
|-----------|--------|
| \"run VIDEO tests\" / \"run tests under X\" | `search` → find collection/group → `run_collection` |
| \"list all collections\" / \"show me what tests exist\" | `list_groups` + `list_collections` |
| \"add a test case for /api/users\" | `create_item` in the appropriate collection |
| \"what failed?\" / \"show failures\" | `list_history` with status=failed |
| \"switch to prod environment\" | `list_environments` → `set_active_environment` |
| \"run this request\" / \"test this API\" | `send_request` or `quick_send` |
| \"show stats\" / \"how are we doing\" | `get_history_stats` |

## Name Resolution

When the user references an entity by name (e.g. \"VIDEO\", \"User API\", \"login chain\"):
1. Call `search` with the name as keyword to find matching groups, collections, and items.
2. Use the returned ID to perform subsequent operations (run, get, delete, etc.).
Never guess IDs — always look them up first.

## Typical Workflow

create collection → add items (requests) → add assertions → configure environment → run tests → inspect results → view history";

/// 处理 JSON-RPC 请求，返回 Some(response) 或 None（notification 不需要响应）
pub fn handle_request(
    conn: &Connection,
    client: &reqwest::Client,
    rt: &tokio::runtime::Runtime,
    line: &str,
) -> Option<JsonRpcResponse> {
    let req: JsonRpcRequest = match serde_json::from_str(line) {
        Ok(r) => r,
        Err(e) => {
            return Some(JsonRpcResponse::error(
                None,
                -32700,
                format!("Parse error: {e}"),
            ))
        }
    };

    let id = req.id.clone();

    match req.method.as_str() {
        "initialize" => Some(JsonRpcResponse::success(
            id,
            json!({
                "protocolVersion": "2024-11-05",
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "qai", "version": "0.2.0" },
                "instructions": INSTRUCTIONS
            }),
        )),

        // JSON-RPC 2.0: notifications 不需要响应
        m if m.starts_with("notifications/") => None,

        "tools/list" => Some(JsonRpcResponse::success(
            id,
            json!({ "tools": tools::list_tools() }),
        )),

        "tools/call" => {
            let params = req.params.unwrap_or(json!({}));
            let tool_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));

            match tools::call_tool(conn, client, rt, tool_name, &args) {
                Ok(result) => Some(JsonRpcResponse::success(
                    id,
                    json!({
                        "content": [{ "type": "text", "text": result }]
                    }),
                )),
                Err(e) => Some(JsonRpcResponse::success(
                    id,
                    json!({
                        "content": [{ "type": "text", "text": format!("Error: {e}") }],
                        "isError": true
                    }),
                )),
            }
        }

        _ => Some(JsonRpcResponse::error(
            id,
            -32601,
            format!("Method not found: {}", req.method),
        )),
    }
}
