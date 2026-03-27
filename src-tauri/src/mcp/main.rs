//! QAI MCP Server — 通过 stdio 暴露 QAI 测试用例管理能力给 Claude Code
//!
//! 用法: qai-mcp <db-path>

use std::io::{self, BufRead, Write};
use rusqlite::Connection;

#[path = "protocol.rs"]
mod protocol;
#[path = "server.rs"]
mod server;
#[path = "tools.rs"]
mod tools;

fn main() {
    let db_path = std::env::args().nth(1).unwrap_or_else(|| {
        eprintln!("Usage: qai-mcp <db-path>");
        std::process::exit(1);
    });

    let conn = Connection::open(&db_path).unwrap_or_else(|e| {
        eprintln!("Failed to open database: {e}");
        std::process::exit(1);
    });

    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")
        .unwrap();

    // 确保表存在（与主应用相同的迁移）
    qai_lib::db::init::create_tables(&conn).unwrap_or_else(|e| {
        eprintln!("Failed to create tables: {e}");
        std::process::exit(1);
    });

    eprintln!("[qai-mcp] Started, db={db_path}");

    // MCP 服务主循环：逐行读 JSON-RPC from stdin, 写响应到 stdout
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };

        if line.trim().is_empty() {
            continue;
        }

        let response = server::handle_request(&conn, &line);
        let response_json = serde_json::to_string(&response).unwrap();

        writeln!(out, "{response_json}").unwrap();
        out.flush().unwrap();
    }

    eprintln!("[qai-mcp] Exiting");
}
