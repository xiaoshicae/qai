use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Execution {
    pub id: String,
    pub request_id: String,
    pub batch_id: Option<String>,
    pub status: String,
    pub request_url: String,
    pub request_method: String,
    pub request_headers: String,
    pub request_body: Option<String>,
    pub response_status: Option<u16>,
    pub response_headers: String,
    pub response_body: Option<String>,
    pub response_time_ms: u64,
    pub response_size: u64,
    pub assertion_results: String,
    pub error_message: Option<String>,
    pub executed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionResult {
    pub execution_id: String,
    pub request_id: String,
    pub request_name: String,
    pub status: String,
    pub response: Option<super::request::HttpResponse>,
    pub assertion_results: Vec<super::assertion::AssertionResult>,
    pub error_message: Option<String>,
}
