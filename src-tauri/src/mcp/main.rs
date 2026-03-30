//! QAI MCP Server — expose QAI API testing capabilities to Claude Code via stdio
//!
//! Usage: qai-mcp <db-path>

use std::io::{self, BufRead, Write};
use rusqlite::Connection;

#[path = "protocol.rs"]
mod protocol;
#[path = "server.rs"]
mod server;
#[path = "handlers.rs"]
mod handlers;
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

    if let Err(e) = conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;") {
        eprintln!("Failed to set PRAGMA: {e}");
        std::process::exit(1);
    }

    qai_lib::db::init::create_tables(&conn).unwrap_or_else(|e| {
        eprintln!("Failed to create tables: {e}");
        std::process::exit(1);
    });

    // 创建 tokio 运行时（用于 send_request / run_collection 等异步工具）
    let rt = tokio::runtime::Runtime::new().unwrap_or_else(|e| {
        eprintln!("Failed to create tokio runtime: {e}");
        std::process::exit(1);
    });

    // 创建 HTTP 客户端（用于执行 API 请求）
    let client = reqwest::Client::new();

    eprintln!("[qai-mcp] Started, db={db_path}");

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = io::BufReader::new(stdin.lock());
    let mut out = stdout.lock();

    loop {
        // 读取 Content-Length 头
        let mut content_length: Option<usize> = None;
        loop {
            let mut header_line = String::new();
            match reader.read_line(&mut header_line) {
                Ok(0) => { eprintln!("[qai-mcp] stdin closed"); return; }
                Err(_) => return,
                _ => {}
            }
            let trimmed = header_line.trim();
            if trimmed.is_empty() { break; }
            if let Some(len_str) = trimmed.strip_prefix("Content-Length:") {
                content_length = len_str.trim().parse().ok();
            }
        }

        let len = match content_length {
            Some(l) => l,
            None => continue,
        };

        let mut body = vec![0u8; len];
        if io::Read::read_exact(&mut reader, &mut body).is_err() { break; }

        let line = match String::from_utf8(body) {
            Ok(s) => s,
            Err(_) => continue,
        };

        let response = server::handle_request(&conn, &client, &rt, &line);
        let response_json = match serde_json::to_string(&response) {
            Ok(j) => j,
            Err(e) => {
                eprintln!("[qai-mcp] Failed to serialize response: {e}");
                continue;
            }
        };

        let resp_bytes = response_json.as_bytes();
        if write!(out, "Content-Length: {}\r\n\r\n", resp_bytes.len()).is_err()
            || out.write_all(resp_bytes).is_err()
            || out.flush().is_err()
        {
            eprintln!("[qai-mcp] Failed to write to stdout, exiting");
            break;
        }
    }

    eprintln!("[qai-mcp] Exiting");
}
