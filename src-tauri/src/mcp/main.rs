//! QAI MCP Server — expose QAI API testing capabilities to Claude Code via stdio
//!
//! Usage: qai-mcp <db-path>
//!
//! 支持两种 stdio 传输格式：
//! - 换行分隔 JSON（Claude Code 使用此格式）
//! - Content-Length 帧协议（标准 MCP/LSP 格式）

use rusqlite::Connection;
use std::io::{self, BufRead, Write};

#[path = "handlers.rs"]
mod handlers;
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

    if let Err(e) = conn
        .execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;")
    {
        eprintln!("Failed to set PRAGMA: {e}");
        std::process::exit(1);
    }

    qai_lib::db::init::create_tables(&conn).unwrap_or_else(|e| {
        eprintln!("Failed to create tables: {e}");
        std::process::exit(1);
    });

    let rt = tokio::runtime::Runtime::new().unwrap_or_else(|e| {
        eprintln!("Failed to create tokio runtime: {e}");
        std::process::exit(1);
    });

    let client = reqwest::Client::new();

    eprintln!("[qai-mcp] Started, db={db_path}");

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = io::BufReader::new(stdin.lock());
    let mut out = stdout.lock();

    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => {
                eprintln!("[qai-mcp] stdin closed");
                return;
            }
            Err(_) => return,
            _ => {}
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // 检测传输格式：Content-Length 帧 vs 换行分隔 JSON
        if trimmed.starts_with("Content-Length:") {
            // Content-Length 帧协议：读取空行分隔，再读 body
            let len: usize = match trimmed
                .strip_prefix("Content-Length:")
                .and_then(|s| s.trim().parse().ok())
            {
                Some(l) => l,
                None => continue,
            };
            // 消耗空行
            let mut blank = String::new();
            let _ = reader.read_line(&mut blank);
            // 读取 body
            let mut body = vec![0u8; len];
            if io::Read::read_exact(&mut reader, &mut body).is_err() {
                break;
            }
            let json_str = match String::from_utf8(body) {
                Ok(s) => s,
                Err(_) => continue,
            };
            if let Some(resp) = server::handle_request(&conn, &client, &rt, &json_str) {
                write_content_length(&mut out, &resp);
            }
        } else if trimmed.starts_with('{') {
            // 换行分隔 JSON（Claude Code 使用此格式）
            if let Some(resp) = server::handle_request(&conn, &client, &rt, trimmed) {
                write_newline_json(&mut out, &resp);
            }
        }
        // 其他行忽略
    }
}

/// Content-Length 帧格式输出
fn write_content_length(out: &mut impl Write, resp: &protocol::JsonRpcResponse) {
    let json = match serde_json::to_string(resp) {
        Ok(j) => j,
        Err(e) => {
            eprintln!("[qai-mcp] serialize error: {e}");
            return;
        }
    };
    let bytes = json.as_bytes();
    if write!(out, "Content-Length: {}\r\n\r\n", bytes.len()).is_err()
        || out.write_all(bytes).is_err()
        || out.flush().is_err()
    {
        eprintln!("[qai-mcp] stdout write failed");
    }
}

/// 换行分隔 JSON 格式输出
fn write_newline_json(out: &mut impl Write, resp: &protocol::JsonRpcResponse) {
    let json = match serde_json::to_string(resp) {
        Ok(j) => j,
        Err(e) => {
            eprintln!("[qai-mcp] serialize error: {e}");
            return;
        }
    };
    if writeln!(out, "{json}").is_err() || out.flush().is_err() {
        eprintln!("[qai-mcp] stdout write failed");
    }
}
