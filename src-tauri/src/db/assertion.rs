use rusqlite::{params, Connection, Row};
use uuid::Uuid;

use crate::models::assertion::Assertion;

const ASSERTION_COLS: &str = "id, request_id, type, expression, operator, expected, enabled, sort_order, created_at";

fn assertion_from_row(row: &Row) -> Result<Assertion, rusqlite::Error> {
    Ok(Assertion {
        id: row.get(0)?,
        request_id: row.get(1)?,
        assertion_type: row.get(2)?,
        expression: row.get(3)?,
        operator: row.get(4)?,
        expected: row.get(5)?,
        enabled: row.get(6)?,
        sort_order: row.get(7)?,
        created_at: row.get(8)?,
    })
}

pub fn list_by_request(conn: &Connection, request_id: &str) -> Result<Vec<Assertion>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM assertions WHERE request_id = ?1 ORDER BY sort_order", ASSERTION_COLS),
    )?;
    let rows = stmt.query_map(params![request_id], assertion_from_row)?;
    rows.collect()
}

pub fn create(
    conn: &Connection,
    request_id: &str,
    assertion_type: &str,
    expression: &str,
    operator: &str,
    expected: &str,
) -> Result<Assertion, rusqlite::Error> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO assertions (id, request_id, type, expression, operator, expected) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, request_id, assertion_type, expression, operator, expected],
    )?;
    get(conn, &id)
}

pub fn get(conn: &Connection, id: &str) -> Result<Assertion, rusqlite::Error> {
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM assertions WHERE id = ?1", ASSERTION_COLS),
    )?;
    stmt.query_row(params![id], assertion_from_row)
}

pub fn update(
    conn: &Connection,
    id: &str,
    assertion_type: Option<&str>,
    expression: Option<&str>,
    operator: Option<&str>,
    expected: Option<&str>,
    enabled: Option<bool>,
) -> Result<Assertion, rusqlite::Error> {
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

    push_field!(assertion_type, "type");
    push_field!(expression, "expression");
    push_field!(operator, "operator");
    push_field!(expected, "expected");

    if let Some(v) = enabled {
        sets.push(format!("enabled = ?{}", values.len() + 1));
        values.push(Box::new(v as i32));
    }

    if !sets.is_empty() {
        let idx = values.len() + 1;
        let sql = format!("UPDATE assertions SET {} WHERE id = ?{}", sets.join(", "), idx);
        values.push(Box::new(id.to_string()));
        let params: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
        conn.execute(&sql, params.as_slice())?;
    }

    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM assertions WHERE id = ?1", params![id])?;
    Ok(())
}
