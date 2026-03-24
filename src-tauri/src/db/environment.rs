use rusqlite::{params, Connection, Row};
use uuid::Uuid;

use crate::models::environment::{EnvVariable, Environment, EnvironmentWithVars};

fn env_from_row(row: &Row) -> Result<Environment, rusqlite::Error> {
    Ok(Environment {
        id: row.get(0)?,
        name: row.get(1)?,
        is_active: row.get::<_, i32>(2)? != 0,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

fn var_from_row(row: &Row) -> Result<EnvVariable, rusqlite::Error> {
    Ok(EnvVariable {
        id: row.get(0)?,
        environment_id: row.get(1)?,
        key: row.get(2)?,
        value: row.get(3)?,
        enabled: row.get::<_, i32>(4)? != 0,
        sort_order: row.get(5)?,
    })
}

pub fn list_all(conn: &Connection) -> Result<Vec<Environment>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, name, is_active, created_at, updated_at FROM environments ORDER BY created_at",
    )?;
    let rows = stmt.query_map([], env_from_row)?;
    rows.collect()
}

pub fn create(conn: &Connection, name: &str) -> Result<Environment, rusqlite::Error> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO environments (id, name) VALUES (?1, ?2)",
        params![id, name],
    )?;
    get(conn, &id)
}

pub fn get(conn: &Connection, id: &str) -> Result<Environment, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, name, is_active, created_at, updated_at FROM environments WHERE id = ?1",
    )?;
    stmt.query_row(params![id], env_from_row)
}

pub fn update(conn: &Connection, id: &str, name: &str) -> Result<Environment, rusqlite::Error> {
    conn.execute(
        "UPDATE environments SET name = ?2, updated_at = datetime('now') WHERE id = ?1",
        params![id, name],
    )?;
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM environments WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn set_active(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("UPDATE environments SET is_active = 0", [])?;
    conn.execute("UPDATE environments SET is_active = 1 WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn get_active(conn: &Connection) -> Result<Option<EnvironmentWithVars>, rusqlite::Error> {
    let env = {
        let mut stmt = conn.prepare(
            "SELECT id, name, is_active, created_at, updated_at FROM environments WHERE is_active = 1 LIMIT 1",
        )?;
        match stmt.query_row([], env_from_row) {
            Ok(e) => e,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
            Err(e) => return Err(e),
        }
    };
    let vars = list_variables(conn, &env.id)?;
    Ok(Some(EnvironmentWithVars { environment: env, variables: vars }))
}

pub fn list_variables(conn: &Connection, environment_id: &str) -> Result<Vec<EnvVariable>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, environment_id, key, value, enabled, sort_order FROM env_variables WHERE environment_id = ?1 ORDER BY sort_order",
    )?;
    let rows = stmt.query_map(params![environment_id], var_from_row)?;
    rows.collect()
}

pub fn save_variables(conn: &Connection, environment_id: &str, variables: &[EnvVariable]) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM env_variables WHERE environment_id = ?1", params![environment_id])?;
    for (i, v) in variables.iter().enumerate() {
        let id = if v.id.is_empty() { Uuid::new_v4().to_string() } else { v.id.clone() };
        conn.execute(
            "INSERT INTO env_variables (id, environment_id, key, value, enabled, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, environment_id, v.key, v.value, v.enabled as i32, i as i32],
        )?;
    }
    Ok(())
}
