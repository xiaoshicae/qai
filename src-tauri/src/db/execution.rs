use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::models::execution::Execution;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: String,
    pub item_id: String,
    pub item_name: String,
    pub status: String,
    pub request_url: String,
    pub request_method: String,
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
pub struct HistoryStats {
    pub total: u64,
    pub success_count: u64,
    pub failed_count: u64,
    pub error_count: u64,
    pub avg_time_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunRecord {
    pub id: String,
    pub status: String,
    pub request_url: String,
    pub request_method: String,
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
pub struct ItemLastStatus {
    pub item_id: String,
    pub status: String,
    pub executed_at: String,
    pub response_time_ms: u64,
    pub assertion_total: u32,
    pub assertion_passed: u32,
}

pub fn list_recent(conn: &Connection, limit: u32) -> Result<Vec<HistoryEntry>, rusqlite::Error> {
    list_filtered(conn, None, None, None, limit, 0)
}

/// 带筛选/分页的历史查询
pub fn list_filtered(
    conn: &Connection,
    status: Option<&str>,
    method: Option<&str>,
    keyword: Option<&str>,
    limit: u32,
    offset: u32,
) -> Result<Vec<HistoryEntry>, rusqlite::Error> {
    let mut sql = String::from(
        "SELECT e.id, e.item_id, COALESCE(ci.name, '') as item_name, e.status, e.request_url, e.request_method,
                e.response_status, e.response_headers, e.response_body, e.response_time_ms, e.response_size,
                e.assertion_results, e.error_message, e.executed_at
         FROM executions e
         LEFT JOIN collection_items ci ON e.item_id = ci.id
         WHERE 1=1",
    );
    let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(s) = status {
        params_vec.push(Box::new(s.to_string()));
        sql.push_str(&format!(" AND e.status = ?{}", params_vec.len()));
    }
    if let Some(m) = method {
        params_vec.push(Box::new(m.to_string()));
        sql.push_str(&format!(" AND e.request_method = ?{}", params_vec.len()));
    }
    if let Some(kw) = keyword {
        let like = format!("%{}%", kw);
        params_vec.push(Box::new(like.clone()));
        let idx1 = params_vec.len();
        params_vec.push(Box::new(like));
        let idx2 = params_vec.len();
        sql.push_str(&format!(
            " AND (e.request_url LIKE ?{} OR ci.name LIKE ?{})",
            idx1, idx2
        ));
    }

    params_vec.push(Box::new(limit));
    let limit_idx = params_vec.len();
    params_vec.push(Box::new(offset));
    let offset_idx = params_vec.len();
    sql.push_str(&format!(
        " ORDER BY e.executed_at DESC LIMIT ?{} OFFSET ?{}",
        limit_idx, offset_idx
    ));

    let params_refs: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_refs.as_slice(), |row| {
        Ok(HistoryEntry {
            id: row.get(0)?,
            item_id: row.get(1)?,
            item_name: row.get(2)?,
            status: row.get(3)?,
            request_url: row.get(4)?,
            request_method: row.get(5)?,
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

/// 统计信息（全局或带筛选）
pub fn get_stats(conn: &Connection) -> Result<HistoryStats, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT COUNT(*),
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END),
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END),
                SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END),
                COALESCE(AVG(response_time_ms), 0)
         FROM executions",
    )?;
    stmt.query_row([], |row| {
        Ok(HistoryStats {
            total: row.get::<_, i64>(0)? as u64,
            success_count: row.get::<_, i64>(1)? as u64,
            failed_count: row.get::<_, i64>(2)? as u64,
            error_count: row.get::<_, i64>(3)? as u64,
            avg_time_ms: row.get::<_, f64>(4)? as u64,
        })
    })
}

/// 删除单条历史记录
pub fn delete_one(conn: &Connection, id: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM executions WHERE id = ?1", params![id])?;
    Ok(())
}

/// 清空全部历史记录
pub fn clear_all(conn: &Connection) -> Result<u64, rusqlite::Error> {
    let deleted = conn.execute("DELETE FROM executions", [])?;
    Ok(deleted as u64)
}

pub fn list_by_item(conn: &Connection, item_id: &str, limit: u32) -> Result<Vec<RunRecord>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, status, request_url, request_method, response_status, response_headers, response_body, response_time_ms, response_size, assertion_results, error_message, executed_at
         FROM executions WHERE item_id = ?1 ORDER BY executed_at DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![item_id, limit], |row| {
        Ok(RunRecord {
            id: row.get(0)?,
            status: row.get(1)?,
            request_url: row.get(2)?,
            request_method: row.get(3)?,
            response_status: row.get(4)?,
            response_headers: row.get(5)?,
            response_body: row.get(6)?,
            response_time_ms: row.get::<_, i64>(7)? as u64,
            response_size: row.get::<_, i64>(8)? as u64,
            assertion_results: row.get(9)?,
            error_message: row.get(10)?,
            executed_at: row.get(11)?,
        })
    })?;
    rows.collect()
}

