use std::path::PathBuf;
use tauri::State;

use crate::db::init::DbState;
use crate::errors::AppError;
use crate::import::postman::PostmanImportResult;
use crate::import::yaml::{ImportResult, YamlCase};

// ─── 导出/导入 JSON 全量数据 ───

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportData {
    pub version: String,
    pub exported_at: String,
    pub groups: Vec<crate::models::group::Group>,
    pub collections: Vec<crate::models::collection::Collection>,
    pub collection_items: Vec<crate::models::item::CollectionItem>,
    pub assertions: Vec<crate::models::assertion::Assertion>,
    pub environments: Vec<crate::models::environment::Environment>,
    pub env_variables: Vec<crate::models::environment::EnvVariable>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportStats {
    pub created_collections: u32,
    pub updated_collections: u32,
    pub created_items: u32,
    pub updated_items: u32,
    pub created_assertions: u32,
    pub created_groups: u32,
    pub created_environments: u32,
    pub created_env_variables: u32,
}

#[tauri::command]
pub fn import_yaml_cases(
    db: State<'_, DbState>,
    dir_path: String,
    clear_first: Option<bool>,
) -> Result<ImportResult, AppError> {
    let conn = db.conn()?;
    let base = PathBuf::from(&dir_path);

    if !base.exists() {
        return Err(format!("目录不存在: {}", dir_path).into());
    }

    if clear_first.unwrap_or(false) {
        conn.execute_batch(
            "DELETE FROM executions; DELETE FROM assertions; DELETE FROM collection_items; DELETE FROM collections; DELETE FROM groups;"
        )?;
    }

    let mut result = ImportResult {
        collections_created: 0,
        collections_updated: 0,
        requests_created: 0,
        requests_updated: 0,
    };

    let yaml_files = crate::import::yaml::find_yaml_files(&base);
    if yaml_files.is_empty() {
        return Err("未找到 YAML 文件".into());
    }

    for path in &yaml_files {
        let content =
            std::fs::read_to_string(path).map_err(|e| format!("读取文件失败 {:?}: {}", path, e))?;
        let case: YamlCase = serde_yml::from_str(&content)
            .map_err(|e| format!("解析 YAML 失败 {:?}: {}", path, e))?;

        let assets_dir = path.parent().unwrap_or(&base).join("../assets");
        let assets_dir = if assets_dir.exists() {
            assets_dir
        } else {
            base.join("assets")
        };
        crate::import::yaml::import_single_case(&conn, &case, &mut result, &assets_dir)
            .map_err(|e| format!("导入 {} 失败: {}", case.name, e))?;
    }

    Ok(result)
}

#[tauri::command]
pub fn import_postman_collection(
    db: State<'_, DbState>,
    json: String,
    group_id: Option<String>,
) -> Result<PostmanImportResult, AppError> {
    let conn = db.conn()?;
    Ok(crate::import::postman::import(
        &conn,
        &json,
        group_id.as_deref(),
    )?)
}

/// 导出全部测试用例为 JSON
#[tauri::command]
pub fn export_all_cases(db: State<'_, DbState>) -> Result<String, AppError> {
    let conn = db.conn()?;
    let groups = crate::db::group::list_all(&conn)?;
    let collections = crate::db::collection::list_all(&conn)?;

    // 收集所有 items（按拓扑顺序：父节点在子节点前，确保导入时依赖关系正确）
    let mut all_items = Vec::new();
    for col in &collections {
        let items = crate::db::item::list_by_collection(&conn, &col.id)?;
        // 拓扑排序：先输出 parent_id 为空的，再输出有 parent 的
        let mut remaining = items;
        let mut placed: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut progress = true;
        while progress && !remaining.is_empty() {
            progress = false;
            let mut next_round = Vec::new();
            for item in remaining {
                if item.parent_id.is_none()
                    || item
                        .parent_id
                        .as_ref()
                        .is_some_and(|pid| placed.contains(pid))
                {
                    placed.insert(item.id.clone());
                    all_items.push(item);
                    progress = true;
                } else {
                    next_round.push(item);
                }
            }
            remaining = next_round;
        }
        // 如有循环引用（理论上不应发生），追加剩余
        all_items.extend(remaining);
    }

    // 批量查询所有 assertions
    let item_ids: Vec<String> = all_items.iter().map(|i| i.id.clone()).collect();
    let assertions_map = crate::db::assertion::list_by_items(&conn, &item_ids)?;
    let all_assertions: Vec<_> = assertions_map.into_values().flatten().collect();

    // 导出环境
    let environments = crate::db::environment::list_all(&conn)?;
    let mut all_env_vars = Vec::new();
    for env in &environments {
        let vars = crate::db::environment::list_variables(&conn, &env.id)?;
        all_env_vars.extend(vars);
    }

    let data = ExportData {
        version: "1.0".to_string(),
        exported_at: chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string(),
        groups,
        collections,
        collection_items: all_items,
        assertions: all_assertions,
        environments,
        env_variables: all_env_vars,
    };

    Ok(serde_json::to_string_pretty(&data)?)
}

/// 导入测试用例（mode: "replace" 全量覆盖 / "merge" 按名称合并）
#[tauri::command]
pub fn import_cases(
    db: State<'_, DbState>,
    json: String,
    mode: String,
) -> Result<ImportStats, AppError> {
    let data: ExportData =
        serde_json::from_str(&json).map_err(|e| format!("JSON 解析失败: {e}"))?;

    let conn = db.conn()?;
    let tx = conn.unchecked_transaction()?;

    let stats = if mode == "replace" {
        import_replace(&tx, &data)?
    } else {
        import_merge(&tx, &data)?
    };

    tx.commit()?;
    Ok(stats)
}

fn import_replace(conn: &rusqlite::Connection, data: &ExportData) -> Result<ImportStats, AppError> {
    // 按外键顺序清空
    conn.execute_batch(
        "DELETE FROM executions; DELETE FROM assertions; DELETE FROM collection_items; \
         DELETE FROM collections; DELETE FROM env_variables; DELETE FROM environments; \
         DELETE FROM groups;",
    )?;

    let mut stats = ImportStats {
        created_collections: 0,
        updated_collections: 0,
        created_items: 0,
        updated_items: 0,
        created_assertions: 0,
        created_groups: 0,
        created_environments: 0,
        created_env_variables: 0,
    };

    for g in &data.groups {
        conn.execute(
            "INSERT INTO groups (id, name, parent_id, sort_order) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![g.id, g.name, g.parent_id, g.sort_order],
        )?;
        stats.created_groups += 1;
    }
    for c in &data.collections {
        conn.execute(
            "INSERT INTO collections (id, name, description, group_id, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![c.id, c.name, c.description, c.group_id, c.sort_order, c.created_at, c.updated_at],
        )?;
        stats.created_collections += 1;
    }
    for i in &data.collection_items {
        conn.execute(
            "INSERT INTO collection_items (id, collection_id, parent_id, type, name, sort_order, method, url, headers, query_params, body_type, body_content, extract_rules, description, expect_status, poll_config, protocol, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            rusqlite::params![
                i.id, i.collection_id, i.parent_id, i.item_type, i.name, i.sort_order,
                i.method, i.url, i.headers, i.query_params, i.body_type, i.body_content,
                i.extract_rules, i.description, i.expect_status, i.poll_config, i.protocol,
                i.created_at, i.updated_at
            ],
        )?;
        stats.created_items += 1;
    }
    for a in &data.assertions {
        conn.execute(
            "INSERT INTO assertions (id, item_id, type, expression, operator, expected, enabled, sort_order, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![a.id, a.item_id, a.assertion_type, a.expression, a.operator, a.expected, a.enabled, a.sort_order, a.created_at],
        )?;
        stats.created_assertions += 1;
    }
    for e in &data.environments {
        conn.execute(
            "INSERT INTO environments (id, name, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![e.id, e.name, e.is_active, e.created_at, e.updated_at],
        )?;
        stats.created_environments += 1;
    }
    for v in &data.env_variables {
        conn.execute(
            "INSERT INTO env_variables (id, environment_id, key, value, enabled, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![v.id, v.environment_id, v.key, v.value, v.enabled, v.sort_order],
        )?;
        stats.created_env_variables += 1;
    }

    Ok(stats)
}

