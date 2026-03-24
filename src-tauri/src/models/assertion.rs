use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Assertion {
    pub id: String,
    pub request_id: String,
    #[serde(rename = "type")]
    pub assertion_type: String,
    pub expression: String,
    pub operator: String,
    pub expected: String,
    pub enabled: bool,
    pub sort_order: i32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssertionResult {
    pub assertion_id: String,
    pub passed: bool,
    pub actual: String,
    pub message: String,
}