pub fn get_last_status_for_collection(conn: &Connection, collection_id: &str) -> Result<Vec<ItemLastStatus>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT e.item_id, e.status, e.executed_at, e.response_time_ms, e.assertion_results
         FROM executions e
         INNER JOIN (
             SELECT item_id, MAX(executed_at) as max_at
             FROM executions
             WHERE collection_id = ?1
             GROUP BY item_id
         ) latest ON e.item_id = latest.item_id AND e.executed_at = latest.max_at",
    )?;
    let rows = stmt.query_map(params![collection_id], |row| {
        let assertion_json: String = row.get(4)?;
        let (total, passed) = count_assertions(&assertion_json);
        Ok(ItemLastStatus {
            item_id: row.get(0)?,
            status: row.get(1)?,
            executed_at: row.get(2)?,
            response_time_ms: row.get::<_, i64>(3)? as u64,
            assertion_total: total,
            assertion_passed: passed,
        })
    })?;
    rows.collect()
}

pub(crate) fn count_assertions(json: &str) -> (u32, u32) {
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
        "INSERT INTO executions (id, item_id, collection_id, batch_id, status, request_url, request_method, response_status, response_headers, response_body, response_time_ms, response_size, assertion_results, error_message)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            exec.id,
            exec.item_id,
            exec.collection_id,
            exec.batch_id,
            exec.status,
            exec.request_url,
            exec.request_method,
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

/// 清理旧历史，保留每个 item 最近 max_per_item 条
pub fn cleanup(conn: &Connection, max_per_item: u32) -> Result<u64, rusqlite::Error> {
    let deleted = conn.execute(
        "DELETE FROM executions WHERE id IN (
            SELECT id FROM (
                SELECT id, ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY executed_at DESC) as rn
                FROM executions
            ) WHERE rn > ?1
        )",
        params![max_per_item],
    )?;
    Ok(deleted as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_count_assertions_all_passed() {
        let json = r#"[{"passed":true},{"passed":true}]"#;
        assert_eq!(count_assertions(json), (2, 2));
    }

    #[test]
    fn test_count_assertions_mixed() {
        let json = r#"[{"passed":true},{"passed":false},{"passed":true}]"#;
        assert_eq!(count_assertions(json), (3, 2));
    }

    #[test]
    fn test_count_assertions_empty_array() {
        assert_eq!(count_assertions("[]"), (0, 0));
    }

    #[test]
    fn test_count_assertions_invalid_json() {
        assert_eq!(count_assertions("not json"), (0, 0));
    }

    #[test]
    fn test_count_assertions_missing_passed_field() {
        let json = r#"[{"other":"field"},{"passed":true}]"#;
        assert_eq!(count_assertions(json), (2, 1));
    }

    #[test]
    fn test_count_assertions_empty_string() {
        assert_eq!(count_assertions(""), (0, 0));
    }
}
