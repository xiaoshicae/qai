use std::path::PathBuf;
use tauri::State;

use crate::db::init::DbState;

/// YAML 场景文件结构
#[derive(Debug, serde::Deserialize)]
struct YamlCase {
    model: String,
    name: String,
    category: Option<String>,
    subcategory: Option<String>,
    endpoint: Option<String>,
    scenarios: Vec<YamlScenario>,
}

#[derive(Debug, serde::Deserialize)]
struct YamlScenario {
    id: String,
    description: Option<String>,
    #[serde(default)]
    stream: bool,
    // JSON body
    payload: Option<serde_json::Value>,
    // form-data
    form_data: Option<serde_json::Value>,
    // multipart
    multipart_fields: Option<serde_json::Value>,
    // content_type override
    content_type: Option<String>,
    // expect
    expect: Option<YamlExpect>,
}

#[derive(Debug, serde::Deserialize)]
struct YamlExpect {
    status: Option<u16>,
}

/// 导入结果
#[derive(Debug, serde::Serialize)]
pub struct ImportResult {
    pub collections_created: u32,
    pub collections_updated: u32,
    pub requests_created: u32,
    pub requests_updated: u32,
}

#[tauri::command]
pub fn import_yaml_cases(
    db: State<'_, DbState>,
    dir_path: String,
    clear_first: Option<bool>,
) -> Result<ImportResult, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let base = PathBuf::from(&dir_path);

    if !base.exists() {
        return Err(format!("目录不存在: {}", dir_path));
    }

    // 清空所有现有数据
    if clear_first.unwrap_or(false) {
        conn.execute_batch(
            "DELETE FROM executions; DELETE FROM assertions; DELETE FROM requests; DELETE FROM folders; DELETE FROM collections;"
        ).map_err(|e| e.to_string())?;
    }

    let mut result = ImportResult {
        collections_created: 0,
        collections_updated: 0,
        requests_created: 0,
        requests_updated: 0,
    };

    // 递归查找所有 .yml 文件
    let yaml_files = find_yaml_files(&base);
    if yaml_files.is_empty() {
        return Err("未找到 YAML 文件".to_string());
    }

    for path in &yaml_files {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("读取文件失败 {:?}: {}", path, e))?;
        let case: YamlCase = serde_yaml::from_str(&content)
            .map_err(|e| format!("解析 YAML 失败 {:?}: {}", path, e))?;

        import_single_case(&conn, &case, &mut result)
            .map_err(|e| format!("导入 {} 失败: {}", case.name, e))?;
    }

    Ok(result)
}

fn find_yaml_files(dir: &PathBuf) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                files.extend(find_yaml_files(&path));
            } else if path.extension().is_some_and(|ext| ext == "yml" || ext == "yaml") {
                files.push(path);
            }
        }
    }
    files.sort();
    files
}

fn import_single_case(
    conn: &rusqlite::Connection,
    case: &YamlCase,
    result: &mut ImportResult,
) -> Result<(), String> {
    let category = case.category.as_deref().unwrap_or("text");
    let subcategory = case.subcategory.as_deref();
    let endpoint = case.endpoint.as_deref().unwrap_or("");

    // 查找或创建 collection（按 model 名匹配）
    let collection_id = match find_collection_by_name(conn, &case.name) {
        Some(id) => {
            // 更新 category/subcategory/endpoint
            crate::db::collection::update_meta(
                conn,
                &id,
                None,
                None,
                Some(category),
                Some(endpoint),
                subcategory,
            ).map_err(|e| e.to_string())?;
            result.collections_updated += 1;
            id
        }
        None => {
            let col = crate::db::collection::create(conn, &case.name, "", Some(category), Some(endpoint), subcategory)
                .map_err(|e| e.to_string())?;
            result.collections_created += 1;
            col.id
        }
    };

    // 获取现有请求列表
    let existing_requests = crate::db::request::list_by_collection(conn, &collection_id)
        .map_err(|e| e.to_string())?;

    for (idx, scenario) in case.scenarios.iter().enumerate() {
        let expect_status = scenario.expect.as_ref().and_then(|e| e.status).unwrap_or(200);

        // 根据 content_type 和字段判断 body_type 和 body_content
        let (body_type, body_content) = build_body(scenario);

        // 构建 headers
        let headers = build_headers(scenario);

        // 查找现有同名请求
        let existing = existing_requests.iter().find(|r| r.name == scenario.id);

        match existing {
            Some(req) => {
                // 更新现有请求
                crate::db::request::update(
                    conn,
                    &req.id,
                    Some(&scenario.id),
                    Some("POST"),
                    Some(endpoint),
                    Some(&headers),
                    None, // query_params
                    Some(&body_type),
                    Some(&body_content),
                    None, // extract_rules
                    scenario.description.as_deref(),
                    Some(expect_status),
                ).map_err(|e| e.to_string())?;
                result.requests_updated += 1;
            }
            None => {
                // 创建新请求
                let req = crate::db::request::create(
                    conn,
                    &collection_id,
                    None,
                    &scenario.id,
                    "POST",
                ).map_err(|e| e.to_string())?;

                crate::db::request::update(
                    conn,
                    &req.id,
                    None, // name 已设
                    None, // method 已设
                    Some(endpoint),
                    Some(&headers),
                    None,
                    Some(&body_type),
                    Some(&body_content),
                    None,
                    scenario.description.as_deref(),
                    Some(expect_status),
                ).map_err(|e| e.to_string())?;

                // 为 status_code 断言自动创建
                create_status_assertion(conn, &req.id, expect_status)
                    .map_err(|e| e.to_string())?;

                result.requests_created += 1;
            }
        }

        // 更新 sort_order
        if let Some(req) = existing {
            conn.execute(
                "UPDATE requests SET sort_order = ?1 WHERE id = ?2",
                rusqlite::params![idx as i32, req.id],
            ).ok();
        }
    }

    Ok(())
}

