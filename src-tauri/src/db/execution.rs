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
