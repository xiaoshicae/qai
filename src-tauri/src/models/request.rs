use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiRequest {
    pub id: String,
    pub collection_id: String,
    pub folder_id: Option<String>,
    pub name: String,
    pub method: String,
    pub url: String,
    pub headers: String,
    pub query_params: String,
    pub body_type: String,
    pub body_content: String,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
    pub extract_rules: String,
    pub description: String,
    pub expect_status: u16,
    pub poll_config: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PollConfig {
    pub field: String,          // JSON 字段名，如 "status"
    pub target: String,         // 目标值，如 "completed"
    pub interval_seconds: u64,  // 轮询间隔
    pub max_seconds: u64,       // 最大等待时间
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractRule {
    pub var_name: String,
    pub source: String,     // "json_body", "header", "status_code"
    pub expression: String, // JSONPath 或 header 名称
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyValuePair {
    pub key: String,
    pub value: String,
    pub enabled: bool,
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
