use tauri::State;

use crate::db::init::DbState;
use crate::models::assertion::Assertion;

#[tauri::command]
pub fn list_assertions(db: State<'_, DbState>, item_id: String) -> Result<Vec<Assertion>, String> {
    let conn = db.conn()?;
    crate::db::assertion::list_by_item(&conn, &item_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_assertion_counts(
    db: State<'_, DbState>,
    collection_id: String,
) -> Result<std::collections::HashMap<String, i32>, String> {
    let conn = db.conn()?;
    crate::db::assertion::count_by_collection(&conn, &collection_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_assertion(
    db: State<'_, DbState>,
    item_id: String,
    assertion_type: String,
    expression: String,
    operator: String,
    expected: String,
) -> Result<Assertion, String> {
    let conn = db.conn()?;
    crate::db::assertion::create(&conn, &item_id, &assertion_type, &expression, &operator, &expected)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_assertion(
    db: State<'_, DbState>,
    id: String,
    assertion_type: Option<String>,
    expression: Option<String>,
    operator: Option<String>,
    expected: Option<String>,
    enabled: Option<bool>,
) -> Result<Assertion, String> {
    let conn = db.conn()?;
    let updated = crate::db::assertion::update(
        &conn,
        &id,
        assertion_type.as_deref(),
        expression.as_deref(),
        operator.as_deref(),
        expected.as_deref(),
        enabled,
    )
    .map_err(|e| e.to_string())?;

    // 反向同步：status_code 断言的 expected 变更时，同步更新 item 的 expect_status
    if updated.assertion_type == "status_code" {
        if let Ok(new_status) = updated.expected.parse::<u16>() {
            let _ = conn.execute(
                "UPDATE collection_items SET expect_status = ?1 WHERE id = ?2",
                rusqlite::params![new_status, updated.item_id],
            );
        }
    }

    Ok(updated)
}

#[tauri::command]
pub fn delete_assertion(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let conn = db.conn()?;
    crate::db::assertion::delete(&conn, &id).map_err(|e| e.to_string())
}
