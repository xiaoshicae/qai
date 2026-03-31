use serde_json::{json, Value};

use super::handlers;

/// 返回所有 MCP tool 定义（英文，AI 友好）
pub fn list_tools() -> Vec<Value> {
    vec![
        // ─── Collection ────────────────────────────────────────
        // ─── Search (name resolution) ────────────────────────────
        json!({
            "name": "search",
            "description": "Search QAI data by keyword. Use this FIRST when the user mentions an entity by name (e.g. 'VIDEO', 'login', 'User API'). Searches across groups, collections, and items (test cases). Returns matching entities with their IDs so you can operate on them.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "keyword": { "type": "string", "description": "Search keyword (case-insensitive, partial match)" },
                    "scope": { "type": "string", "enum": ["all", "groups", "collections", "items"], "description": "Limit search scope (default: all)" }
                },
                "required": ["keyword"]
            }
        }),

        // ─── Collection ────────────────────────────────────────
        json!({
            "name": "list_collections",
            "description": "List all test collections (test suites). Each collection belongs to a sidebar group and contains test items. Use this when the user asks 'what tests exist', 'show all suites', or 'list collections'. Returns array of {id, name, description, group_id, sort_order, created_at}.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "get_collection",
            "description": "Get a collection with all its items (test cases, folders, chains). Use this to see what's inside a specific test suite. Items have parent_id for tree nesting. item.type is 'request'|'folder'|'chain'.",
            "inputSchema": {
                "type": "object",
                "properties": { "collection_id": { "type": "string" } },
                "required": ["collection_id"]
            }
        }),
        json!({
            "name": "create_collection",
            "description": "Create a new test collection. Optionally assign to a sidebar group.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "description": { "type": "string" },
                    "group_id": { "type": "string", "description": "Sidebar group ID" }
                },
                "required": ["name"]
            }
        }),
        json!({
            "name": "update_collection",
            "description": "Update a collection's name or description. Only pass fields you want to change.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "name": { "type": "string" },
                    "description": { "type": "string" }
                },
                "required": ["id"]
            }
        }),
        json!({
            "name": "delete_collection",
            "description": "Delete a collection and all its items, assertions, and history.",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"]
            }
        }),

        // ─── Item (test case / folder / chain) ─────────────────
        json!({
            "name": "create_item",
            "description": "Create an item in a collection. Types:\n- 'request': HTTP request with method, URL, headers, body, assertions\n- 'folder': container for organizing requests\n- 'chain': sequence of requests executed in order; each step can extract response values as variables for the next step via extract_rules\n\nUse {{variable}} syntax in url/headers/body to reference environment variables.\nHeaders/query_params format: JSON array [{\"key\":\"K\",\"value\":\"V\",\"enabled\":true}]",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "collection_id": { "type": "string" },
                    "parent_id": { "type": "string", "description": "Parent folder or chain ID" },
                    "item_type": { "type": "string", "enum": ["request", "folder", "chain"], "default": "request" },
                    "name": { "type": "string" },
                    "method": { "type": "string", "enum": ["GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS"], "default": "GET" },
                    "url": { "type": "string", "description": "Full URL, e.g. https://api.example.com/users" },
                    "headers": { "type": "string", "description": "JSON array: [{\"key\":\"Authorization\",\"value\":\"Bearer tok\",\"enabled\":true}]" },
                    "query_params": { "type": "string", "description": "JSON array: [{\"key\":\"page\",\"value\":\"1\",\"enabled\":true}]" },
                    "body_type": { "type": "string", "enum": ["none","json","raw","urlencoded","form-data"], "default": "none" },
                    "body_content": { "type": "string", "description": "Body content. For json: raw JSON string. For urlencoded/form-data: [{\"key\":\"k\",\"value\":\"v\",\"enabled\":true}]" },
                    "description": { "type": "string" },
                    "expect_status": { "type": "number", "description": "Expected HTTP status (default 200). 0 = accept any 2xx/3xx." },
                    "extract_rules": { "type": "string", "description": "For chain steps. JSON: [{\"var_name\":\"token\",\"source\":\"json_body\",\"expression\":\"$.data.token\"}]. Sources: json_body, header, status_code" }
                },
                "required": ["collection_id", "name"]
            }
        }),
        json!({
            "name": "get_item",
            "description": "Get full details of a single item (request/folder/chain).",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"]
            }
        }),
        json!({
            "name": "update_item",
            "description": "Update an item. Only pass fields you want to change.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "name": { "type": "string" },
                    "method": { "type": "string", "enum": ["GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS"] },
                    "url": { "type": "string" },
                    "headers": { "type": "string" },
                    "query_params": { "type": "string" },
                    "body_type": { "type": "string", "enum": ["none","json","raw","urlencoded","form-data"] },
                    "body_content": { "type": "string" },
                    "description": { "type": "string" },
                    "expect_status": { "type": "number" },
                    "extract_rules": { "type": "string" }
                },
                "required": ["id"]
            }
        }),
        json!({
            "name": "delete_item",
            "description": "Delete an item and its child items/assertions.",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"]
            }
        }),

        // ─── Assertion ─────────────────────────────────────────
        json!({
            "name": "create_assertion",
            "description": "Add an assertion to a test case. Assertions validate the HTTP response after execution.\n\nTypes & usage:\n- status_code: check HTTP status. expression is ignored. e.g. operator=eq, expected=200\n- json_path: check a JSON path value. expression=$.data.id, operator=exists\n- body_contains: check if body contains a string. expression is ignored. operator=contains, expected=success\n- response_time: check latency in ms. expression is ignored. operator=lt, expected=1000\n- header_contains: check a response header. expression=Content-Type, operator=contains, expected=json",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "item_id": { "type": "string" },
                    "assertion_type": { "type": "string", "enum": ["status_code","json_path","body_contains","response_time","header_contains"] },
                    "expression": { "type": "string", "description": "JSONPath (e.g. $.data.id) or header name. Leave empty for status_code/body_contains/response_time." },
                    "operator": { "type": "string", "enum": ["eq","neq","gt","lt","gte","lte","contains","not_contains","exists","matches"] },
                    "expected": { "type": "string", "description": "Expected value as string" }
                },
                "required": ["item_id", "assertion_type", "operator", "expected"]
            }
        }),
        json!({
            "name": "list_assertions",
            "description": "List all assertions for a test case.",
            "inputSchema": {
                "type": "object",
                "properties": { "item_id": { "type": "string" } },
                "required": ["item_id"]
            }
        }),
        json!({
            "name": "update_assertion",
            "description": "Update an assertion. Only pass fields you want to change.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "assertion_type": { "type": "string", "enum": ["status_code","json_path","body_contains","response_time","header_contains"] },
                    "expression": { "type": "string" },
                    "operator": { "type": "string", "enum": ["eq","neq","gt","lt","gte","lte","contains","not_contains","exists","matches"] },
                    "expected": { "type": "string" },
                    "enabled": { "type": "boolean" }
                },
                "required": ["id"]
            }
        }),
        json!({
            "name": "delete_assertion",
            "description": "Delete an assertion.",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"]
            }
        }),

        // ─── Execution ─────────────────────────────────────────
        json!({
            "name": "send_request",
            "description": "Execute a saved test case (request item) by its ID. Use this when the user says 'run this request', 'test this API', or 'send this'. Applies active environment variables, runs the HTTP request, evaluates assertions, saves to history. Returns full result: status, headers, body, timing, assertion outcomes.",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "string", "description": "Item ID of the request to execute" } },
                "required": ["id"]
            }
        }),
        json!({
            "name": "quick_send",
            "description": "Execute a raw HTTP request without saving to the database. Useful for quick debugging or exploration. Applies active environment variables to {{var}} placeholders. Returns response status, headers, body, and timing.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "method": { "type": "string", "enum": ["GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS"] },
                    "url": { "type": "string", "description": "Full URL" },
                    "headers": { "type": "string", "description": "JSON array [{\"key\":\"K\",\"value\":\"V\",\"enabled\":true}], or empty string" },
                    "body_type": { "type": "string", "enum": ["none","json","raw","urlencoded","form-data"], "default": "none" },
                    "body_content": { "type": "string", "description": "Body content" }
                },
                "required": ["method", "url"]
            }
        }),
        json!({
            "name": "run_collection",
            "description": "Execute all test cases in a collection (or under a specific folder/chain). Use this when the user says 'run all tests', 'run VIDEO tests', 'execute this suite', etc. First use `search` or `list_collections` to find the collection_id. Chains execute sequentially with variable passing; other requests run in parallel. Results are saved to history. Returns summary: total, passed, failed, errors, time, and per-item results.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "collection_id": { "type": "string" },
                    "parent_id": { "type": "string", "description": "Optional: only run items under this folder/chain" },
                    "concurrency": { "type": "number", "description": "Max parallel requests (default 5)" }
                },
                "required": ["collection_id"]
            }
        }),

        // ─── Environment Variables ──────────────────────────────
        json!({
            "name": "list_environments",
            "description": "List all environments. Each has id, name, is_active. Only one can be active at a time. The active environment's variables are auto-applied to {{var}} placeholders in requests.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "create_environment",
            "description": "Create a new environment (e.g. 'Development', 'Staging', 'Production').",
            "inputSchema": {
                "type": "object",
                "properties": { "name": { "type": "string" } },
                "required": ["name"]
            }
        }),
        json!({
            "name": "set_active_environment",
            "description": "Activate an environment. Its variables will be applied to all subsequent request executions via {{variable}} substitution.",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "string", "description": "Environment ID" } },
                "required": ["id"]
            }
        }),
        json!({
            "name": "get_active_environment",
            "description": "Get the currently active environment with all its variables. Returns null if no environment is active.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "save_env_variables",
            "description": "Set all variables for an environment. This replaces existing variables entirely.\nVariables are referenced in requests as {{key}}, e.g. URL: {{base_url}}/api/users",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "environment_id": { "type": "string" },
                    "variables": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "key": { "type": "string" },
                                "value": { "type": "string" },
                                "enabled": { "type": "boolean", "default": true }
                            },
                            "required": ["key", "value"]
                        },
                        "description": "Array of {key, value, enabled} objects"
                    }
                },
                "required": ["environment_id", "variables"]
            }
        }),
        json!({
            "name": "delete_environment",
            "description": "Delete an environment and all its variables.",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"]
            }
        }),

        // ─── History ────────────────────────────────────────────
        json!({
            "name": "list_history",
            "description": "List recent execution history. Use when the user asks 'what failed', 'show results', 'recent runs', etc. Returns item name, status (success/failed/error), URL, method, response status, timing, and assertion results. Supports filtering by status, method, and keyword.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "status": { "type": "string", "enum": ["success", "failed", "error"], "description": "Filter by status" },
                    "method": { "type": "string", "description": "Filter by HTTP method" },
                    "keyword": { "type": "string", "description": "Search in URL or item name" },
                    "limit": { "type": "number", "description": "Max results (default 50)" }
                }
            }
        }),
        json!({
            "name": "get_history_stats",
            "description": "Get overall execution statistics. Use when the user asks 'how are tests doing', 'show stats', 'pass rate', etc. Returns: total runs, success/failed/error counts, average response time.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "list_item_runs",
            "description": "Get execution history for a specific test case. Returns recent runs with response details and assertion results.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "item_id": { "type": "string" },
                    "limit": { "type": "number", "description": "Max results (default 20)" }
                },
                "required": ["item_id"]
            }
        }),

        // ─── Group (sidebar organization) ───────────────────────
        json!({
            "name": "list_groups",
            "description": "List all sidebar groups (also called modules or categories by users, e.g. TEXT, IMAGE, VIDEO). Groups organize collections in the sidebar. They can be nested (parent_id). Use this when the user mentions a module or category name.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "create_group",
            "description": "Create a sidebar group for organizing collections.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "parent_id": { "type": "string", "description": "Parent group ID for nesting" }
                },
                "required": ["name"]
            }
        }),
        json!({
            "name": "delete_group",
            "description": "Delete a sidebar group. Collections in the group become ungrouped (not deleted).",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"]
            }
        }),
    ]
}

