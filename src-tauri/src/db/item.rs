use rusqlite::{params, Connection, Row};
use uuid::Uuid;

use crate::models::item::CollectionItem;

const ITEM_COLS: &str = "id, collection_id, parent_id, type, name, sort_order, method, url, headers, query_params, body_type, body_content, extract_rules, description, expect_status, poll_config, created_at, updated_at";

pub fn item_from_row(row: &Row) -> Result<CollectionItem, rusqlite::Error> {
    Ok(CollectionItem {
        id: row.get(0)?,
        collection_id: row.get(1)?,
        parent_id: row.get(2)?,
        item_type: row.get(3)?,
        name: row.get(4)?,
        sort_order: row.get(5)?,
        method: row.get(6)?,
        url: row.get(7)?,
        headers: row.get(8)?,
        query_params: row.get(9)?,
        body_type: row.get(10)?,
        body_content: row.get(11)?,
        extract_rules: row.get(12)?,
        description: row.get(13)?,
        expect_status: row.get::<_, u16>(14).unwrap_or(200),
        poll_config: row.get(15).unwrap_or_default(),
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
    })
}

pub fn create(
    conn: &Connection,
    collection_id: &str,
    parent_id: Option<&str>,
    item_type: &str,
    name: &str,
    method: &str,
) -> Result<CollectionItem, rusqlite::Error> {
    let id = Uuid::new_v4().to_string();
    let max_sort: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM collection_items WHERE collection_id = ?1 AND parent_id IS ?2",
            params![collection_id, parent_id],
            |row| row.get(0),
        )
        .unwrap_or(-1);
    conn.execute(
        "INSERT INTO collection_items (id, collection_id, parent_id, type, name, method, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, collection_id, parent_id, item_type, name, method, max_sort + 1],
    )?;
    get(conn, &id)
}

pub fn get(conn: &Connection, id: &str) -> Result<CollectionItem, rusqlite::Error> {
    conn.query_row(
        &format!("SELECT {} FROM collection_items WHERE id = ?1", ITEM_COLS),
        params![id],
        item_from_row,
    )
}

pub fn list_by_collection(conn: &Connection, collection_id: &str) -> Result<Vec<CollectionItem>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM collection_items WHERE collection_id = ?1 ORDER BY sort_order", ITEM_COLS),
    )?;
    let rows = stmt.query_map(params![collection_id], item_from_row)?;
    rows.collect()
}

pub fn list_by_parent(conn: &Connection, parent_id: &str) -> Result<Vec<CollectionItem>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM collection_items WHERE parent_id = ?1 ORDER BY sort_order", ITEM_COLS),
    )?;
    let rows = stmt.query_map(params![parent_id], item_from_row)?;
    rows.collect()
}

/// 列出集合中所有 type=request 的项（忽略 folder/chain 容器）
pub fn list_requests_by_collection(conn: &Connection, collection_id: &str) -> Result<Vec<CollectionItem>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM collection_items WHERE collection_id = ?1 AND type = 'request' ORDER BY sort_order", ITEM_COLS),
    )?;
    let rows = stmt.query_map(params![collection_id], item_from_row)?;
    rows.collect()
}

pub fn update(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    method: Option<&str>,
    url: Option<&str>,
    headers: Option<&str>,
    query_params: Option<&str>,
    body_type: Option<&str>,
    body_content: Option<&str>,
    extract_rules: Option<&str>,
    description: Option<&str>,
    expect_status: Option<u16>,
    parent_id: Option<Option<&str>>,
) -> Result<CollectionItem, rusqlite::Error> {
    let mut sets: Vec<String> = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    macro_rules! push_field {
        ($field:expr, $col:expr) => {
            if let Some(v) = $field {
                sets.push(format!("{} = ?{}", $col, values.len() + 1));
                values.push(Box::new(v.to_string()));
            }
        };
    }

    push_field!(name, "name");
    push_field!(method, "method");
    push_field!(url, "url");
    push_field!(headers, "headers");
    push_field!(query_params, "query_params");
    push_field!(body_type, "body_type");
    push_field!(body_content, "body_content");
    push_field!(extract_rules, "extract_rules");
    push_field!(description, "description");
    if let Some(es) = expect_status {
        sets.push(format!("expect_status = ?{}", values.len() + 1));
        values.push(Box::new(es as i32));
    }
    if let Some(pid) = parent_id {
        sets.push(format!("parent_id = ?{}", values.len() + 1));
        values.push(Box::new(pid.map(|s| s.to_string())));
    }

    if !sets.is_empty() {
        sets.push("updated_at = datetime('now', 'localtime')".to_string());
        let idx = values.len() + 1;
        let sql = format!("UPDATE collection_items SET {} WHERE id = ?{}", sets.join(", "), idx);
        values.push(Box::new(id.to_string()));
        let params: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
        conn.execute(&sql, params.as_slice())?;
    }

    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM collection_items WHERE id = ?1", params![id])?;
    Ok(())
}
