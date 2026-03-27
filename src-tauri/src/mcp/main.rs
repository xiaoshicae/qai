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

    // MCP 服务主循环：Content-Length 分帧的 JSON-RPC (stdio transport)
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = io::BufReader::new(stdin.lock());
    let mut out = stdout.lock();

    loop {
        // 读取 headers（Content-Length: N\r\n\r\n）
        let mut content_length: Option<usize> = None;
        loop {
            let mut header_line = String::new();
            match reader.read_line(&mut header_line) {
                Ok(0) => { eprintln!("[qai-mcp] stdin closed"); return; }
                Err(_) => return,
                _ => {}
            }
            let trimmed = header_line.trim();
            if trimmed.is_empty() {
                break; // 空行 = headers 结束
            }
            if let Some(len_str) = trimmed.strip_prefix("Content-Length:") {
                content_length = len_str.trim().parse().ok();
            }
        }

        let len = match content_length {
            Some(l) => l,
            None => {
                // 也尝试纯行模式（兼容简单测试）
                continue;
            }
        };

        // 读取 body
        let mut body = vec![0u8; len];
        if io::Read::read_exact(&mut reader, &mut body).is_err() {
            break;
        }

        let line = match String::from_utf8(body) {
            Ok(s) => s,
            Err(_) => continue,
        };

        let response = server::handle_request(&conn, &line);
        let response_json = serde_json::to_string(&response).unwrap();

        // 写入 Content-Length 头 + body
        let resp_bytes = response_json.as_bytes();
        write!(out, "Content-Length: {}\r\n\r\n", resp_bytes.len()).unwrap();
        out.write_all(resp_bytes).unwrap();
        out.flush().unwrap();
    }

    eprintln!("[qai-mcp] Exiting");
}
