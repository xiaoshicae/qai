use rusqlite::{params, Connection, Row};
use uuid::Uuid;

use crate::models::collection::{Collection, CollectionTreeNode, TreeNodeType};
use crate::models::item::CollectionItem;

const COLLECTION_COLS: &str = "id, name, description, group_id, sort_order, created_at, updated_at";

fn collection_from_row(row: &Row) -> Result<Collection, rusqlite::Error> {
    Ok(Collection {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        group_id: row.get(3)?,
        sort_order: row.get(4).unwrap_or(0),
        created_at: row.get(5).unwrap_or_default(),
        updated_at: row.get(6).unwrap_or_default(),
    })
}

pub fn list_all(conn: &Connection) -> Result<Vec<Collection>, rusqlite::Error> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM collections ORDER BY sort_order, created_at DESC",
        COLLECTION_COLS
    ))?;
    let rows = stmt.query_map([], collection_from_row)?;
    rows.collect()
}

pub fn create(
    conn: &Connection,
    name: &str,
    description: &str,
    group_id: Option<&str>,
) -> Result<Collection, rusqlite::Error> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO collections (id, name, description, group_id) VALUES (?1, ?2, ?3, ?4)",
        params![id, name, description, group_id],
    )?;
    get(conn, &id)
}

pub fn get(conn: &Connection, id: &str) -> Result<Collection, rusqlite::Error> {
    conn.query_row(
        &format!("SELECT {} FROM collections WHERE id = ?1", COLLECTION_COLS),
        params![id],
        collection_from_row,
    )
}

pub fn update(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    description: Option<&str>,
    group_id: Option<Option<&str>>,
    sort_order: Option<i32>,
) -> Result<Collection, rusqlite::Error> {
    let mut u = super::DynamicUpdate::new();
    u.set_opt("name", name.map(|s| s.to_string()));
    u.set_opt("description", description.map(|s| s.to_string()));
    if let Some(gid) = group_id {
        u.set("group_id", gid.map(|s| s.to_string()));
    }
    u.set_opt("sort_order", sort_order);
    u.execute(conn, "collections", id)?;
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM collections WHERE id = ?1", params![id])?;
    Ok(())
}

/// 构建集合树（从 collection_items 读取）
pub fn get_tree(
    conn: &Connection,
    collection_id: &str,
) -> Result<CollectionTreeNode, rusqlite::Error> {
    let collection = get(conn, collection_id)?;
    let items = crate::db::item::list_summary_by_collection(conn, collection_id)?;

    // 按 parent_id 预分组，O(N) 构建
    let mut children_map: std::collections::HashMap<Option<String>, Vec<&CollectionItem>> =
        std::collections::HashMap::new();
    for item in &items {
        children_map
            .entry(item.parent_id.clone())
            .or_default()
            .push(item);
    }

    fn build_children(
        parent_id: Option<&str>,
        children_map: &std::collections::HashMap<Option<String>, Vec<&CollectionItem>>,
    ) -> Vec<CollectionTreeNode> {
        let key = parent_id.map(|s| s.to_string());
        let Some(children) = children_map.get(&key) else {
            return vec![];
        };
        let mut nodes: Vec<CollectionTreeNode> = children
            .iter()
            .map(|item| {
                let node_type = match item.item_type.as_str() {
                    crate::models::item_type::FOLDER => TreeNodeType::Folder,
                    crate::models::item_type::CHAIN => TreeNodeType::Chain,
                    _ => TreeNodeType::Request,
                };
                let is_container = item.item_type != crate::models::item_type::REQUEST;
                CollectionTreeNode {
                    id: item.id.clone(),
                    name: item.name.clone(),
                    node_type,
                    method: if is_container {
                        None
                    } else {
                        Some(item.method.clone())
                    },
                    expect_status: if is_container {
                        None
                    } else {
                        Some(item.expect_status)
                    },
                    children: if is_container {
                        build_children(Some(&item.id), children_map)
                    } else {
                        vec![]
                    },
                }
            })
            .collect();
        nodes.sort_by_key(|n| {
            children
                .iter()
                .find(|i| i.id == n.id)
                .map(|i| i.sort_order)
                .unwrap_or(0)
        });
        nodes
    }

    Ok(CollectionTreeNode {
        id: collection.id,
        name: collection.name,
        node_type: TreeNodeType::Collection,
        method: None,
        expect_status: None,
        children: build_children(None, &children_map),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init::create_test_db;

    #[test]
    fn test_create_and_get() {
        let conn = create_test_db();
        let g = crate::db::group::create(&conn, "G", None).unwrap();
        let c = create(&conn, "Suite", "desc", Some(&g.id)).unwrap();
        assert_eq!(c.name, "Suite");
        assert_eq!(c.description, "desc");
        assert_eq!(c.group_id.as_deref(), Some(g.id.as_str()));
        let fetched = get(&conn, &c.id).unwrap();
        assert_eq!(fetched.name, "Suite");
    }

    #[test]
    fn test_create_without_group() {
        let conn = create_test_db();
        let c = create(&conn, "NoGroup", "", None).unwrap();
        assert!(c.group_id.is_none());
    }

    #[test]
    fn test_list_all() {
        let conn = create_test_db();
        create(&conn, "A", "", None).unwrap();
        create(&conn, "B", "", None).unwrap();
        let all = list_all(&conn).unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn test_update() {
        let conn = create_test_db();
        let c = create(&conn, "Old", "old desc", None).unwrap();
        let updated = update(&conn, &c.id, Some("New"), Some("new desc"), None, None).unwrap();
        assert_eq!(updated.name, "New");
        assert_eq!(updated.description, "new desc");
    }

    #[test]
    fn test_update_sort_order() {
        let conn = create_test_db();
        let c = create(&conn, "C", "", None).unwrap();
        let updated = update(&conn, &c.id, None, None, None, Some(10)).unwrap();
        assert_eq!(updated.sort_order, 10);
    }

    #[test]
    fn test_delete() {
        let conn = create_test_db();
        let c = create(&conn, "Del", "", None).unwrap();
        delete(&conn, &c.id).unwrap();
        assert!(get(&conn, &c.id).is_err());
    }

    #[test]
    fn test_delete_group_sets_null() {
        let conn = create_test_db();
        let g = crate::db::group::create(&conn, "G", None).unwrap();
        let c = create(&conn, "C", "", Some(&g.id)).unwrap();
        crate::db::group::delete(&conn, &g.id).unwrap();
        let fetched = get(&conn, &c.id).unwrap();
        assert!(fetched.group_id.is_none());
    }

    #[test]
    fn test_get_tree_empty() {
        let conn = create_test_db();
        let c = create(&conn, "Empty", "", None).unwrap();
        let tree = get_tree(&conn, &c.id).unwrap();
        assert_eq!(tree.name, "Empty");
        assert!(tree.children.is_empty());
    }

    #[test]
    fn test_get_tree_with_items() {
        let conn = create_test_db();
        let c = create(&conn, "Suite", "", None).unwrap();
        crate::db::item::create(&conn, &c.id, None, "request", "Login", "POST").unwrap();
        crate::db::item::create(&conn, &c.id, None, "folder", "Users", "GET").unwrap();
        let tree = get_tree(&conn, &c.id).unwrap();
        assert_eq!(tree.children.len(), 2);
    }
}
