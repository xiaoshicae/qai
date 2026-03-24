use rusqlite::{params, Connection, Row};
use uuid::Uuid;

use crate::models::collection::{Collection, CollectionTreeNode, Folder, TreeNodeType};
use crate::models::request::ApiRequest;

fn collection_from_row(row: &Row) -> Result<Collection, rusqlite::Error> {
    Ok(Collection {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

fn folder_from_row(row: &Row) -> Result<Folder, rusqlite::Error> {
    Ok(Folder {
        id: row.get(0)?,
        collection_id: row.get(1)?,
        parent_folder_id: row.get(2)?,
        name: row.get(3)?,
        sort_order: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

const COLLECTION_COLS: &str = "id, name, description, created_at, updated_at";
const FOLDER_COLS: &str = "id, collection_id, parent_folder_id, name, sort_order, created_at, updated_at";

pub fn list_all(conn: &Connection) -> Result<Vec<Collection>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM collections ORDER BY created_at DESC", COLLECTION_COLS),
    )?;
    let rows = stmt.query_map([], collection_from_row)?;
    rows.collect()
}

pub fn create(conn: &Connection, name: &str, description: &str) -> Result<Collection, rusqlite::Error> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO collections (id, name, description) VALUES (?1, ?2, ?3)",
        params![id, name, description],
    )?;
    get(conn, &id)
}

pub fn get(conn: &Connection, id: &str) -> Result<Collection, rusqlite::Error> {
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM collections WHERE id = ?1", COLLECTION_COLS),
    )?;
    stmt.query_row(params![id], collection_from_row)
}

pub fn update(conn: &Connection, id: &str, name: &str, description: &str) -> Result<Collection, rusqlite::Error> {
    conn.execute(
        "UPDATE collections SET name = ?2, description = ?3, updated_at = datetime('now') WHERE id = ?1",
        params![id, name, description],
    )?;
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM collections WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn create_folder(
    conn: &Connection,
    collection_id: &str,
    parent_folder_id: Option<&str>,
    name: &str,
) -> Result<Folder, rusqlite::Error> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO folders (id, collection_id, parent_folder_id, name) VALUES (?1, ?2, ?3, ?4)",
        params![id, collection_id, parent_folder_id, name],
    )?;
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM folders WHERE id = ?1", FOLDER_COLS),
    )?;
    stmt.query_row(params![id], folder_from_row)
}

pub fn delete_folder(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn get_tree(conn: &Connection, collection_id: &str) -> Result<CollectionTreeNode, rusqlite::Error> {
    let collection = get(conn, collection_id)?;

    let folders: Vec<Folder> = {
        let mut stmt = conn.prepare(
            &format!("SELECT {} FROM folders WHERE collection_id = ?1 ORDER BY sort_order", FOLDER_COLS),
        )?;
        let rows = stmt.query_map(params![collection_id], folder_from_row)?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    let requests = crate::db::request::list_by_collection(conn, collection_id)?;

    fn build_folder_node(
        folder: &Folder,
        all_folders: &[Folder],
        all_requests: &[ApiRequest],
    ) -> CollectionTreeNode {
        let mut children: Vec<CollectionTreeNode> = Vec::new();

        for sub_folder in all_folders.iter().filter(|f| f.parent_folder_id.as_deref() == Some(&folder.id)) {
            children.push(build_folder_node(sub_folder, all_folders, all_requests));
        }

        for req in all_requests.iter().filter(|r| r.folder_id.as_deref() == Some(&folder.id)) {
            children.push(CollectionTreeNode {
                id: req.id.clone(),
                name: req.name.clone(),
                node_type: TreeNodeType::Request,
                method: Some(req.method.clone()),
                children: vec![],
            });
        }

        CollectionTreeNode {
            id: folder.id.clone(),
            name: folder.name.clone(),
            node_type: TreeNodeType::Folder,
            method: None,
            children,
        }
    }

    let mut children: Vec<CollectionTreeNode> = Vec::new();

    for folder in folders.iter().filter(|f| f.parent_folder_id.is_none()) {
        children.push(build_folder_node(folder, &folders, &requests));
    }

    for req in requests.iter().filter(|r| r.folder_id.is_none()) {
        children.push(CollectionTreeNode {
            id: req.id.clone(),
            name: req.name.clone(),
            node_type: TreeNodeType::Request,
            method: Some(req.method.clone()),
            children: vec![],
        });
    }

    Ok(CollectionTreeNode {
        id: collection.id,
        name: collection.name,
        node_type: TreeNodeType::Collection,
        method: None,
        children,
    })
}
