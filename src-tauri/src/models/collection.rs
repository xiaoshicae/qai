use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub description: String,
    pub group_id: Option<String>,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionTreeNode {
    pub id: String,
    pub name: String,
    pub node_type: TreeNodeType,
    pub method: Option<String>,
    pub expect_status: Option<u16>,
    pub children: Vec<CollectionTreeNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TreeNodeType {
    Collection,
    Folder,
    Chain,
    Request,
}
