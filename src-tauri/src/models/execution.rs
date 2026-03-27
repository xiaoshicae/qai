use std::collections::HashMap;
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainResult {
    pub chain_id: String,
    pub folder_id: String,
    pub folder_name: String,
    pub total_steps: u32,
    pub completed_steps: u32,
    pub status: String,
    pub total_time_ms: u64,
    pub steps: Vec<ChainStepResult>,
    pub final_variables: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainStepResult {
    pub step_index: u32,
    pub execution_result: ExecutionResult,
    pub extracted_variables: HashMap<String, String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ChainProgress {
    pub chain_id: String,
    pub folder_id: String,
    pub step_index: u32,
    pub step_name: String,
    pub status: String,
    pub total_steps: u32,
}
