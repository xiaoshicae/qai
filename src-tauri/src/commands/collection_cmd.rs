use tauri::State;

use crate::db::init::DbState;
use crate::models::collection::{Collection, CollectionTreeNode};
use crate::models::group::Group;

#[tauri::command]
pub fn list_collections(db: State<'_, DbState>) -> Result<Vec<Collection>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let result = crate::db::collection::list_all(&conn);
    match &result {
        Ok(cols) => log::info!("list_collections: {} collections loaded", cols.len()),
        Err(e) => log::error!("list_collections failed: {}", e),
    }
    result.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_collection(
    db: State<'_, DbState>,
    name: String,
    description: String,
    group_id: Option<String>,
) -> Result<Collection, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::collection::create(&conn, &name, &description, group_id.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_collection(
    db: State<'_, DbState>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    group_id: Option<Option<String>>,
    sort_order: Option<i32>,
) -> Result<Collection, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let gid = group_id.map(|outer| outer.as_deref().map(|s| s.to_string()));
    let gid_ref = gid.as_ref().map(|o| o.as_deref());
    crate::db::collection::update(&conn, &id, name.as_deref(), description.as_deref(), gid_ref, sort_order)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_collection(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::collection::delete(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_collection_tree(db: State<'_, DbState>, collection_id: String) -> Result<CollectionTreeNode, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::collection::get_tree(&conn, &collection_id).map_err(|e| e.to_string())
}

// --- Group 命令 ---

#[tauri::command]
pub fn list_groups(db: State<'_, DbState>) -> Result<Vec<Group>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::group::list_all(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_group(
    db: State<'_, DbState>,
    name: String,
    parent_id: Option<String>,
) -> Result<Group, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::group::create(&conn, &name, parent_id.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_group(
    db: State<'_, DbState>,
    id: String,
    name: Option<String>,
    parent_id: Option<Option<String>>,
    sort_order: Option<i32>,
) -> Result<Group, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let pid = parent_id.map(|outer| outer.as_deref().map(|s| s.to_string()));
    let pid_ref = pid.as_ref().map(|o| o.as_deref());
    crate::db::group::update(&conn, &id, name.as_deref(), pid_ref, sort_order)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_group(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::group::delete(&conn, &id).map_err(|e| e.to_string())
}

#[derive(serde::Deserialize)]
pub struct GroupOrder {
    pub id: String,
    pub sort_order: i32,
}

#[derive(serde::Deserialize)]
pub struct CollectionOrder {
    pub id: String,
    pub group_id: Option<String>,
    pub sort_order: i32,
}

#[tauri::command]
pub fn reorder_sidebar(
    db: State<'_, DbState>,
    groups: Vec<GroupOrder>,
    collections: Vec<CollectionOrder>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    for g in &groups {
        conn.execute(
            "UPDATE groups SET sort_order = ?1 WHERE id = ?2",
            rusqlite::params![g.sort_order, g.id],
        ).map_err(|e| e.to_string())?;
    }
    for c in &collections {
        conn.execute(
            "UPDATE collections SET sort_order = ?1, group_id = ?2 WHERE id = ?3",
            rusqlite::params![c.sort_order, c.group_id, c.id],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}
