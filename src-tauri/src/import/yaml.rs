use rusqlite::Connection;
use std::path::{Path, PathBuf};

#[derive(Debug, serde::Deserialize)]
pub struct YamlCase {
    pub name: String,
    pub category: Option<String>,
    pub endpoint: Option<String>,
    pub scenarios: Vec<YamlScenario>,
}

#[derive(Debug, serde::Deserialize)]
pub struct YamlScenario {
    pub id: String,
    pub description: Option<String>,
    pub payload: Option<serde_json::Value>,
    pub form_data: Option<serde_json::Value>,
    pub multipart_fields: Option<serde_json::Value>,
    pub multipart_files: Option<serde_json::Value>,
    pub content_type: Option<String>,
    pub expect: Option<YamlExpect>,
    pub protocol: Option<String>,
    pub ws_endpoint: Option<String>,
    pub ws_payload: Option<serde_json::Value>,
}

#[derive(Debug, serde::Deserialize)]
pub struct YamlExpect {
    pub status: Option<u16>,
}

#[derive(Debug, serde::Serialize)]
pub struct ImportResult {
    pub collections_created: u32,
    pub collections_updated: u32,
    pub requests_created: u32,
    pub requests_updated: u32,
}

/// 递归查找目录下所有 YAML 文件
pub fn find_yaml_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                files.extend(find_yaml_files(&path));
            } else if path
                .extension()
                .is_some_and(|ext| ext == "yml" || ext == "yaml")
            {
                files.push(path);
            }
        }
    }
    files.sort();
    files
}

/// 导入单个 YAML case 到数据库
pub fn import_single_case(
    conn: &Connection,
    case: &YamlCase,
    result: &mut ImportResult,
    assets_dir: &Path,
) -> Result<(), String> {
    let category = case.category.as_deref().unwrap_or("text");
    let endpoint = case.endpoint.as_deref().unwrap_or("");

    let group_id = find_or_create_group(conn, category)?;

    let collection_id = match find_collection_by_name(conn, &case.name) {
        Some(id) => {
            crate::db::collection::update(conn, &id, None, None, Some(Some(&group_id)), None)
                .map_err(|e| e.to_string())?;
            result.collections_updated += 1;
            id
        }
        None => {
            let col = crate::db::collection::create(conn, &case.name, "", Some(&group_id))
                .map_err(|e| e.to_string())?;
            result.collections_created += 1;
            col.id
        }
    };

    let existing_items =
        crate::db::item::list_by_collection(conn, &collection_id).map_err(|e| e.to_string())?;

    for (idx, scenario) in case.scenarios.iter().enumerate() {
        let expect_status = scenario
            .expect
            .as_ref()
            .and_then(|e| e.status)
            .unwrap_or(200);
        let is_ws = scenario.protocol.as_deref() == Some("websocket");

        let (body_type, body_content) = if is_ws {
            let payload = scenario
                .ws_payload
                .as_ref()
                .map(|v| serde_json::to_string_pretty(v).unwrap_or_default())
                .unwrap_or_default();
            ("json".to_string(), payload)
        } else {
            build_body(scenario, assets_dir)
        };

        let item_endpoint = if is_ws {
            scenario.ws_endpoint.as_deref().unwrap_or(endpoint)
        } else {
            endpoint
        };

        let protocol = if is_ws { Some("websocket") } else { None };
        let headers = build_headers(scenario);
        let existing = existing_items.iter().find(|i| i.name == scenario.id);

        match existing {
            Some(item) => {
                crate::db::item::update(
                    conn,
                    &item.id,
                    &crate::models::item::UpdateItemPayload {
                        name: Some(scenario.id.clone()),
                        method: Some("POST".to_string()),
                        url: Some(item_endpoint.to_string()),
                        headers: Some(headers.clone()),
                        body_type: Some(body_type.clone()),
                        body_content: Some(body_content.clone()),
                        description: scenario.description.clone(),
                        expect_status: Some(expect_status),
                        protocol: protocol.map(|s| s.to_string()),
                        ..Default::default()
                    },
                )
                .map_err(|e| e.to_string())?;
                result.requests_updated += 1;
            }
            None => {
                let item = crate::db::item::create(
                    conn,
                    &collection_id,
                    None,
                    "request",
                    &scenario.id,
                    "POST",
                )
                .map_err(|e| e.to_string())?;
                crate::db::item::update(
                    conn,
                    &item.id,
                    &crate::models::item::UpdateItemPayload {
                        url: Some(item_endpoint.to_string()),
                        headers: Some(headers.clone()),
                        body_type: Some(body_type.clone()),
                        body_content: Some(body_content.clone()),
                        description: scenario.description.clone(),
                        expect_status: Some(expect_status),
                        protocol: protocol.map(|s| s.to_string()),
                        ..Default::default()
                    },
                )
                .map_err(|e| e.to_string())?;
                crate::db::assertion::create(
                    conn,
                    &item.id,
                    "status_code",
                    "",
                    "eq",
                    &expect_status.to_string(),
                )
                .map_err(|e| e.to_string())?;
                result.requests_created += 1;
            }
        }

        if let Some(item) = existing {
            conn.execute(
                "UPDATE collection_items SET sort_order = ?1 WHERE id = ?2",
                rusqlite::params![idx as i32, item.id],
            )
            .ok();
        }
    }

    Ok(())
}

