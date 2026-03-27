use std::process::Stdio;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use std::sync::Mutex;
use tokio::process::Child;

pub struct ClaudeState {
    child: Mutex<Option<u32>>, // PID of running claude process
}

impl ClaudeState {
    pub fn new() -> Self {
        Self { child: Mutex::new(None) }
    }
}

/// Claude 流式事件（推送给前端）
#[derive(Clone, serde::Serialize)]
pub struct ClaudeEvent {
    pub event_type: String,  // "system" | "assistant" | "tool_use" | "tool_result" | "result" | "error"
    pub content: String,
    pub raw: Option<serde_json::Value>,
}

#[tauri::command]
pub async fn claude_send(
    app: AppHandle,
    claude_state: State<'_, ClaudeState>,
    message: String,
    mcp_config_path: Option<String>,
    session_id: Option<String>,
) -> Result<serde_json::Value, String> {
    // 查找 claude 二进制的完整路径
    let claude_bin = which_claude().unwrap_or_else(|| "claude".to_string());

    let mut args: Vec<String> = vec![
        "-p".into(),
        "--output-format".into(), "stream-json".into(),
        "--verbose".into(),
    ];

    if let Some(ref config) = mcp_config_path {
        args.push(format!("--mcp-config={config}"));
    }

    if let Some(ref sid) = session_id {
        args.push("--resume".into());
        args.push(sid.clone());
    }

    args.push(message.clone());

    let mut cmd = Command::new(&claude_bin);
    cmd.args(&args);

    // 确保子进程有完整的 PATH（Tauri 进程可能缺少 homebrew 等路径）
    let path = std::env::var("PATH").unwrap_or_default();
    let full_path = format!("/opt/homebrew/bin:/usr/local/bin:{path}");
    cmd.env("PATH", &full_path);
    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", &home);
    }

    cmd.stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("启动 claude 失败: {e}"))?;

    // 记录 PID 以支持中断
    if let Some(pid) = child.id() {
        *claude_state.child.lock().unwrap() = Some(pid);
    }

    let stdout = child.stdout.take().ok_or("无法获取 stdout")?;
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    let mut final_result = serde_json::Value::Null;

    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() { continue; }

        let json: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let event_type = json.get("type").and_then(|v| v.as_str()).unwrap_or("unknown");

        match event_type {
            "assistant" => {
                if let Some(message) = json.get("message") {
                    if let Some(content) = message.get("content").and_then(|c| c.as_array()) {
                        for block in content {
                            if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                                let trimmed = text.trim();
                                if !trimmed.is_empty() {
                                    let _ = app.emit("claude-event", ClaudeEvent {
                                        event_type: "assistant".into(),
                                        content: trimmed.to_string(),
                                        raw: None,
                                    });
                                }
                            }
                            if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                                let tool_name = block.get("name").and_then(|n| n.as_str()).unwrap_or("");
                                let _ = app.emit("claude-event", ClaudeEvent {
                                    event_type: "tool_use".into(),
                                    content: format!("调用工具: {tool_name}"),
                                    raw: Some(block.clone()),
                                });
                            }
                        }
                    }
                }
            }
            "result" => {
                // result 是最终事件，只发费用信息（文本已由 assistant 事件处理）
                let _ = app.emit("claude-event", ClaudeEvent {
                    event_type: "result".into(),
                    content: String::new(),
                    raw: Some(json.clone()),
                });
                final_result = json;
            }
            _ => {
                let _ = app.emit("claude-event", ClaudeEvent {
                    event_type: event_type.to_string(),
                    content: line.clone(),
                    raw: Some(json),
                });
            }
        }
    }

    // 读取 stderr（用于调试）
    if let Some(stderr) = child.stderr.take() {
        let mut err_reader = BufReader::new(stderr);
        let mut err_buf = String::new();
        tokio::io::AsyncReadExt::read_to_string(&mut err_reader, &mut err_buf).await.ok();
        if !err_buf.trim().is_empty() {
            log::error!("[claude_send] stderr: {}", err_buf.trim());
            if final_result.is_null() {
                let _ = app.emit("claude-event", ClaudeEvent {
                    event_type: "system".into(),
                    content: format!("Claude 错误: {}", err_buf.trim()),
                    raw: None,
                });
            }
        }
    }

    let _ = child.wait().await;
    *claude_state.child.lock().unwrap() = None;

    Ok(final_result)
}

#[tauri::command]
pub fn claude_stop(claude_state: State<'_, ClaudeState>) -> Result<(), String> {
    let pid = claude_state.child.lock().unwrap().take();
    if let Some(pid) = pid {
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
    }
    Ok(())
}

fn which_claude() -> Option<String> {
    // 尝试常见路径
    for path in &[
        "/opt/homebrew/bin/claude",
        "/usr/local/bin/claude",
        "/usr/bin/claude",
    ] {
        if std::path::Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    // 从 PATH 中查找
    if let Ok(output) = std::process::Command::new("which").arg("claude").output() {
        if output.status.success() {
            return Some(String::from_utf8_lossy(&output.stdout).trim().to_string());
        }
    }
    None
}
