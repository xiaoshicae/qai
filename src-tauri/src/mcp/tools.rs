use rusqlite::Connection;
use serde_json::{json, Value};

/// 返回所有可用的 MCP tools 定义
pub fn list_tools() -> Vec<Value> {
    vec![
        json!({
            "name": "list_collections",
            "description": "列出所有测试集（集合）。返回 id、name、category、endpoint 等信息。",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "get_collection",
            "description": "获取测试集详情，包括所有测试用例（请求）。",
            "inputSchema": {
                "type": "object",
                "properties": { "collection_id": { "type": "string", "description": "测试集 ID" } },
                "required": ["collection_id"]
            }
        }),
        json!({
            "name": "create_collection",
            "description": "创建一个新的测试集。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "测试集名称" },
                    "description": { "type": "string", "description": "描述（通常是 model ID）" },
                    "category": { "type": "string", "description": "分类如 text/audio/image/video" },
                    "endpoint": { "type": "string", "description": "默认 API endpoint" }
                },
                "required": ["name"]
            }
        }),
        json!({
            "name": "create_request",
            "description": "在测试集中创建一个测试用例（API 请求）。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "collection_id": { "type": "string" },
                    "name": { "type": "string", "description": "用例名称如 health-check" },
                    "method": { "type": "string", "description": "HTTP 方法 GET/POST/PUT/DELETE" },
                    "url": { "type": "string", "description": "完整请求 URL" },
                    "headers": { "type": "string", "description": "JSON 数组 [{\"key\":\"Auth\",\"value\":\"Bearer xx\",\"enabled\":true}]" },
                    "body_type": { "type": "string", "description": "none/json/form/raw" },
                    "body_content": { "type": "string", "description": "请求体内容" },
                    "description": { "type": "string", "description": "用例描述" },
                    "expect_status": { "type": "number", "description": "期望 HTTP 状态码，默认 200" }
                },
                "required": ["collection_id", "name", "method"]
            }
        }),
        json!({
            "name": "update_request",
            "description": "修改已有的测试用例。只需传入要修改的字段。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "name": { "type": "string" },
                    "method": { "type": "string" },
                    "url": { "type": "string" },
                    "headers": { "type": "string" },
                    "body_type": { "type": "string" },
                    "body_content": { "type": "string" },
                    "description": { "type": "string" },
                    "expect_status": { "type": "number" }
                },
                "required": ["id"]
            }
        }),
        json!({
            "name": "delete_request",
            "description": "删除一个测试用例。",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"]
            }
        }),
        json!({
            "name": "create_assertion",
            "description": "为测试用例添加断言。类型: status_code/json_path/body_contains/response_time/header_contains。操作符: eq/neq/gt/lt/contains/exists/matches。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "request_id": { "type": "string" },
                    "assertion_type": { "type": "string" },
                    "expression": { "type": "string", "description": "JSONPath 或 header 名称" },
                    "operator": { "type": "string" },
                    "expected": { "type": "string" }
                },
                "required": ["request_id", "assertion_type", "operator", "expected"]
            }
        }),
        json!({
            "name": "list_assertions",
            "description": "列出测试用例的所有断言。",
            "inputSchema": {
                "type": "object",
                "properties": { "request_id": { "type": "string" } },
                "required": ["request_id"]
            }
        }),
        json!({
            "name": "get_request",
            "description": "获取单个测试用例的完整详情。",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"]
            }
        }),
        json!({
            "name": "delete_collection",
            "description": "删除整个测试集及其所有用例。",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"]
            }
        }),
    ]
}

