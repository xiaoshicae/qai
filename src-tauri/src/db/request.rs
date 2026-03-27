use rusqlite::{params, Connection, Row};
use uuid::Uuid;

use crate::models::request::ApiRequest;

const REQUEST_COLS: &str = "id, collection_id, folder_id, name, method, url, headers, query_params, body_type, body_content, sort_order, created_at, updated_at, extract_rules, description, expect_status, poll_config";

pub fn request_from_row(row: &Row) -> Result<ApiRequest, rusqlite::Error> {
    Ok(ApiRequest {
        id: row.get(0)?,
        collection_id: row.get(1)?,
        folder_id: row.get(2)?,
        name: row.get(3)?,
        method: row.get(4)?,
        url: row.get(5)?,
        headers: row.get(6)?,
        query_params: row.get(7)?,
        body_type: row.get(8)?,
        body_content: row.get(9)?,
        sort_order: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        extract_rules: row.get(13)?,
        description: row.get(14).unwrap_or_default(),
        expect_status: row.get(15).unwrap_or(200u16),
        poll_config: row.get(16).unwrap_or_default(),
    })
}

pub fn create(
    conn: &Connection,
    collection_id: &str,
    folder_id: Option<&str>,
    name: &str,
    method: &str,
) -> Result<ApiRequest, rusqlite::Error> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO requests (id, collection_id, folder_id, name, method) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, collection_id, folder_id, name, method],
    )?;
    get(conn, &id)
}

pub fn get(conn: &Connection, id: &str) -> Result<ApiRequest, rusqlite::Error> {
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM requests WHERE id = ?1", REQUEST_COLS),
    )?;
    stmt.query_row(params![id], request_from_row)
}

pub fn list_by_collection(conn: &Connection, collection_id: &str) -> Result<Vec<ApiRequest>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM requests WHERE collection_id = ?1 ORDER BY sort_order", REQUEST_COLS),
    )?;
    let rows = stmt.query_map(params![collection_id], request_from_row)?;
    rows.collect()
}

pub fn list_by_folder(conn: &Connection, folder_id: &str) -> Result<Vec<ApiRequest>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM requests WHERE folder_id = ?1 ORDER BY sort_order", REQUEST_COLS),
    )?;
    let rows = stmt.query_map(params![folder_id], request_from_row)?;
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
) -> Result<ApiRequest, rusqlite::Error> {
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

    if !sets.is_empty() {
        sets.push(format!("updated_at = datetime('now', 'localtime')"));
        let idx = values.len() + 1;
        let sql = format!("UPDATE requests SET {} WHERE id = ?{}", sets.join(", "), idx);
        values.push(Box::new(id.to_string()));
        let params: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
        conn.execute(&sql, params.as_slice())?;
    }

    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM requests WHERE id = ?1", params![id])?;
    Ok(())
}