/// 分发 MCP tool 调用到对应 handler
pub fn call_tool(
    conn: &rusqlite::Connection,
    client: &reqwest::Client,
    rt: &tokio::runtime::Runtime,
    name: &str,
    args: &Value,
) -> Result<String, String> {
    match name {
        // Search
        "search" => handlers::search(conn, &get_str(args, "keyword")?, get_opt_str(args, "scope").as_deref()),

        // Collection
        "list_collections" => handlers::list_collections(conn),
        "get_collection" => handlers::get_collection(conn, &get_str(args, "collection_id")?),
        "create_collection" => handlers::create_collection(conn, &get_str(args, "name")?, get_opt_str(args, "description").as_deref(), get_opt_str(args, "group_id").as_deref()),
        "update_collection" => handlers::update_collection(conn, &get_str(args, "id")?, get_opt_str(args, "name").as_deref(), get_opt_str(args, "description").as_deref()),
        "delete_collection" => handlers::delete_collection(conn, &get_str(args, "id")?),

        // Item
        "create_item" => handlers::create_item(conn, args),
        "get_item" => handlers::get_item(conn, &get_str(args, "id")?),
        "update_item" => handlers::update_item(conn, args),
        "delete_item" => handlers::delete_item(conn, &get_str(args, "id")?),

        // Assertion
        "create_assertion" => handlers::create_assertion(conn, &get_str(args, "item_id")?, &get_str(args, "assertion_type")?, get_opt_str(args, "expression").as_deref().unwrap_or(""), &get_str(args, "operator")?, &get_str(args, "expected")?),
        "list_assertions" => handlers::list_assertions(conn, &get_str(args, "item_id")?),
        "update_assertion" => handlers::update_assertion(conn, args),
        "delete_assertion" => handlers::delete_assertion(conn, &get_str(args, "id")?),

        // Execution (async)
        "send_request" => rt.block_on(handlers::send_request(conn, client, &get_str(args, "id")?)),
        "quick_send" => rt.block_on(handlers::quick_send(conn, client, args)),
        "run_collection" => rt.block_on(handlers::run_collection(conn, client, &get_str(args, "collection_id")?, get_opt_str(args, "parent_id").as_deref(), args.get("concurrency").and_then(|v| v.as_u64()).map(|v| v as usize))),

        // Environment
        "list_environments" => handlers::list_environments(conn),
        "create_environment" => handlers::create_environment(conn, &get_str(args, "name")?),
        "set_active_environment" => handlers::set_active_environment(conn, &get_str(args, "id")?),
        "get_active_environment" => handlers::get_active_environment(conn),
        "save_env_variables" => handlers::save_env_variables(conn, &get_str(args, "environment_id")?, args.get("variables").cloned().unwrap_or(json!([]))),
        "delete_environment" => handlers::delete_environment(conn, &get_str(args, "id")?),

        // History
        "list_history" => handlers::list_history(conn, get_opt_str(args, "status").as_deref(), get_opt_str(args, "method").as_deref(), get_opt_str(args, "keyword").as_deref(), args.get("limit").and_then(|v| v.as_u64()).map(|v| v as u32)),
        "get_history_stats" => handlers::get_history_stats(conn),
        "list_item_runs" => handlers::list_item_runs(conn, &get_str(args, "item_id")?, args.get("limit").and_then(|v| v.as_u64()).map(|v| v as u32)),

        // Group
        "list_groups" => handlers::list_groups(conn),
        "create_group" => handlers::create_group(conn, &get_str(args, "name")?, get_opt_str(args, "parent_id").as_deref()),
        "delete_group" => handlers::delete_group(conn, &get_str(args, "id")?),

        _ => Err(format!("Unknown tool: {name}")),
    }
}

fn get_str(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Missing required argument: {key}"))
}

fn get_opt_str(args: &Value, key: &str) -> Option<String> {
    args.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}
