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
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM collections ORDER BY sort_order, created_at DESC", COLLECTION_COLS),
    )?;
    let rows = stmt.query_map([], collection_from_row)?;
    rows.collect()
}

pub fn create(conn: &Connection, name: &str, description: &str, group_id: Option<&str>) -> Result<Collection, rusqlite::Error> {
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
    let mut sets: Vec<String> = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(n) = name {
        sets.push(format!("name = ?{}", values.len() + 1));
        values.push(Box::new(n.to_string()));
    }
    if let Some(d) = description {
        sets.push(format!("description = ?{}", values.len() + 1));
        values.push(Box::new(d.to_string()));
    }
    if let Some(gid) = group_id {
        sets.push(format!("group_id = ?{}", values.len() + 1));
        values.push(Box::new(gid.map(|s| s.to_string())));
    }
    if let Some(so) = sort_order {
        sets.push(format!("sort_order = ?{}", values.len() + 1));
        values.push(Box::new(so));
    }
    if !sets.is_empty() {
        sets.push("updated_at = datetime('now', 'localtime')".to_string());
        let idx = values.len() + 1;
        let sql = format!("UPDATE collections SET {} WHERE id = ?{}", sets.join(", "), idx);
        values.push(Box::new(id.to_string()));
        let params: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|v| v.as_ref()).collect();
        conn.execute(&sql, params.as_slice())?;
    }
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM collections WHERE id = ?1", params![id])?;
    Ok(())
}

/// 构建集合树（从 collection_items 读取）
pub fn get_tree(conn: &Connection, collection_id: &str) -> Result<CollectionTreeNode, rusqlite::Error> {
    let collection = get(conn, collection_id)?;

    let items = crate::db::item::list_by_collection(conn, collection_id)?;

    fn build_children(parent_id: Option<&str>, all_items: &[CollectionItem]) -> Vec<CollectionTreeNode> {
        let mut children: Vec<CollectionTreeNode> = Vec::new();
        for item in all_items.iter().filter(|i| i.parent_id.as_deref() == parent_id) {
            let node_type = match item.item_type.as_str() {
                "folder" => TreeNodeType::Folder,
                "chain" => TreeNodeType::Chain,
                _ => TreeNodeType::Request,
            };
            let is_container = item.item_type != "request";
            children.push(CollectionTreeNode {
                id: item.id.clone(),
                name: item.name.clone(),
                node_type,
                method: if is_container { None } else { Some(item.method.clone()) },
                expect_status: if is_container { None } else { Some(item.expect_status) },
                children: if is_container { build_children(Some(&item.id), all_items) } else { vec![] },
            });
        }
        children.sort_by_key(|c| {
            all_items.iter().find(|i| i.id == c.id).map(|i| i.sort_order).unwrap_or(0)
        });
        children
    }

    Ok(CollectionTreeNode {
        id: collection.id,
        name: collection.name,
        node_type: TreeNodeType::Collection,
        method: None,
        expect_status: None,
        children: build_children(None, &items),
    })
}
