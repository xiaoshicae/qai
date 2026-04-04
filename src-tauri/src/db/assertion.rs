use rusqlite::{params, Connection, Row};
use uuid::Uuid;

use crate::models::assertion::Assertion;

const ASSERTION_COLS: &str = "id, item_id, type, expression, operator, expected, enabled, sort_order, created_at";

fn assertion_from_row(row: &Row) -> Result<Assertion, rusqlite::Error> {
    Ok(Assertion {
        id: row.get(0)?,
        item_id: row.get(1)?,
        assertion_type: row.get(2)?,
        expression: row.get(3)?,
        operator: row.get(4)?,
        expected: row.get(5)?,
        enabled: row.get(6)?,
        sort_order: row.get(7)?,
        created_at: row.get(8)?,
    })
}

pub fn list_by_item(conn: &Connection, item_id: &str) -> Result<Vec<Assertion>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM assertions WHERE item_id = ?1 ORDER BY sort_order", ASSERTION_COLS),
    )?;
    let rows = stmt.query_map(params![item_id], assertion_from_row)?;
    rows.collect()
}

/// 批量获取多个 item 的断言（消除 N+1 查询）
pub fn list_by_items(conn: &Connection, item_ids: &[String]) -> Result<std::collections::HashMap<String, Vec<Assertion>>, rusqlite::Error> {
    if item_ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }
    let placeholders: Vec<String> = (1..=item_ids.len()).map(|i| format!("?{}", i)).collect();
    let sql = format!(
        "SELECT {} FROM assertions WHERE item_id IN ({}) ORDER BY sort_order",
        ASSERTION_COLS, placeholders.join(", ")
    );
    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::types::ToSql> = item_ids.iter().map(|id| id as &dyn rusqlite::types::ToSql).collect();
    let rows = stmt.query_map(params.as_slice(), assertion_from_row)?;
    let mut map: std::collections::HashMap<String, Vec<Assertion>> = std::collections::HashMap::new();
    for row in rows {
        let a = row?;
        map.entry(a.item_id.clone()).or_default().push(a);
    }
    Ok(map)
}

/// 按集合批量获取每个 item 的断言数量
pub fn count_by_collection(conn: &Connection, collection_id: &str) -> Result<std::collections::HashMap<String, i32>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT a.item_id, COUNT(*) FROM assertions a \
         JOIN collection_items ci ON ci.id = a.item_id \
         WHERE ci.collection_id = ?1 \
         GROUP BY a.item_id"
    )?;
    let rows = stmt.query_map(params![collection_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?))
    })?;
    let mut map = std::collections::HashMap::new();
    for row in rows {
        let (item_id, count) = row?;
        map.insert(item_id, count);
    }
    Ok(map)
}

pub fn create(
    conn: &Connection,
    item_id: &str,
    assertion_type: &str,
    expression: &str,
    operator: &str,
    expected: &str,
) -> Result<Assertion, rusqlite::Error> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO assertions (id, item_id, type, expression, operator, expected) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, item_id, assertion_type, expression, operator, expected],
    )?;
    get(conn, &id)
}

pub fn get(conn: &Connection, id: &str) -> Result<Assertion, rusqlite::Error> {
    conn.query_row(
        &format!("SELECT {} FROM assertions WHERE id = ?1", ASSERTION_COLS),
        params![id],
        assertion_from_row,
    )
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
    let mut u = super::DynamicUpdate::new();
    u.set_opt("type", assertion_type.map(|s| s.to_string()));
    u.set_opt("expression", expression.map(|s| s.to_string()));
    u.set_opt("operator", operator.map(|s| s.to_string()));
    u.set_opt("expected", expected.map(|s| s.to_string()));
    u.set_opt("enabled", enabled.map(|v| v as i32));
    // assertions 表没有 updated_at 字段
    u.execute_without_timestamp(conn, "assertions", id)?;
    get(conn, id)
}

