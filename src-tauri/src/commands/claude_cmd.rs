use std::process::Stdio;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

pub struct ClaudeState {
    pid: Mutex<Option<u32>>,
    session_id: Mutex<Option<String>>, // 复用 session 加速后续对话
}

impl ClaudeState {
    pub fn new() -> Self {
        Self { pid: Mutex::new(None), session_id: Mutex::new(None) }
    }
}

#[derive(Clone, serde::Serialize)]
pub struct ClaudeEvent {
    pub event_type: String,
    pub content: String,
    pub raw: Option<serde_json::Value>,
}

#[tauri::command]
pub async fn claude_send(
    app: AppHandle,
    claude_state: State<'_, ClaudeState>,
    message: String,
    mcp_config_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let claude_bin = which_claude().unwrap_or_else(|| "claude".to_string());
    let existing_session = claude_state.session_id.lock().unwrap().clone();

    let mut args: Vec<String> = vec![
        "-p".into(),
        "--output-format".into(), "stream-json".into(),
        "--verbose".into(),
        "--include-partial-messages".into(),
    ];

    if let Some(ref config) = mcp_config_path {
        args.push(format!("--mcp-config={config}"));
    }

    // 复用 session：第一次慢（~30s），后续快（~3s）
    if let Some(ref sid) = existing_session {
        args.push("--resume".into());
        args.push(sid.clone());
    }

    args.push(message);

    let mut cmd = Command::new(&claude_bin);
    cmd.args(&args);

    let path = std::env::var("PATH").unwrap_or_default();
    cmd.env("PATH", format!("/opt/homebrew/bin:/usr/local/bin:{path}"));
    if let Ok(home) = std::env::var("HOME") { cmd.env("HOME", &home); }

    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("启动 Claude 失败: {e}"))?;
    if let Some(pid) = child.id() { *claude_state.pid.lock().unwrap() = Some(pid); }

    let stdout = child.stdout.take().ok_or("无法获取 stdout")?;
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    let mut final_result = serde_json::Value::Null;

    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() { continue; }
        let json: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v, Err(_) => continue,
        };
        let event_type = json.get("type").and_then(|v| v.as_str()).unwrap_or("");

        match event_type {
            "stream_event" => {
                if let Some(event) = json.get("event") {
                    let sub = event.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    if sub == "content_block_delta" {
                        if let Some(text) = event.get("delta").and_then(|d| d.get("text")).and_then(|t| t.as_str()) {
                            if !text.is_empty() {
                                let _ = app.emit("claude-event", ClaudeEvent { event_type: "delta".into(), content: text.into(), raw: None });
                            }
                        }
                    }
                }
            }
            "assistant" => {
                if let Some(content) = json.get("message").and_then(|m| m.get("content")).and_then(|c| c.as_array()) {
                    for block in content {
                        if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                            let name = block.get("name").and_then(|n| n.as_str()).unwrap_or("");
                            let _ = app.emit("claude-event", ClaudeEvent { event_type: "tool_use".into(), content: format!("调用工具: {name}"), raw: Some(block.clone()) });
                        }
                    }
                }
            }
            "result" => {
                // 保存 session_id 用于下次 --resume
                if let Some(sid) = json.get("session_id").and_then(|s| s.as_str()) {
                    *claude_state.session_id.lock().unwrap() = Some(sid.to_string());
                }
                let _ = app.emit("claude-event", ClaudeEvent { event_type: "result".into(), content: String::new(), raw: Some(json.clone()) });
                final_result = json;
            }
            _ => {}
        }
    }

    // stderr
    if let Some(stderr) = child.stderr.take() {
        let mut r = BufReader::new(stderr);
        let mut buf = String::new();
        tokio::io::AsyncReadExt::read_to_string(&mut r, &mut buf).await.ok();
        if !buf.trim().is_empty() { log::warn!("[claude stderr] {}", buf.trim()); }
    }

    let _ = child.wait().await;
    *claude_state.pid.lock().unwrap() = None;
    Ok(final_result)
}

#[tauri::command]
pub fn claude_stop(claude_state: State<'_, ClaudeState>) -> Result<(), String> {
    if let Some(pid) = claude_state.pid.lock().unwrap().take() {
        unsafe { libc::kill(pid as i32, libc::SIGTERM); }
    }
    Ok(())
}

#[tauri::command]
pub fn claude_reset_session(claude_state: State<'_, ClaudeState>) -> Result<(), String> {
    *claude_state.session_id.lock().unwrap() = None;
    Ok(())
}

fn which_claude() -> Option<String> {
    for p in &["/opt/homebrew/bin/claude", "/usr/local/bin/claude", "/usr/bin/claude"] {
        if std::path::Path::new(p).exists() { return Some(p.to_string()); }
    }
    None
}
