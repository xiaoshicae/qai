use rusqlite::{params, Connection, Row};
use uuid::Uuid;

use crate::models::item::CollectionItem;

const ITEM_COLS: &str = "id, collection_id, parent_id, type, name, sort_order, method, url, headers, query_params, body_type, body_content, extract_rules, description, expect_status, poll_config, protocol, created_at, updated_at";

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
        protocol: row.get(16).unwrap_or_else(|_| "http".to_string()),
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
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

pub fn list_by_collection(
    conn: &Connection,
    collection_id: &str,
) -> Result<Vec<CollectionItem>, rusqlite::Error> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM collection_items WHERE collection_id = ?1 ORDER BY sort_order",
        ITEM_COLS
    ))?;
    let rows = stmt.query_map(params![collection_id], item_from_row)?;
    rows.collect()
}

pub fn list_by_parent(
    conn: &Connection,
    parent_id: &str,
) -> Result<Vec<CollectionItem>, rusqlite::Error> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM collection_items WHERE parent_id = ?1 ORDER BY sort_order",
        ITEM_COLS
    ))?;
    let rows = stmt.query_map(params![parent_id], item_from_row)?;
    rows.collect()
}

/// 列出集合中所有 type=request 的项（忽略 folder/chain 容器）
pub fn list_requests_by_collection(
    conn: &Connection,
    collection_id: &str,
) -> Result<Vec<CollectionItem>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM collection_items WHERE collection_id = ?1 AND type = 'request' ORDER BY sort_order", ITEM_COLS),
    )?;
    let rows = stmt.query_map(params![collection_id], item_from_row)?;
    rows.collect()
}

pub fn update(
    conn: &Connection,
    id: &str,
    payload: &crate::models::item::UpdateItemPayload,
) -> Result<CollectionItem, rusqlite::Error> {
    let mut u = super::DynamicUpdate::new();
    u.set_opt("name", payload.name.clone());
    u.set_opt("method", payload.method.clone());
    u.set_opt("url", payload.url.clone());
    u.set_opt("headers", payload.headers.clone());
    u.set_opt("query_params", payload.query_params.clone());
    u.set_opt("body_type", payload.body_type.clone());
    u.set_opt("body_content", payload.body_content.clone());
    u.set_opt("extract_rules", payload.extract_rules.clone());
    u.set_opt("description", payload.description.clone());
    u.set_opt("protocol", payload.protocol.clone());
    u.set_opt("expect_status", payload.expect_status.map(|es| es as i32));
    if let Some(ref pid) = payload.parent_id {
        u.set("parent_id", pid.clone());
    }
    u.execute(conn, "collection_items", id)?;
    get(conn, id)
}

/// 轻量级列表查询 — 不取 body_content/headers/query_params 等大字段，用于树/列表展示
pub fn list_summary_by_collection(
    conn: &Connection,
    collection_id: &str,
) -> Result<Vec<CollectionItem>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, collection_id, parent_id, type, name, sort_order, method, url, \
         '' as headers, '' as query_params, body_type, '' as body_content, \
         '' as extract_rules, description, expect_status, '' as poll_config, protocol, \
         created_at, updated_at \
         FROM collection_items WHERE collection_id = ?1 ORDER BY sort_order",
    )?;
    let rows = stmt.query_map(params![collection_id], item_from_row)?;
    rows.collect()
}

/// 复制一个 item（含断言和子项），新 item 排在同级最后
/// 使用事务确保原子性：任何失败都会回滚
pub fn duplicate(conn: &mut Connection, id: &str) -> Result<CollectionItem, rusqlite::Error> {
    let tx = conn.transaction()?;
    let result = duplicate_in_tx(&tx, id);
    match result {
        Ok(item) => {
            tx.commit()?;
            Ok(item)
        }
        Err(e) => {
            // 事务会在 drop 时自动回滚
            Err(e)
        }
    }
}

fn duplicate_in_tx(conn: &Connection, id: &str) -> Result<CollectionItem, rusqlite::Error> {
    let src = get(conn, id)?;
    let new_id = Uuid::new_v4().to_string();
    let new_name = format!("{}-copy", src.name);
    let max_sort: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM collection_items WHERE collection_id = ?1 AND parent_id IS ?2",
            params![src.collection_id, src.parent_id],
            |row| row.get(0),
        )
        .unwrap_or(-1);
    duplicate_single(
        conn,
        &src,
        &new_id,
        &new_name,
        src.parent_id.as_deref(),
        max_sort + 1,
    )?;
    // 递归复制子项（chain/folder 下的 steps）
    let children = list_by_parent(conn, id)?;
    for child in &children {
        let child_new_id = Uuid::new_v4().to_string();
        duplicate_single(
            conn,
            child,
            &child_new_id,
            &child.name,
            Some(&new_id),
            child.sort_order,
        )?;
    }
    get(conn, &new_id)
}