/// 执行 MCP tool 调用
pub fn call_tool(conn: &Connection, name: &str, args: &Value) -> Result<String, String> {
    match name {
        "list_collections" => {
            let cols = qai_lib::db::collection::list_all(conn).map_err(|e| e.to_string())?;
            Ok(serde_json::to_string_pretty(&cols).unwrap())
        }

        "get_collection" => {
            let id = get_str(args, "collection_id")?;
            let col = qai_lib::db::collection::get(conn, &id).map_err(|e| e.to_string())?;
            let requests = qai_lib::db::request::list_by_collection(conn, &id).map_err(|e| e.to_string())?;
            Ok(serde_json::to_string_pretty(&json!({ "collection": col, "requests": requests })).unwrap())
        }

        "create_collection" => {
            let name = get_str(args, "name")?;
            let desc = args.get("description").and_then(|v| v.as_str()).unwrap_or("");
            let category = args.get("category").and_then(|v| v.as_str());
            let endpoint = args.get("endpoint").and_then(|v| v.as_str());
            let subcategory = args.get("subcategory").and_then(|v| v.as_str());
            let col = qai_lib::db::collection::create(conn, &name, desc, category, endpoint, subcategory)
                .map_err(|e| e.to_string())?;
            Ok(serde_json::to_string_pretty(&col).unwrap())
        }

        "create_request" => {
            let collection_id = get_str(args, "collection_id")?;
            let name = get_str(args, "name")?;
            let method = args.get("method").and_then(|v| v.as_str()).unwrap_or("GET");
            let req = qai_lib::db::request::create(conn, &collection_id, None, &name, method)
                .map_err(|e| e.to_string())?;

            // 如果有额外字段，立即 update
            let url = args.get("url").and_then(|v| v.as_str());
            let headers = args.get("headers").and_then(|v| v.as_str());
            let body_type = args.get("body_type").and_then(|v| v.as_str());
            let body_content = args.get("body_content").and_then(|v| v.as_str());
            let description = args.get("description").and_then(|v| v.as_str());
            let expect_status = args.get("expect_status").and_then(|v| v.as_u64()).map(|v| v as u16);

            let updated = qai_lib::db::request::update(
                conn, &req.id, None, None, url, headers, None, body_type, body_content, None, description, expect_status,
            ).map_err(|e| e.to_string())?;

            Ok(serde_json::to_string_pretty(&updated).unwrap())
        }

        "update_request" => {
            let id = get_str(args, "id")?;
            let updated = qai_lib::db::request::update(
                conn, &id,
                args.get("name").and_then(|v| v.as_str()),
                args.get("method").and_then(|v| v.as_str()),
                args.get("url").and_then(|v| v.as_str()),
                args.get("headers").and_then(|v| v.as_str()),
                None,
                args.get("body_type").and_then(|v| v.as_str()),
                args.get("body_content").and_then(|v| v.as_str()),
                None,
                args.get("description").and_then(|v| v.as_str()),
                args.get("expect_status").and_then(|v| v.as_u64()).map(|v| v as u16),
            ).map_err(|e| e.to_string())?;
            Ok(serde_json::to_string_pretty(&updated).unwrap())
        }

        "delete_request" => {
            let id = get_str(args, "id")?;
            qai_lib::db::request::delete(conn, &id).map_err(|e| e.to_string())?;
            Ok(format!("Deleted request {id}"))
        }

        "create_assertion" => {
            let request_id = get_str(args, "request_id")?;
            let atype = get_str(args, "assertion_type")?;
            let expression = args.get("expression").and_then(|v| v.as_str()).unwrap_or("");
            let operator = get_str(args, "operator")?;
            let expected = get_str(args, "expected")?;
            let assertion = qai_lib::db::assertion::create(conn, &request_id, &atype, expression, &operator, &expected)
                .map_err(|e| e.to_string())?;
            Ok(serde_json::to_string_pretty(&assertion).unwrap())
        }

        "list_assertions" => {
            let request_id = get_str(args, "request_id")?;
            let list = qai_lib::db::assertion::list_by_request(conn, &request_id).map_err(|e| e.to_string())?;
            Ok(serde_json::to_string_pretty(&list).unwrap())
        }

        "get_request" => {
            let id = get_str(args, "id")?;
            let req = qai_lib::db::request::get(conn, &id).map_err(|e| e.to_string())?;
            Ok(serde_json::to_string_pretty(&req).unwrap())
        }

        "delete_collection" => {
            let id = get_str(args, "id")?;
            qai_lib::db::collection::delete(conn, &id).map_err(|e| e.to_string())?;
            Ok(format!("Deleted collection {id}"))
        }

        _ => Err(format!("Unknown tool: {name}")),
    }
}

fn get_str(args: &Value, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Missing required argument: {key}"))
}
