use tauri::State;

use crate::db::init::DbState;
use crate::errors::AppError;
use crate::models::assertion::Assertion;

#[tauri::command]
pub fn list_assertions(db: State<'_, DbState>, item_id: String) -> Result<Vec<Assertion>, AppError> {
    let conn = db.conn()?;
    Ok(crate::db::assertion::list_by_item(&conn, &item_id)?)
}

#[tauri::command]
pub fn get_assertion_counts(
    db: State<'_, DbState>,
    collection_id: String,
) -> Result<std::collections::HashMap<String, i32>, AppError> {
    let conn = db.conn()?;
    Ok(crate::db::assertion::count_by_collection(&conn, &collection_id)?)
}

#[tauri::command]
pub fn create_assertion(
    db: State<'_, DbState>,
    item_id: String,
    assertion_type: String,
    expression: String,
    operator: String,
    expected: String,
) -> Result<Assertion, AppError> {
    let conn = db.conn()?;
    Ok(crate::db::assertion::create(
        &conn,
        &item_id,
        &assertion_type,
        &expression,
        &operator,
        &expected,
    )?)
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
) -> Result<Assertion, AppError> {
    let conn = db.conn()?;
    let updated = crate::db::assertion::update(
        &conn,
        &id,
        assertion_type.as_deref(),
        expression.as_deref(),
        operator.as_deref(),
        expected.as_deref(),
        enabled,
    )?;

    // 反向同步：status_code 断言的 expected 变更时，同步更新 item 的 expect_status
    if updated.assertion_type == "status_code" {
        if let Ok(new_status) = updated.expected.parse::<u16>() {
            if let Err(e) = conn.execute(
                "UPDATE collection_items SET expect_status = ?1 WHERE id = ?2",
                rusqlite::params![new_status, updated.item_id],
            ) {
                log::warn!("反向同步 expect_status 失败 [{}]: {e}", updated.item_id);
            }
        }
    }

    Ok(updated)
}

#[tauri::command]
pub fn delete_assertion(db: State<'_, DbState>, id: String) -> Result<(), AppError> {
    let conn = db.conn()?;
    Ok(crate::db::assertion::delete(&conn, &id)?)
}