/// 同步 status_code 断言的 expected 值（当 expect_status 变更时调用）
/// 如果存在 status_code 类型的断言，更新其 expected；如果不存在，创建一条。
pub fn sync_status_code_assertion(conn: &Connection, item_id: &str, expect_status: u16) -> Result<(), rusqlite::Error> {
    let expected = expect_status.to_string();
    // 查找已有的 status_code 断言
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM assertions WHERE item_id = ?1 AND type = 'status_code' LIMIT 1",
            params![item_id],
            |row| row.get(0),
        )
        .ok();

    if let Some(assertion_id) = existing {
        conn.execute(
            "UPDATE assertions SET expected = ?1 WHERE id = ?2",
            params![expected, assertion_id],
        )?;
    } else {
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO assertions (id, item_id, type, expression, operator, expected) VALUES (?1, ?2, 'status_code', '', 'eq', ?3)",
            params![id, item_id, expected],
        )?;
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM assertions WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init::create_test_db;

    fn setup() -> (Connection, String) {
        let conn = create_test_db();
        let c = crate::db::collection::create(&conn, "S", "", None).unwrap();
        let item = crate::db::item::create(&conn, &c.id, None, "request", "R", "GET").unwrap();
        (conn, item.id)
    }

    #[test]
    fn test_create_and_get() {
        let (conn, item_id) = setup();
        let a = create(&conn, &item_id, "status_code", "", "eq", "200").unwrap();
        assert_eq!(a.assertion_type, "status_code");
        assert_eq!(a.operator, "eq");
        assert_eq!(a.expected, "200");
        let fetched = get(&conn, &a.id).unwrap();
        assert_eq!(fetched.id, a.id);
    }

    #[test]
    fn test_list_by_item() {
        let (conn, item_id) = setup();
        create(&conn, &item_id, "status_code", "", "eq", "200").unwrap();
        create(&conn, &item_id, "json_path", "$.id", "exists", "").unwrap();
        let list = list_by_item(&conn, &item_id).unwrap();
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn test_list_by_items_batch() {
        let conn = create_test_db();
        let c = crate::db::collection::create(&conn, "S", "", None).unwrap();
        let i1 = crate::db::item::create(&conn, &c.id, None, "request", "R1", "GET").unwrap();
        let i2 = crate::db::item::create(&conn, &c.id, None, "request", "R2", "GET").unwrap();
        create(&conn, &i1.id, "status_code", "", "eq", "200").unwrap();
        create(&conn, &i2.id, "status_code", "", "eq", "201").unwrap();
        create(&conn, &i2.id, "json_path", "$.ok", "eq", "true").unwrap();
        let map = list_by_items(&conn, &[i1.id.clone(), i2.id.clone()]).unwrap();
        assert_eq!(map.get(&i1.id).unwrap().len(), 1);
        assert_eq!(map.get(&i2.id).unwrap().len(), 2);
    }

    #[test]
    fn test_list_by_items_empty() {
        let conn = create_test_db();
        let map = list_by_items(&conn, &[]).unwrap();
        assert!(map.is_empty());
    }

    #[test]
    fn test_update() {
        let (conn, item_id) = setup();
        let a = create(&conn, &item_id, "status_code", "", "eq", "200").unwrap();
        let updated = update(&conn, &a.id, Some("json_path"), Some("$.id"), Some("exists"), Some(""), None).unwrap();
        assert_eq!(updated.assertion_type, "json_path");
        assert_eq!(updated.expression, "$.id");
    }

    #[test]
    fn test_update_enabled() {
        let (conn, item_id) = setup();
        let a = create(&conn, &item_id, "status_code", "", "eq", "200").unwrap();
        assert!(a.enabled);
        let updated = update(&conn, &a.id, None, None, None, None, Some(false)).unwrap();
        assert!(!updated.enabled);
    }

    #[test]
    fn test_delete() {
        let (conn, item_id) = setup();
        let a = create(&conn, &item_id, "status_code", "", "eq", "200").unwrap();
        delete(&conn, &a.id).unwrap();
        assert!(get(&conn, &a.id).is_err());
    }

    #[test]
    fn test_cascade_delete_item() {
        let (conn, item_id) = setup();
        create(&conn, &item_id, "status_code", "", "eq", "200").unwrap();
        crate::db::item::delete(&conn, &item_id).unwrap();
        let list = list_by_item(&conn, &item_id).unwrap();
        assert!(list.is_empty());
    }
}
