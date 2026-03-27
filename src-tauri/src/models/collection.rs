use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub endpoint: String,
    pub subcategory: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub collection_id: String,
    pub parent_folder_id: Option<String>,
    pub name: String,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
    pub is_chain: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionTreeNode {
    pub id: String,
    pub name: String,
    pub node_type: TreeNodeType,
    pub method: Option<String>,
    pub is_chain: Option<bool>,
    pub children: Vec<CollectionTreeNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TreeNodeType {
    Collection,
    Folder,
    Request,
}