/// 复制单个 item 及其断言（不递归）
fn duplicate_single(
    conn: &Connection,
    src: &CollectionItem,
    new_id: &str,
    new_name: &str,
    parent_id: Option<&str>,
    sort_order: i32,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        &format!(
            "INSERT INTO collection_items ({}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17, datetime('now','localtime'), datetime('now','localtime'))",
            ITEM_COLS
        ),
        params![
            new_id, src.collection_id, parent_id, src.item_type, new_name,
            sort_order, src.method, src.url, src.headers, src.query_params,
            src.body_type, src.body_content, src.extract_rules, src.description,
            src.expect_status, src.poll_config, src.protocol,
        ],
    )?;
    let assertions = crate::db::assertion::list_by_item(conn, &src.id)?;
    for a in &assertions {
        let aid = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO assertions (id, item_id, type, expression, operator, expected, enabled, sort_order) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![aid, new_id, a.assertion_type, a.expression, a.operator, a.expected, a.enabled, a.sort_order],
        )?;
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM collection_items WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init::create_test_db;

    fn setup() -> (Connection, String) {
        let conn = create_test_db();
        let c = crate::db::collection::create(&conn, "Suite", "", None).unwrap();
        (conn, c.id)
    }

    #[test]
    fn test_create_request() {
        let (conn, cid) = setup();
        let item = create(&conn, &cid, None, "request", "Login", "POST").unwrap();
        assert_eq!(item.name, "Login");
        assert_eq!(item.method, "POST");
        assert_eq!(item.item_type, "request");
        assert_eq!(item.collection_id, cid);
    }

    #[test]
    fn test_create_folder() {
        let (conn, cid) = setup();
        let item = create(&conn, &cid, None, "folder", "Auth", "GET").unwrap();
        assert_eq!(item.item_type, "folder");
    }

    #[test]
    fn test_create_with_parent() {
        let (conn, cid) = setup();
        let folder = create(&conn, &cid, None, "folder", "Folder", "GET").unwrap();
        let req = create(&conn, &cid, Some(&folder.id), "request", "Req", "GET").unwrap();
        assert_eq!(req.parent_id.as_deref(), Some(folder.id.as_str()));
    }

    #[test]
    fn test_get() {
        let (conn, cid) = setup();
        let item = create(&conn, &cid, None, "request", "Test", "GET").unwrap();
        let fetched = get(&conn, &item.id).unwrap();
        assert_eq!(fetched.name, "Test");
    }

    #[test]
    fn test_list_by_collection() {
        let (conn, cid) = setup();
        create(&conn, &cid, None, "request", "A", "GET").unwrap();
        create(&conn, &cid, None, "request", "B", "POST").unwrap();
        let items = list_by_collection(&conn, &cid).unwrap();
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn test_list_by_parent() {
        let (conn, cid) = setup();
        let folder = create(&conn, &cid, None, "folder", "F", "GET").unwrap();
        create(&conn, &cid, Some(&folder.id), "request", "Child", "GET").unwrap();
        let children = list_by_parent(&conn, &folder.id).unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].name, "Child");
    }

    #[test]
    fn test_list_requests_by_collection() {
        let (conn, cid) = setup();
        create(&conn, &cid, None, "folder", "F", "GET").unwrap();
        create(&conn, &cid, None, "request", "R", "GET").unwrap();
        let reqs = list_requests_by_collection(&conn, &cid).unwrap();
        assert_eq!(reqs.len(), 1);
        assert_eq!(reqs[0].item_type, "request");
    }

    #[test]
    fn test_update() {
        let (conn, cid) = setup();
        let item = create(&conn, &cid, None, "request", "Old", "GET").unwrap();
        let payload = crate::models::item::UpdateItemPayload {
            name: Some("New".to_string()),
            method: Some("POST".to_string()),
            url: Some("http://example.com".to_string()),
            ..Default::default()
        };
        let updated = update(&conn, &item.id, &payload).unwrap();
        assert_eq!(updated.name, "New");
        assert_eq!(updated.method, "POST");
        assert_eq!(updated.url, "http://example.com");
    }

    #[test]
    fn test_delete() {
        let (conn, cid) = setup();
        let item = create(&conn, &cid, None, "request", "Del", "GET").unwrap();
        delete(&conn, &item.id).unwrap();
        assert!(get(&conn, &item.id).is_err());
    }

    #[test]
    fn test_sort_order_auto() {
        let (conn, cid) = setup();
        let a = create(&conn, &cid, None, "request", "A", "GET").unwrap();
        let b = create(&conn, &cid, None, "request", "B", "GET").unwrap();
        assert_eq!(a.sort_order, 0);
        assert_eq!(b.sort_order, 1);
    }

    #[test]
    fn test_cascade_delete_collection() {
        let (conn, cid) = setup();
        create(&conn, &cid, None, "request", "R", "GET").unwrap();
        crate::db::collection::delete(&conn, &cid).unwrap();
        let items = list_by_collection(&conn, &cid).unwrap();
        assert!(items.is_empty());
    }
}
