use rusqlite::Connection;
use serde_json::Value;

#[derive(Debug, serde::Serialize)]
pub struct PostmanImportResult {
    pub collection_id: String,
    pub collection_name: String,
    pub requests_imported: u32,
    pub folders_imported: u32,
}

/// Postman Collection v2.1 导入入口
pub fn import(
    conn: &Connection,
    json: &str,
    group_id: Option<&str>,
) -> Result<PostmanImportResult, String> {
    let root: Value = serde_json::from_str(json).map_err(|e| format!("JSON 解析失败: {e}"))?;
    let info = root.get("info").ok_or("缺少 Postman info 字段")?;
    let name = info
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Imported")
        .to_string();
    let items = root
        .get("item")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let col = crate::db::collection::create(conn, &name, "Imported from Postman", group_id)
        .map_err(|e| e.to_string())?;

    let mut requests = 0u32;
    let mut folders = 0u32;
    import_items(conn, &col.id, None, &items, &mut requests, &mut folders)?;

    Ok(PostmanImportResult {
        collection_id: col.id,
        collection_name: name,
        requests_imported: requests,
        folders_imported: folders,
    })
}

fn import_items(
    conn: &Connection,
    collection_id: &str,
    parent_id: Option<&str>,
    items: &[Value],
    requests: &mut u32,
    folders: &mut u32,
) -> Result<(), String> {
    for item in items {
        let item_name = item
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("Untitled")
            .to_string();
        let has_children = item
            .get("item")
            .and_then(|v| v.as_array())
            .map(|a| !a.is_empty())
            .unwrap_or(false);

        if has_children {
            let folder = crate::db::item::create(
                conn,
                collection_id,
                parent_id,
                "folder",
                &item_name,
                "GET",
            )
            .map_err(|e| e.to_string())?;
            *folders += 1;
            let children = item
                .get("item")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            import_items(
                conn,
                collection_id,
                Some(&folder.id),
                &children,
                requests,
                folders,
            )?;
        } else if let Some(req) = item.get("request") {
            import_request(conn, collection_id, parent_id, &item_name, req, requests)?;
        }
    }
    Ok(())
}

fn import_request(
    conn: &Connection,
    collection_id: &str,
    parent_id: Option<&str>,
    name: &str,
    request: &Value,
    requests: &mut u32,
) -> Result<(), String> {
    let method = request
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("GET")
        .to_uppercase();
    let url_raw = url_string(request.get("url"));
    let headers_kv = parse_headers(request.get("header"));
    let (body_type, body_content) = parse_body(request.get("body"));
    let desc = request
        .get("description")
        .and_then(|v| {
            v.as_str()
                .map(String::from)
                .or_else(|| v.get("content").and_then(|c| c.as_str()).map(String::from))
        })
        .unwrap_or_default();

    let created = crate::db::item::create(conn, collection_id, parent_id, "request", name, &method)
        .map_err(|e| e.to_string())?;
    *requests += 1;

    let query_kv = parse_query_params(request.get("url"));
    let payload = crate::models::item::UpdateItemPayload {
        method: Some(method),
        url: Some(url_raw),
        headers: Some(serde_json::to_string(&headers_kv).unwrap_or_else(|_| "[]".into())),
        query_params: Some(serde_json::to_string(&query_kv).unwrap_or_else(|_| "[]".into())),
        body_type: Some(body_type),
        body_content: Some(body_content),
        description: Some(desc),
        ..Default::default()
    };
    crate::db::item::update(conn, &created.id, &payload).map_err(|e| e.to_string())?;
    Ok(())
}

fn url_string(url: Option<&Value>) -> String {
    let Some(u) = url else { return String::new() };
    if let Some(s) = u.as_str() {
        return s.to_string();
    }
    u.get("raw")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_default()
}

fn parse_headers(header: Option<&Value>) -> Vec<Value> {
    let Some(h) = header.and_then(|x| x.as_array()) else {
        return Vec::new();
    };
    h.iter()
        .map(|x| {
            let key = x.get("key").and_then(|v| v.as_str()).unwrap_or("");
            let val = x.get("value").and_then(|v| v.as_str()).unwrap_or("");
            let disabled = x.get("disabled").and_then(|v| v.as_bool()).unwrap_or(false);
            serde_json::json!({"key": key, "value": val, "enabled": !disabled})
        })
        .collect()
}

fn parse_query_params(url: Option<&Value>) -> Vec<Value> {
    let Some(q) = url
        .and_then(|x| x.as_object())
        .and_then(|u| u.get("query"))
        .and_then(|x| x.as_array())
    else {
        return Vec::new();
    };
    q.iter()
        .map(|x| {
            let key = x.get("key").and_then(|v| v.as_str()).unwrap_or("");
            let val = x.get("value").and_then(|v| v.as_str()).unwrap_or("");
            let disabled = x.get("disabled").and_then(|v| v.as_bool()).unwrap_or(false);
            serde_json::json!({"key": key, "value": val, "enabled": !disabled})
        })
        .collect()
}