fn find_collection_by_name(conn: &Connection, name: &str) -> Option<String> {
    conn.query_row(
        "SELECT id FROM collections WHERE name = ?1",
        rusqlite::params![name],
        |row| row.get::<_, String>(0),
    )
    .ok()
}

fn find_or_create_group(conn: &Connection, name: &str) -> Result<String, String> {
    if let Ok(id) = conn.query_row(
        "SELECT id FROM groups WHERE name = ?1",
        rusqlite::params![name],
        |row| row.get::<_, String>(0),
    ) {
        return Ok(id);
    }
    let group = crate::db::group::create(conn, name, None).map_err(|e| e.to_string())?;
    Ok(group.id)
}

fn build_body(scenario: &YamlScenario, assets_dir: &Path) -> (String, String) {
    let ct = scenario.content_type.as_deref().unwrap_or("");

    if let Some(ref payload) = scenario.payload {
        return (
            "json".to_string(),
            serde_json::to_string_pretty(payload).unwrap_or_default(),
        );
    }

    if ct == "form-data" || ct == "application/x-www-form-urlencoded" {
        if let Some(ref fd) = scenario.form_data {
            let kvs = obj_to_kvs(fd);
            return (
                "urlencoded".to_string(),
                serde_json::to_string(&kvs).unwrap_or_default(),
            );
        }
    }

    if ct == "multipart" {
        let mut kvs: Vec<serde_json::Value> = Vec::new();
        if let Some(ref fields) = scenario.multipart_fields {
            kvs.extend(obj_to_kvs(fields));
        }
        if let Some(ref files) = scenario.multipart_files {
            if let Some(obj) = files.as_object() {
                for (field_name, file_info) in obj {
                    let filename = file_info
                        .get("filename")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let file_path = assets_dir.join(filename);
                    let path_str = if file_path.exists() {
                        file_path.to_string_lossy().to_string()
                    } else {
                        filename.to_string()
                    };
                    kvs.push(serde_json::json!({
                        "key": field_name, "value": path_str, "enabled": true, "fieldType": "file"
                    }));
                }
            }
        }
        if !kvs.is_empty() {
            return (
                "form-data".to_string(),
                serde_json::to_string(&kvs).unwrap_or_default(),
            );
        }
    }

    if let Some(ref fd) = scenario.form_data {
        let kvs = obj_to_kvs(fd);
        return (
            "urlencoded".to_string(),
            serde_json::to_string(&kvs).unwrap_or_default(),
        );
    }

    ("none".to_string(), String::new())
}