fn find_collection_by_name(conn: &rusqlite::Connection, name: &str) -> Option<String> {
    conn.query_row(
        "SELECT id FROM collections WHERE name = ?1",
        rusqlite::params![name],
        |row| row.get::<_, String>(0),
    ).ok()
}

fn build_body(scenario: &YamlScenario) -> (String, String) {
    let ct = scenario.content_type.as_deref().unwrap_or("");

    if let Some(ref payload) = scenario.payload {
        return ("json".to_string(), serde_json::to_string_pretty(payload).unwrap_or_default());
    }

    if ct == "form-data" || ct == "application/x-www-form-urlencoded" {
        if let Some(ref fd) = scenario.form_data {
            // 转为 KV 数组格式
            let kvs: Vec<serde_json::Value> = fd.as_object()
                .map(|obj| {
                    obj.iter().map(|(k, v)| {
                        serde_json::json!({
                            "key": k,
                            "value": v.as_str().unwrap_or(&v.to_string()),
                            "enabled": true
                        })
                    }).collect()
                })
                .unwrap_or_default();
            return ("urlencoded".to_string(), serde_json::to_string(&kvs).unwrap_or_default());
        }
    }

    if ct == "multipart" {
        if let Some(ref fields) = scenario.multipart_fields {
            let kvs: Vec<serde_json::Value> = fields.as_object()
                .map(|obj| {
                    obj.iter().map(|(k, v)| {
                        serde_json::json!({
                            "key": k,
                            "value": v.as_str().unwrap_or(&v.to_string()),
                            "enabled": true
                        })
                    }).collect()
                })
                .unwrap_or_default();
            return ("form-data".to_string(), serde_json::to_string(&kvs).unwrap_or_default());
        }
    }

    // 如果有 form_data 但没指定 content_type
    if let Some(ref fd) = scenario.form_data {
        let kvs: Vec<serde_json::Value> = fd.as_object()
            .map(|obj| {
                obj.iter().map(|(k, v)| {
                    serde_json::json!({
                        "key": k,
                        "value": v.as_str().unwrap_or(&v.to_string()),
                        "enabled": true
                    })
                }).collect()
            })
            .unwrap_or_default();
        return ("urlencoded".to_string(), serde_json::to_string(&kvs).unwrap_or_default());
    }

    ("none".to_string(), String::new())
}

fn build_headers(scenario: &YamlScenario) -> String {
    let ct = scenario.content_type.as_deref().unwrap_or("");
    let mut headers = Vec::new();

    // Content-Type header
    let content_type = if scenario.payload.is_some() {
        "application/json"
    } else if ct == "form-data" || ct == "application/x-www-form-urlencoded" {
        "application/x-www-form-urlencoded"
    } else if ct == "multipart" {
        "multipart/form-data"
    } else {
        "application/json"
    };

    headers.push(serde_json::json!({
        "key": "Content-Type",
        "value": content_type,
        "enabled": true
    }));

    serde_json::to_string(&headers).unwrap_or_default()
}

fn create_status_assertion(
    conn: &rusqlite::Connection,
    request_id: &str,
    expect_status: u16,
) -> Result<(), String> {
    crate::db::assertion::create(
        conn,
        request_id,
        "status_code",
        "",
        "eq",
        &expect_status.to_string(),
    ).map_err(|e| e.to_string())?;
    Ok(())
}
