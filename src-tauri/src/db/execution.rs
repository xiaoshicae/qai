use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::models::execution::Execution;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: String,
    pub request_id: String,
    pub status: String,
    pub request_url: String,
    pub request_method: String,
    pub response_status: Option<u16>,
    pub response_time_ms: u64,
    pub executed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunRecord {
    pub id: String,
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
pub struct RequestLastStatus {
    pub request_id: String,
    pub status: String,
    pub executed_at: String,
    pub response_time_ms: u64,
    pub assertion_total: u32,
    pub assertion_passed: u32,
}

pub fn list_recent(conn: &Connection, limit: u32) -> Result<Vec<HistoryEntry>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, request_id, status, request_url, request_method, response_status, response_time_ms, executed_at
         FROM executions ORDER BY executed_at DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |row| {
        Ok(HistoryEntry {
            id: row.get(0)?,
            request_id: row.get(1)?,
            status: row.get(2)?,
            request_url: row.get(3)?,
            request_method: row.get(4)?,
            response_status: row.get(5)?,
            response_time_ms: row.get::<_, i64>(6)? as u64,
            executed_at: row.get(7)?,
        })
    })?;
    rows.collect()
}

pub fn list_by_request(conn: &Connection, request_id: &str, limit: u32) -> Result<Vec<RunRecord>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, status, request_url, request_method, request_headers, request_body, response_status, response_headers, response_body, response_time_ms, response_size, assertion_results, error_message, executed_at
         FROM executions WHERE request_id = ?1 ORDER BY executed_at DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![request_id, limit], |row| {
        Ok(RunRecord {
            id: row.get(0)?,
            status: row.get(1)?,
            request_url: row.get(2)?,
            request_method: row.get(3)?,
            request_headers: row.get(4)?,
            request_body: row.get(5)?,
            response_status: row.get(6)?,
            response_headers: row.get(7)?,
            response_body: row.get(8)?,
            response_time_ms: row.get::<_, i64>(9)? as u64,
            response_size: row.get::<_, i64>(10)? as u64,
            assertion_results: row.get(11)?,
            error_message: row.get(12)?,
            executed_at: row.get(13)?,
        })
    })?;
    rows.collect()
}

pub fn get_last_status_for_collection(conn: &Connection, collection_id: &str) -> Result<Vec<RequestLastStatus>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT e.request_id, e.status, e.executed_at, e.response_time_ms, e.assertion_results
         FROM executions e
         INNER JOIN (
             SELECT request_id, MAX(executed_at) as max_at
             FROM executions
             WHERE request_id IN (SELECT id FROM requests WHERE collection_id = ?1)
             GROUP BY request_id
         ) latest ON e.request_id = latest.request_id AND e.executed_at = latest.max_at",
    )?;
    let rows = stmt.query_map(params![collection_id], |row| {
        let assertion_json: String = row.get(4)?;
        let (total, passed) = count_assertions(&assertion_json);
        Ok(RequestLastStatus {
            request_id: row.get(0)?,
            status: row.get(1)?,
            executed_at: row.get(2)?,
            response_time_ms: row.get::<_, i64>(3)? as u64,
            assertion_total: total,
            assertion_passed: passed,
        })
    })?;
    rows.collect()
}

fn count_assertions(json: &str) -> (u32, u32) {
    if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(json) {
        let total = arr.len() as u32;
        let passed = arr.iter().filter(|a| a.get("passed").and_then(|v| v.as_bool()).unwrap_or(false)).count() as u32;
        (total, passed)
    } else {
        (0, 0)
    }
}

pub fn save(conn: &Connection, exec: &Execution) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO executions (id, request_id, batch_id, status, request_url, request_method, request_headers, request_body, response_status, response_headers, response_body, response_time_ms, response_size, assertion_results, error_message)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            exec.id,
            exec.request_id,
            exec.batch_id,
            exec.status,
            exec.request_url,
            exec.request_method,
            exec.request_headers,
            exec.request_body,
            exec.response_status,
            exec.response_headers,
            exec.response_body,
            exec.response_time_ms as i64,
            exec.response_size as i64,
            exec.assertion_results,
            exec.error_message,
        ],
    )?;
    Ok(())
}
