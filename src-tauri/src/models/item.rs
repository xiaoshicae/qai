use serde::{Deserialize, Serialize};

/// 集合内的统一节点：folder / chain / request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionItem {
    pub id: String,
    pub collection_id: String,
    pub parent_id: Option<String>,
    #[serde(rename = "type")]
    pub item_type: String, // "folder" | "chain" | "request"
    pub name: String,
    pub sort_order: i32,
    // 以下字段仅 request 类型使用
    pub method: String,
    pub url: String,
    pub headers: String,
    pub query_params: String,
    pub body_type: String,
    pub body_content: String,
    pub extract_rules: String,
    pub description: String,
    pub expect_status: u16,
    pub poll_config: String,
    pub protocol: String, // "http" | "websocket"
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PollConfig {
    pub field: String,
    pub target: String,
    pub interval_seconds: u64,
    pub max_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractRule {
    pub var_name: String,
    pub source: String,
    pub expression: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyValuePair {
    pub key: String,
    pub value: String,
    pub enabled: bool,
    #[serde(default)]
    pub field_type: String, // "text" | "file"，默认空字符串视为 text
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<KeyValuePair>,
    pub body: String,
    pub time_ms: u64,
    pub size_bytes: u64,
}
