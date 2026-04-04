use rusqlite::{params, Connection, Row};
use std::collections::HashMap;
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
        "UPDATE environments SET name = ?2, updated_at = datetime('now', 'localtime') WHERE id = ?1",
        params![id, name],
    )?;
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM environments WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn set_active(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE environments SET is_active = CASE WHEN id = ?1 THEN 1 ELSE 0 END",
        params![id],
    )?;
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

/// 获取当前活跃环境的变量映射（便捷方法）
/// 如果没有活跃环境或发生错误，返回空的 HashMap
pub fn get_active_var_map(conn: &Connection) -> HashMap<String, String> {
    get_active(conn)
        .map_err(|e| { log::warn!("获取活跃环境失败: {e}"); e })
        .ok()
        .flatten()
        .map(|env| crate::http::vars::build_var_map(&env.variables))
        .unwrap_or_default()
}

pub fn list_variables(conn: &Connection, environment_id: &str) -> Result<Vec<EnvVariable>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, environment_id, key, value, enabled, sort_order FROM env_variables WHERE environment_id = ?1 ORDER BY sort_order",
    )?;
    let rows = stmt.query_map(params![environment_id], var_from_row)?;
    rows.collect()
}

pub fn save_variables(conn: &Connection, environment_id: &str, variables: &[EnvVariable]) -> Result<(), rusqlite::Error> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM env_variables WHERE environment_id = ?1", params![environment_id])?;
    for (i, v) in variables.iter().enumerate() {
        let id = if v.id.is_empty() { Uuid::new_v4().to_string() } else { v.id.clone() };
        tx.execute(
            "INSERT INTO env_variables (id, environment_id, key, value, enabled, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, environment_id, v.key, v.value, v.enabled as i32, i as i32],
        )?;
    }
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init::create_test_db;

    #[test]
    fn test_create_and_get() {
        let conn = create_test_db();
        let env = create(&conn, "Production").unwrap();
        assert_eq!(env.name, "Production");
        assert!(!env.is_active);
        let fetched = get(&conn, &env.id).unwrap();
        assert_eq!(fetched.name, "Production");
    }

    #[test]
    fn test_list_all() {
        let conn = create_test_db();
        create(&conn, "Dev").unwrap();
        create(&conn, "Staging").unwrap();
        let all = list_all(&conn).unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn test_update() {
        let conn = create_test_db();
        let env = create(&conn, "Old").unwrap();
        let updated = update(&conn, &env.id, "New").unwrap();
        assert_eq!(updated.name, "New");
    }

    #[test]
    fn test_delete() {
        let conn = create_test_db();
        let env = create(&conn, "Del").unwrap();
        delete(&conn, &env.id).unwrap();
        assert!(get(&conn, &env.id).is_err());
    }

    #[test]
    fn test_set_active() {
        let conn = create_test_db();
        let e1 = create(&conn, "E1").unwrap();
        let e2 = create(&conn, "E2").unwrap();
        set_active(&conn, &e1.id).unwrap();
        let f1 = get(&conn, &e1.id).unwrap();
        assert!(f1.is_active);

        set_active(&conn, &e2.id).unwrap();
        let f1 = get(&conn, &e1.id).unwrap();
        let f2 = get(&conn, &e2.id).unwrap();
        assert!(!f1.is_active);
        assert!(f2.is_active);
    }

    #[test]
    fn test_get_active_none() {
        let conn = create_test_db();
        let result = get_active(&conn).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_get_active_with_vars() {
        let conn = create_test_db();
        let env = create(&conn, "E").unwrap();
        set_active(&conn, &env.id).unwrap();
        let vars = vec![
            EnvVariable { id: String::new(), environment_id: env.id.clone(), key: "base_url".into(), value: "http://localhost".into(), enabled: true, sort_order: 0 },
            EnvVariable { id: String::new(), environment_id: env.id.clone(), key: "token".into(), value: "abc123".into(), enabled: true, sort_order: 1 },
        ];
        save_variables(&conn, &env.id, &vars).unwrap();
        let active = get_active(&conn).unwrap().unwrap();
        assert_eq!(active.environment.name, "E");
        assert_eq!(active.variables.len(), 2);
        assert_eq!(active.variables[0].key, "base_url");
    }

    #[test]
    fn test_save_variables_replaces() {
        let conn = create_test_db();
        let env = create(&conn, "E").unwrap();
        let v1 = vec![EnvVariable { id: String::new(), environment_id: env.id.clone(), key: "a".into(), value: "1".into(), enabled: true, sort_order: 0 }];
        save_variables(&conn, &env.id, &v1).unwrap();
        assert_eq!(list_variables(&conn, &env.id).unwrap().len(), 1);

        let v2 = vec![
            EnvVariable { id: String::new(), environment_id: env.id.clone(), key: "b".into(), value: "2".into(), enabled: true, sort_order: 0 },
            EnvVariable { id: String::new(), environment_id: env.id.clone(), key: "c".into(), value: "3".into(), enabled: false, sort_order: 1 },
        ];
        save_variables(&conn, &env.id, &v2).unwrap();
        let loaded = list_variables(&conn, &env.id).unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].key, "b");
        assert!(!loaded[1].enabled);
    }

    #[test]
    fn test_cascade_delete_env_vars() {
        let conn = create_test_db();
        let env = create(&conn, "E").unwrap();
        let vars = vec![EnvVariable { id: String::new(), environment_id: env.id.clone(), key: "k".into(), value: "v".into(), enabled: true, sort_order: 0 }];
        save_variables(&conn, &env.id, &vars).unwrap();
        delete(&conn, &env.id).unwrap();
        let loaded = list_variables(&conn, &env.id).unwrap();
        assert!(loaded.is_empty());
    }
}
