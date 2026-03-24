use tauri::State;

use crate::db::init::DbState;
use crate::models::collection::{Collection, CollectionTreeNode, Folder};

#[tauri::command]
pub fn list_collections(db: State<'_, DbState>) -> Result<Vec<Collection>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::collection::list_all(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_collection(db: State<'_, DbState>, name: String, description: String) -> Result<Collection, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::collection::create(&conn, &name, &description).map_err(|e| e.to_string())
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
) -> Result<Folder, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::collection::create_folder(&conn, &collection_id, parent_folder_id.as_deref(), &name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_folder(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::collection::delete_folder(&conn, &id).map_err(|e| e.to_string())
}