fn import_merge(conn: &rusqlite::Connection, data: &ExportData) -> Result<ImportStats, AppError> {
    let mut stats = ImportStats {
        created_collections: 0,
        updated_collections: 0,
        created_items: 0,
        updated_items: 0,
        created_assertions: 0,
        created_groups: 0,
        created_environments: 0,
        created_env_variables: 0,
    };

    // groups: 按 name 匹配
    let mut group_id_map: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for g in &data.groups {
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM groups WHERE name = ?1",
                rusqlite::params![g.name],
                |row| row.get(0),
            )
            .ok();
        let new_id = if let Some(eid) = existing {
            eid
        } else {
            let mapped_parent = g
                .parent_id
                .as_ref()
                .and_then(|pid| group_id_map.get(pid))
                .map(|s| s.as_str());
            let new = crate::db::group::create(conn, &g.name, mapped_parent)?;
            stats.created_groups += 1;
            new.id
        };
        group_id_map.insert(g.id.clone(), new_id);
    }

    // collections: 按 name 匹配
    let mut col_id_map: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for c in &data.collections {
        let mapped_group = c
            .group_id
            .as_ref()
            .and_then(|gid| group_id_map.get(gid))
            .cloned();
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM collections WHERE name = ?1",
                rusqlite::params![c.name],
                |row| row.get(0),
            )
            .ok();
        let new_id = if let Some(eid) = existing {
            crate::db::collection::update(
                conn,
                &eid,
                None,
                Some(&c.description),
                Some(mapped_group.as_deref()),
                None,
            )?;
            stats.updated_collections += 1;
            eid
        } else {
            let new = crate::db::collection::create(
                conn,
                &c.name,
                &c.description,
                mapped_group.as_deref(),
            )?;
            stats.created_collections += 1;
            new.id
        };
        col_id_map.insert(c.id.clone(), new_id);
    }

    // collection_items: 按 (collection_id, name, parent_id) 匹配
    let mut item_id_map: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let mut new_item_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    for i in &data.collection_items {
        let mapped_col = col_id_map
            .get(&i.collection_id)
            .cloned()
            .unwrap_or_else(|| i.collection_id.clone());
        let mapped_parent = i
            .parent_id
            .as_ref()
            .and_then(|pid| item_id_map.get(pid))
            .cloned();

        let existing: Option<String> = if mapped_parent.is_some() {
            conn.query_row(
                "SELECT id FROM collection_items WHERE collection_id = ?1 AND name = ?2 AND parent_id = ?3",
                rusqlite::params![mapped_col, i.name, mapped_parent],
                |row| row.get(0),
            ).ok()
        } else {
            conn.query_row(
                "SELECT id FROM collection_items WHERE collection_id = ?1 AND name = ?2 AND parent_id IS NULL",
                rusqlite::params![mapped_col, i.name],
                |row| row.get(0),
            ).ok()
        };

        let new_id = if let Some(eid) = existing {
            conn.execute(
                "UPDATE collection_items SET method=?2, url=?3, headers=?4, query_params=?5, body_type=?6, body_content=?7, extract_rules=?8, description=?9, expect_status=?10, poll_config=?11, protocol=?12, updated_at=datetime('now','localtime') WHERE id=?1",
                rusqlite::params![eid, i.method, i.url, i.headers, i.query_params, i.body_type, i.body_content, i.extract_rules, i.description, i.expect_status, i.poll_config, i.protocol],
            )?;
            stats.updated_items += 1;
            eid
        } else {
            let new_id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO collection_items (id, collection_id, parent_id, type, name, sort_order, method, url, headers, query_params, body_type, body_content, extract_rules, description, expect_status, poll_config, protocol, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, datetime('now','localtime'), datetime('now','localtime'))",
                rusqlite::params![
                    new_id, mapped_col, mapped_parent, i.item_type, i.name, i.sort_order,
                    i.method, i.url, i.headers, i.query_params, i.body_type, i.body_content,
                    i.extract_rules, i.description, i.expect_status, i.poll_config, i.protocol
                ],
            )?;
            stats.created_items += 1;
            new_item_ids.insert(new_id.clone());
            new_id
        };
        item_id_map.insert(i.id.clone(), new_id);
    }

    // assertions: 同步所有 item 的断言（删旧+重建），但只对新建 item 计入 created 统计
    for (old_item_id, new_item_id) in &item_id_map {
        let new_assertions: Vec<_> = data
            .assertions
            .iter()
            .filter(|a| &a.item_id == old_item_id)
            .collect();
        if new_assertions.is_empty() {
            continue;
        }
        conn.execute(
            "DELETE FROM assertions WHERE item_id = ?1",
            rusqlite::params![new_item_id],
        )?;
        let is_new_item = new_item_ids.contains(new_item_id);
        for a in &new_assertions {
            let aid = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO assertions (id, item_id, type, expression, operator, expected, enabled, sort_order, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now','localtime'))",
                rusqlite::params![aid, new_item_id, a.assertion_type, a.expression, a.operator, a.expected, a.enabled, a.sort_order],
            )?;
            if is_new_item {
                stats.created_assertions += 1;
            }
        }
    }

    // environments: 按 name 匹配
    let mut env_id_map: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for e in &data.environments {
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM environments WHERE name = ?1",
                rusqlite::params![e.name],
                |row| row.get(0),
            )
            .ok();
        let new_id = if let Some(eid) = existing {
            eid
        } else {
            let new = crate::db::environment::create(conn, &e.name)?;
            stats.created_environments += 1;
            new.id
        };
        env_id_map.insert(e.id.clone(), new_id);
    }
    for v in &data.env_variables {
        if let Some(mapped_env_id) = env_id_map.get(&v.environment_id) {
            let exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM env_variables WHERE environment_id = ?1 AND key = ?2",
                    rusqlite::params![mapped_env_id, v.key],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap_or(0)
                > 0;
            if exists {
                conn.execute(
                    "UPDATE env_variables SET value=?3, enabled=?4 WHERE environment_id=?1 AND key=?2",
                    rusqlite::params![mapped_env_id, v.key, v.value, v.enabled],
                )?;
            } else {
                let vid = uuid::Uuid::new_v4().to_string();
                conn.execute(
                    "INSERT INTO env_variables (id, environment_id, key, value, enabled, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    rusqlite::params![vid, mapped_env_id, v.key, v.value, v.enabled, v.sort_order],
                )?;
                stats.created_env_variables += 1;
            }
        }
    }

    Ok(stats)
}
