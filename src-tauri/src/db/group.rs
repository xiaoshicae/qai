use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::models::group::Group;

pub fn list_all(conn: &Connection) -> Result<Vec<Group>, rusqlite::Error> {
    let mut stmt =
        conn.prepare("SELECT id, name, parent_id, sort_order FROM groups ORDER BY sort_order")?;
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

pub fn create(
    conn: &Connection,
    name: &str,
    parent_id: Option<&str>,
) -> Result<Group, rusqlite::Error> {
    let id = Uuid::new_v4().to_string();
    let max_sort: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM groups WHERE parent_id IS ?1",
            params![parent_id],
            |row| row.get(0),
        )
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
        |row| {
            Ok(Group {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                sort_order: row.get(3)?,
            })
        },
    )
}

pub fn update(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    parent_id: Option<Option<&str>>,
    sort_order: Option<i32>,
) -> Result<Group, rusqlite::Error> {
    if let Some(n) = name {
        conn.execute("UPDATE groups SET name = ?2 WHERE id = ?1", params![id, n])?;
    }
    if let Some(pid) = parent_id {
        conn.execute(
            "UPDATE groups SET parent_id = ?2 WHERE id = ?1",
            params![id, pid],
        )?;
    }
    if let Some(s) = sort_order {
        conn.execute(
            "UPDATE groups SET sort_order = ?2 WHERE id = ?1",
            params![id, s],
        )?;
    }
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    // ON DELETE CASCADE 会删子 groups；collections.group_id ON DELETE SET NULL
    conn.execute("DELETE FROM groups WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init::create_test_db;

    #[test]
    fn test_create_and_get() {
        let conn = create_test_db();
        let g = create(&conn, "API Tests", None).unwrap();
        assert_eq!(g.name, "API Tests");
        assert!(g.parent_id.is_none());

        let fetched = get(&conn, &g.id).unwrap();
        assert_eq!(fetched.name, "API Tests");
    }

    #[test]
    fn test_list_all() {
        let conn = create_test_db();
        create(&conn, "Group A", None).unwrap();
        create(&conn, "Group B", None).unwrap();
        let all = list_all(&conn).unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn test_create_nested() {
        let conn = create_test_db();
        let parent = create(&conn, "Parent", None).unwrap();
        let child = create(&conn, "Child", Some(&parent.id)).unwrap();
        assert_eq!(child.parent_id.as_deref(), Some(parent.id.as_str()));
    }

    #[test]
    fn test_update_name() {
        let conn = create_test_db();
        let g = create(&conn, "Old", None).unwrap();
        let updated = update(&conn, &g.id, Some("New"), None, None).unwrap();
        assert_eq!(updated.name, "New");
    }

    #[test]
    fn test_update_sort_order() {
        let conn = create_test_db();
        let g = create(&conn, "G", None).unwrap();
        let updated = update(&conn, &g.id, None, None, Some(5)).unwrap();
        assert_eq!(updated.sort_order, 5);
    }

    #[test]
    fn test_delete() {
        let conn = create_test_db();
        let g = create(&conn, "ToDelete", None).unwrap();
        delete(&conn, &g.id).unwrap();
        assert!(get(&conn, &g.id).is_err());
    }

    #[test]
    fn test_delete_cascades_children() {
        let conn = create_test_db();
        let parent = create(&conn, "Parent", None).unwrap();
        let child = create(&conn, "Child", Some(&parent.id)).unwrap();
        delete(&conn, &parent.id).unwrap();
        assert!(get(&conn, &child.id).is_err());
    }

    #[test]
    fn test_sort_order_auto_increment() {
        let conn = create_test_db();
        let g1 = create(&conn, "First", None).unwrap();
        let g2 = create(&conn, "Second", None).unwrap();
        assert_eq!(g1.sort_order, 0);
        assert_eq!(g2.sort_order, 1);
    }
}
