use tauri::State;

use crate::db::init::DbState;
use crate::models::collection::{Collection, CollectionTreeNode, Folder};

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
    category: Option<String>,
    endpoint: Option<String>,
    subcategory: Option<String>,
) -> Result<Collection, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::collection::create(&conn, &name, &description, category.as_deref(), endpoint.as_deref(), subcategory.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_collection_meta(
    db: State<'_, DbState>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    category: Option<String>,
    endpoint: Option<String>,
    subcategory: Option<String>,
) -> Result<Collection, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::collection::update_meta(&conn, &id, name.as_deref(), description.as_deref(), category.as_deref(), endpoint.as_deref(), subcategory.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_collection(db: State<'_, DbState>, id: String, name: String, description: String) -> Result<Collection, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::collection::update(&conn, &id, &name, &description).map_err(|e| e.to_string())
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

#[tauri::command]
pub fn create_folder(
    db: State<'_, DbState>,
    collection_id: String,
    parent_folder_id: Option<String>,
    name: String,
    is_chain: Option<bool>,
) -> Result<Folder, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::collection::create_folder(&conn, &collection_id, parent_folder_id.as_deref(), &name, is_chain.unwrap_or(false))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_folder(db: State<'_, DbState>, id: String) -> Result<Folder, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::collection::get_folder(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_folder(
    db: State<'_, DbState>,
    id: String,
    name: Option<String>,
    is_chain: Option<bool>,
) -> Result<Folder, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::collection::update_folder(&conn, &id, name.as_deref(), is_chain)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_folder(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::collection::delete_folder(&conn, &id).map_err(|e| e.to_string())
}