/// JSON object → [{key, value, enabled}] 数组
fn obj_to_kvs(val: &serde_json::Value) -> Vec<serde_json::Value> {
    val.as_object()
        .map(|obj| {
            obj.iter()
                .map(|(k, v)| {
                    serde_json::json!({
                        "key": k,
                        "value": v.as_str().unwrap_or(&v.to_string()),
                        "enabled": true
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init::create_test_db;

    fn make_case(name: &str, scenarios: Vec<YamlScenario>) -> YamlCase {
        YamlCase {
            name: name.into(),
            category: None,
            endpoint: Some("http://api.example.com".into()),
            scenarios,
        }
    }

    fn make_scenario(id: &str) -> YamlScenario {
        YamlScenario {
            id: id.into(),
            description: Some("test scenario".into()),
            payload: Some(serde_json::json!({"key": "value"})),
            form_data: None,
            multipart_fields: None,
            multipart_files: None,
            content_type: None,
            expect: Some(YamlExpect { status: Some(200) }),
            protocol: None,
            ws_endpoint: None,
            ws_payload: None,
        }
    }

    #[test]
    fn test_import_single_case_basic() {
        let conn = create_test_db();
        let case = make_case("TestAPI", vec![make_scenario("login")]);
        let mut result = ImportResult {
            collections_created: 0,
            collections_updated: 0,
            requests_created: 0,
            requests_updated: 0,
        };
        let r = import_single_case(&conn, &case, &mut result, Path::new("/tmp"));
        assert!(r.is_ok(), "import failed: {:?}", r.err());
        assert_eq!(result.collections_created, 1);
        assert_eq!(result.requests_created, 1);
    }

    #[test]
    fn test_import_multiple_scenarios() {
        let conn = create_test_db();
        let case = make_case(
            "TestAPI",
            vec![
                make_scenario("login"),
                make_scenario("logout"),
                make_scenario("profile"),
            ],
        );
        let mut result = ImportResult {
            collections_created: 0,
            collections_updated: 0,
            requests_created: 0,
            requests_updated: 0,
        };
        import_single_case(&conn, &case, &mut result, Path::new("/tmp")).unwrap();
        assert_eq!(result.requests_created, 3);
    }

    #[test]
    fn test_import_creates_group_from_category() {
        let conn = create_test_db();
        let mut case = make_case("TestAPI", vec![make_scenario("login")]);
        case.category = Some("Authentication".into());
        let mut result = ImportResult {
            collections_created: 0,
            collections_updated: 0,
            requests_created: 0,
            requests_updated: 0,
        };
        import_single_case(&conn, &case, &mut result, Path::new("/tmp")).unwrap();
        // 验证 group 被创建
        let group_id: String = conn
            .query_row(
                "SELECT id FROM groups WHERE name = 'Authentication'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!group_id.is_empty());
    }

    #[test]
    fn test_import_update_existing_collection() {
        let conn = create_test_db();
        let case = make_case("TestAPI", vec![make_scenario("login")]);
        let mut r1 = ImportResult {
            collections_created: 0,
            collections_updated: 0,
            requests_created: 0,
            requests_updated: 0,
        };
        import_single_case(&conn, &case, &mut r1, Path::new("/tmp")).unwrap();
        assert_eq!(r1.collections_created, 1);

        // 再次导入同名集合 → 更新
        let mut r2 = ImportResult {
            collections_created: 0,
            collections_updated: 0,
            requests_created: 0,
            requests_updated: 0,
        };
        import_single_case(&conn, &case, &mut r2, Path::new("/tmp")).unwrap();
        assert_eq!(r2.collections_updated, 1);
        assert_eq!(r2.collections_created, 0);
        assert_eq!(r2.requests_updated, 1);
    }

    #[test]
    fn test_import_websocket_scenario() {
        let conn = create_test_db();
        let mut scenario = make_scenario("ws-test");
        scenario.protocol = Some("websocket".into());
        scenario.ws_endpoint = Some("ws://example.com/ws".into());
        scenario.ws_payload = Some(serde_json::json!({"action": "subscribe"}));
        scenario.payload = None;
        let case = make_case("WS API", vec![scenario]);
        let mut result = ImportResult {
            collections_created: 0,
            collections_updated: 0,
            requests_created: 0,
            requests_updated: 0,
        };
        import_single_case(&conn, &case, &mut result, Path::new("/tmp")).unwrap();
        assert_eq!(result.requests_created, 1);
    }

    #[test]
    fn test_import_optional_fields_none() {
        let conn = create_test_db();
        let case = YamlCase {
            name: "Minimal".into(),
            category: None,
            endpoint: None,
            scenarios: vec![YamlScenario {
                id: "test".into(),
                description: None,
                payload: None,
                form_data: None,
                multipart_fields: None,
                multipart_files: None,
                content_type: None,
                expect: None,
                protocol: None,
                ws_endpoint: None,
                ws_payload: None,
            }],
        };
        let mut result = ImportResult {
            collections_created: 0,
            collections_updated: 0,
            requests_created: 0,
            requests_updated: 0,
        };
        let r = import_single_case(&conn, &case, &mut result, Path::new("/tmp"));
        assert!(r.is_ok());
    }

    // ─── build_body ─────────────────────────────────────────
    #[test]
    fn test_build_body_json_payload() {
        let scenario = make_scenario("test");
        let (body_type, body_content) = build_body(&scenario, Path::new("/tmp"));
        assert_eq!(body_type, "json");
        assert!(body_content.contains("key"));
    }

    #[test]
    fn test_build_body_form_data() {
        let scenario = YamlScenario {
            id: "test".into(),
            description: None,
            payload: None,
            form_data: Some(serde_json::json!({"user": "admin", "pass": "123"})),
            multipart_fields: None,
            multipart_files: None,
            content_type: Some("application/x-www-form-urlencoded".into()),
            expect: None,
            protocol: None,
            ws_endpoint: None,
            ws_payload: None,
        };
        let (body_type, _) = build_body(&scenario, Path::new("/tmp"));
        assert_eq!(body_type, "urlencoded");
    }

    #[test]
    fn test_build_body_none() {
        let scenario = YamlScenario {
            id: "test".into(),
            description: None,
            payload: None,
            form_data: None,
            multipart_fields: None,
            multipart_files: None,
            content_type: None,
            expect: None,
            protocol: None,
            ws_endpoint: None,
            ws_payload: None,
        };
        let (body_type, body_content) = build_body(&scenario, Path::new("/tmp"));
        assert_eq!(body_type, "none");
        assert!(body_content.is_empty());
    }

    // ─── obj_to_kvs ─────────────────────────────────────────
    #[test]
    fn test_obj_to_kvs() {
        let obj = serde_json::json!({"user": "admin"});
        let kvs = obj_to_kvs(&obj);
        assert_eq!(kvs.len(), 1);
        assert_eq!(kvs[0]["key"], "user");
        assert_eq!(kvs[0]["value"], "admin");
    }

    #[test]
    fn test_obj_to_kvs_non_object() {
        let arr = serde_json::json!([1, 2, 3]);
        let kvs = obj_to_kvs(&arr);
        assert!(kvs.is_empty());
    }

    // ─── build_headers ──────────────────────────────────────
    #[test]
    fn test_build_headers_json() {
        let scenario = make_scenario("test");
        let headers = build_headers(&scenario);
        assert!(headers.contains("application/json"));
    }

    #[test]
    fn test_build_headers_form() {
        let mut scenario = make_scenario("test");
        scenario.payload = None;
        scenario.content_type = Some("application/x-www-form-urlencoded".into());
        let headers = build_headers(&scenario);
        assert!(headers.contains("application/x-www-form-urlencoded"));
    }
}

fn build_headers(scenario: &YamlScenario) -> String {
    let ct = scenario.content_type.as_deref().unwrap_or("");
    let content_type = if scenario.payload.is_some() {
        "application/json"
    } else if ct == "form-data" || ct == "application/x-www-form-urlencoded" {
        "application/x-www-form-urlencoded"
    } else if ct == "multipart" {
        "multipart/form-data"
    } else {
        "application/json"
    };

    serde_json::to_string(&[serde_json::json!({
        "key": "Content-Type", "value": content_type, "enabled": true
    })])
    .unwrap_or_default()
}
