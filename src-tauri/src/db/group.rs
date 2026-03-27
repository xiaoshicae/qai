use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::models::group::Group;

pub fn list_all(conn: &Connection) -> Result<Vec<Group>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT id, name, parent_id, sort_order FROM groups ORDER BY sort_order")?;
    let rows = stmt.query_map([], |row| {
        Ok(Group {
            id: row.get(0)?,
            name: row.get(1)?,
            parent_id: row.get(2)?,
            sort_order: row.get(3)?,
        })
    })?;
    rows.collect()
}

pub fn create(conn: &Connection, name: &str, parent_id: Option<&str>) -> Result<Group, rusqlite::Error> {
    let id = Uuid::new_v4().to_string();
    let max_sort: i32 = conn
        .query_row("SELECT COALESCE(MAX(sort_order), -1) FROM groups WHERE parent_id IS ?1", params![parent_id], |row| row.get(0))
        .unwrap_or(-1);
    conn.execute(
        "INSERT INTO groups (id, name, parent_id, sort_order) VALUES (?1, ?2, ?3, ?4)",
        params![id, name, parent_id, max_sort + 1],
    )?;
    get(conn, &id)
}

pub fn get(conn: &Connection, id: &str) -> Result<Group, rusqlite::Error> {
    conn.query_row(
        "SELECT id, name, parent_id, sort_order FROM groups WHERE id = ?1",
        params![id],
        |row| Ok(Group { id: row.get(0)?, name: row.get(1)?, parent_id: row.get(2)?, sort_order: row.get(3)? }),
    )
}

pub fn update(conn: &Connection, id: &str, name: Option<&str>, parent_id: Option<Option<&str>>, sort_order: Option<i32>) -> Result<Group, rusqlite::Error> {
    if let Some(n) = name {
        conn.execute("UPDATE groups SET name = ?2 WHERE id = ?1", params![id, n])?;
    }
    if let Some(pid) = parent_id {
        conn.execute("UPDATE groups SET parent_id = ?2 WHERE id = ?1", params![id, pid])?;
    }
    if let Some(s) = sort_order {
        conn.execute("UPDATE groups SET sort_order = ?2 WHERE id = ?1", params![id, s])?;
    }
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    // ON DELETE CASCADE 会删子 groups；collections.group_id ON DELETE SET NULL
    conn.execute("DELETE FROM groups WHERE id = ?1", params![id])?;
    Ok(())
}