fn parse_body(body: Option<&Value>) -> (String, String) {
    let Some(b) = body.and_then(|x| x.as_object()) else {
        return ("none".to_string(), String::new());
    };
    let mode = b.get("mode").and_then(|v| v.as_str()).unwrap_or("raw");
    match mode {
        "raw" => {
            let raw = b.get("raw").and_then(|v| v.as_str()).unwrap_or("");
            let lang = b
                .get("options")
                .and_then(|o| o.get("raw"))
                .and_then(|o| o.get("language"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let bt = if lang == "json"
                || raw.trim_start().starts_with('{')
                || raw.trim_start().starts_with('[')
            {
                "json"
            } else {
                "raw"
            };
            (bt.to_string(), raw.to_string())
        }
        "urlencoded" => {
            let kvs = parse_kv_array(b.get("urlencoded"));
            (
                "urlencoded".to_string(),
                serde_json::to_string(&kvs).unwrap_or_else(|_| "[]".into()),
            )
        }
        "formdata" => {
            let mut kvs: Vec<Value> = Vec::new();
            if let Some(params) = b.get("formdata").and_then(|x| x.as_array()) {
                for p in params {
                    let key = p.get("key").and_then(|v| v.as_str()).unwrap_or("");
                    let typ = p.get("type").and_then(|v| v.as_str()).unwrap_or("text");
                    let val = p.get("value").and_then(|v| v.as_str()).unwrap_or("");
                    let disabled = p.get("disabled").and_then(|v| v.as_bool()).unwrap_or(false);
                    let mut kv =
                        serde_json::json!({"key": key, "value": val, "enabled": !disabled});
                    if typ == "file" {
                        kv["fieldType"] = serde_json::json!("file");
                    }
                    kvs.push(kv);
                }
            }
            (
                "form-data".to_string(),
                serde_json::to_string(&kvs).unwrap_or_else(|_| "[]".into()),
            )
        }
        _ => ("none".to_string(), String::new()),
    }
}

/// 解析 Postman [{key, value, disabled}] 数组为内部 [{key, value, enabled}]
fn parse_kv_array(arr: Option<&Value>) -> Vec<Value> {
    let Some(params) = arr.and_then(|x| x.as_array()) else {
        return Vec::new();
    };
    params
        .iter()
        .map(|p| {
            let key = p.get("key").and_then(|v| v.as_str()).unwrap_or("");
            let val = p.get("value").and_then(|v| v.as_str()).unwrap_or("");
            let disabled = p.get("disabled").and_then(|v| v.as_bool()).unwrap_or(false);
            serde_json::json!({"key": key, "value": val, "enabled": !disabled})
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_url_string_raw() {
        let url = json!({"raw": "https://api.example.com/users"});
        assert_eq!(url_string(Some(&url)), "https://api.example.com/users");
    }

    #[test]
    fn test_url_string_direct() {
        let url = json!("https://example.com");
        assert_eq!(url_string(Some(&url)), "https://example.com");
    }

    #[test]
    fn test_url_string_none() {
        assert_eq!(url_string(None), "");
    }

    #[test]
    fn test_parse_headers() {
        let h = json!([
            {"key": "Content-Type", "value": "application/json"},
            {"key": "X-Token", "value": "abc", "disabled": true}
        ]);
        let result = parse_headers(Some(&h));
        assert_eq!(result.len(), 2);
        assert_eq!(result[0]["enabled"], true);
        assert_eq!(result[1]["enabled"], false);
    }

    #[test]
    fn test_parse_body_raw_json() {
        let body =
            json!({"mode": "raw", "raw": "{\"a\":1}", "options": {"raw": {"language": "json"}}});
        let (bt, content) = parse_body(Some(&body));
        assert_eq!(bt, "json");
        assert_eq!(content, "{\"a\":1}");
    }

    #[test]
    fn test_parse_body_urlencoded() {
        let body = json!({"mode": "urlencoded", "urlencoded": [
            {"key": "user", "value": "admin"}
        ]});
        let (bt, content) = parse_body(Some(&body));
        assert_eq!(bt, "urlencoded");
        let kvs: Vec<Value> = serde_json::from_str(&content).unwrap();
        assert_eq!(kvs[0]["key"], "user");
    }

    #[test]
    fn test_parse_body_formdata_file() {
        let body = json!({"mode": "formdata", "formdata": [
            {"key": "file", "value": "/tmp/a.png", "type": "file"}
        ]});
        let (bt, content) = parse_body(Some(&body));
        assert_eq!(bt, "form-data");
        let kvs: Vec<Value> = serde_json::from_str(&content).unwrap();
        assert_eq!(kvs[0]["fieldType"], "file");
    }

    #[test]
    fn test_parse_body_none() {
        let (bt, content) = parse_body(None);
        assert_eq!(bt, "none");
        assert!(content.is_empty());
    }

    #[test]
    fn test_parse_query_params() {
        let url = json!({"raw": "https://a.com", "query": [
            {"key": "page", "value": "1"},
            {"key": "disabled_param", "value": "x", "disabled": true}
        ]});
        let result = parse_query_params(Some(&url));
        assert_eq!(result.len(), 2);
        assert_eq!(result[0]["key"], "page");
        assert_eq!(result[1]["enabled"], false);
    }
}
