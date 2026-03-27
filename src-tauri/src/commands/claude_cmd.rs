use std::process::Stdio;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};

/// Claude 长驻进程状态
pub struct ClaudeState {
    child: Mutex<Option<Child>>,
    stdin_tx: Mutex<Option<tokio::sync::mpsc::Sender<String>>>,
}

impl ClaudeState {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            stdin_tx: Mutex::new(None),
        }
    }
}

#[derive(Clone, serde::Serialize)]
pub struct ClaudeEvent {
    pub event_type: String,
    pub content: String,
    pub raw: Option<serde_json::Value>,
}

/// 启动 Claude 长驻进程
#[tauri::command]
pub async fn claude_start(
    app: AppHandle,
    claude_state: State<'_, ClaudeState>,
    mcp_config_path: Option<String>,
) -> Result<(), String> {
    // 如果已有进程，先停止
    claude_stop_inner(&claude_state);

    let claude_bin = which_claude().unwrap_or_else(|| "claude".to_string());

    let mut args: Vec<String> = vec![
        "-p".into(),
        "--output-format".into(), "stream-json".into(),
        "--input-format".into(), "stream-json".into(),
        "--verbose".into(),
        "--include-partial-messages".into(),
        "--replay-user-messages".into(),
    ];

    if let Some(ref config) = mcp_config_path {
        args.push(format!("--mcp-config={config}"));
    }

    let mut cmd = Command::new(&claude_bin);
    cmd.args(&args);

    let path = std::env::var("PATH").unwrap_or_default();
    let full_path = format!("/opt/homebrew/bin:/usr/local/bin:{path}");
    cmd.env("PATH", &full_path);
    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", &home);
    }

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("启动 Claude 失败: {e}"))?;

    // 取出 stdin 和 stdout
    let child_stdin = child.stdin.take().ok_or("无法获取 stdin")?;
    let child_stdout = child.stdout.take().ok_or("无法获取 stdout")?;
    let child_stderr = child.stderr.take().ok_or("无法获取 stderr")?;

    // 创建 stdin 发送通道
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(32);
    *claude_state.stdin_tx.lock().unwrap() = Some(tx);
    *claude_state.child.lock().unwrap() = Some(child);

    // stdin 写入任务
    tokio::spawn(async move {
        let mut stdin = child_stdin;
        while let Some(msg) = rx.recv().await {
            if stdin.write_all(msg.as_bytes()).await.is_err() { break; }
            if stdin.write_all(b"\n").await.is_err() { break; }
            if stdin.flush().await.is_err() { break; }
        }
    });

    // stdout 读取任务 → 解析事件 → emit 到前端
    let app_clone = app.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(child_stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() { continue; }
            let json: serde_json::Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let event_type = json.get("type").and_then(|v| v.as_str()).unwrap_or("unknown");
            match event_type {
                "stream_event" => {
                    if let Some(event) = json.get("event") {
                        let sub_type = event.get("type").and_then(|t| t.as_str()).unwrap_or("");
                        if sub_type == "content_block_delta" {
                            if let Some(delta) = event.get("delta") {
                                if let Some(text) = delta.get("text").and_then(|t| t.as_str()) {
                                    if !text.is_empty() {
                                        let _ = app_clone.emit("claude-event", ClaudeEvent {
                                            event_type: "delta".into(), content: text.to_string(), raw: None,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
                "assistant" => {
                    if let Some(message) = json.get("message") {
                        if let Some(content) = message.get("content").and_then(|c| c.as_array()) {
                            for block in content {
                                if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                                    let tool_name = block.get("name").and_then(|n| n.as_str()).unwrap_or("");
                                    let _ = app_clone.emit("claude-event", ClaudeEvent {
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
                    let session_id = json.get("session_id").and_then(|s| s.as_str()).unwrap_or("");
                    let _ = app_clone.emit("claude-event", ClaudeEvent {
                        event_type: "result".into(),
                        content: session_id.to_string(),
                        raw: Some(json.clone()),
                    });
                }
                "system" => {
                    // init 事件 — 通知前端 Claude 已就绪
                    let _ = app_clone.emit("claude-event", ClaudeEvent {
                        event_type: "ready".into(), content: String::new(), raw: Some(json),
                    });
                }
                _ => {}
            }
        }
        let _ = app_clone.emit("claude-event", ClaudeEvent {
            event_type: "exit".into(), content: String::new(), raw: None,
        });
    });

    // stderr 日志
    tokio::spawn(async move {
        let reader = BufReader::new(child_stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() {
                log::warn!("[claude stderr] {}", line.trim());
            }
        }
    });

    Ok(())
}

/// 发送消息给长驻 Claude 进程
#[tauri::command]
pub async fn claude_send(
    claude_state: State<'_, ClaudeState>,
    message: String,
) -> Result<(), String> {
    let tx = claude_state.stdin_tx.lock().unwrap().clone();
    if let Some(tx) = tx {
        // stream-json 输入格式：JSON 对象每行一个
        let msg = serde_json::json!({
            "type": "user",
            "content": message,
        });
        tx.send(msg.to_string()).await.map_err(|e| format!("发送失败: {e}"))?;
        Ok(())
    } else {
        Err("Claude 未启动，请先调用 claude_start".into())
    }
}

/// 停止 Claude 进程
#[tauri::command]
pub fn claude_stop(claude_state: State<'_, ClaudeState>) -> Result<(), String> {
    claude_stop_inner(&claude_state);
    Ok(())
}

fn claude_stop_inner(state: &ClaudeState) {
    *state.stdin_tx.lock().unwrap() = None; // 关闭 stdin → 进程自然退出
    if let Some(mut child) = state.child.lock().unwrap().take() {
        let _ = child.start_kill();
    }
}

fn which_claude() -> Option<String> {
    for path in &["/opt/homebrew/bin/claude", "/usr/local/bin/claude", "/usr/bin/claude"] {
        if std::path::Path::new(path).exists() { return Some(path.to_string()); }
    }
    if let Ok(output) = std::process::Command::new("which").arg("claude").output() {
        if output.status.success() { return Some(String::from_utf8_lossy(&output.stdout).trim().to_string()); }
    }
    None
}
