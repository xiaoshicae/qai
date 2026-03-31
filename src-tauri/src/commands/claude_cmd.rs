use std::process::Stdio;
use std::sync::{Mutex, MutexGuard};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// 跨平台终止子进程
fn kill_process(pid: u32) {
    #[cfg(unix)]
    {
        // SAFETY: pid 来自本模块的子进程，仅发送 SIGTERM 请求其退出
        let rc = unsafe { libc::kill(pid as i32, libc::SIGTERM) };
        if rc != 0 {
            log::warn!("[kill_process] kill(pid={pid}) returned {rc}");
        }
    }
    #[cfg(windows)]
    {
        // Windows 下通过 taskkill 终止进程树
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output()
            .map_err(|e| log::warn!("[kill_process] taskkill failed: {e}"));
    }
}

pub struct ClaudeState {
    pid: Mutex<Option<u32>>,
    session_id: Mutex<Option<String>>, // 复用 session 加速后续对话
}

impl ClaudeState {
    pub fn new() -> Self {
        Self { pid: Mutex::new(None), session_id: Mutex::new(None) }
    }
}

fn lock_claude<T>(m: &Mutex<T>) -> Result<MutexGuard<'_, T>, String> {
    m.lock().map_err(|_| "内部状态不可用（锁冲突）".to_string())
}

#[derive(Clone, serde::Serialize)]
pub struct ClaudeEvent {
    pub event_type: String,
    pub content: String,
    pub raw: Option<serde_json::Value>,
}

/// 查询 session 是否已建立（面板用来判断预热状态）
#[tauri::command]
pub fn claude_session_ready(claude_state: State<'_, ClaudeState>) -> Result<bool, String> {
    Ok(lock_claude(&claude_state.session_id)?.is_some())
}

/// 后台预热：建立 session，完成后 emit `claude-warmup-done`
#[tauri::command]
pub async fn claude_warmup(
    app: AppHandle,
    claude_state: State<'_, ClaudeState>,
    mcp_config_path: Option<String>,
) -> Result<(), String> {
    // 已有 session，无需预热
    if lock_claude(&claude_state.session_id)?.is_some() {
        let _ = app.emit("claude-warmup-done", ());
        return Ok(());
    }
    // 已有进程在跑（上次 warmup 或 send），跳过
    if lock_claude(&claude_state.pid)?.is_some() {
        return Ok(());
    }

    let claude_bin = which_claude().unwrap_or_else(|| "claude".to_string());
    let mut args: Vec<String> = vec![
        "-p".into(),
        "--output-format".into(), "stream-json".into(),
        "--verbose".into(),
    ];
    if let Some(ref config) = mcp_config_path {
        args.push(format!("--mcp-config={config}"));
        args.push("--allowedTools".into());
        args.push("mcp__qai__*".into());
        args.push("--append-system-prompt".into());
        args.push(
            "You are running inside QAI, an API testing tool. \
             When the user mentions tests, modules, collections, suites, or requests, \
             they mean QAI's data — use the QAI MCP tools (search, run_collection, send_request, list_collections, etc.). \
             NEVER use 'cargo test', 'npm test', 'jest', 'pytest', or any shell test command. \
             Always resolve entity names via the 'search' MCP tool first.".into()
        );
    }
    // 极简 prompt，只为建立 session
    args.push("Reply with only: ok".into());

    let mut cmd = Command::new(&claude_bin);
    cmd.args(&args);
    let path = std::env::var("PATH").unwrap_or_default();
    cmd.env("PATH", format!("/opt/homebrew/bin:/usr/local/bin:{path}"));
    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", &home);
        cmd.current_dir(&home);
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Warmup failed: {e}"))?;
    if let Some(pid) = child.id() {
        *lock_claude(&claude_state.pid)? = Some(pid);
    }

    let stdout = child.stdout.take().ok_or("No stdout")?;
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() { continue; }
        let json: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v, Err(_) => continue,
        };
        if json.get("type").and_then(|v| v.as_str()) == Some("result") {
            if let Some(sid) = json.get("session_id").and_then(|s| s.as_str()) {
                if let Ok(mut g) = claude_state.session_id.lock() {
                    *g = Some(sid.to_string());
                }
            }
        }
    }

    if let Some(stderr) = child.stderr.take() {
        let mut r = BufReader::new(stderr);
        let mut buf = String::new();
        tokio::io::AsyncReadExt::read_to_string(&mut r, &mut buf).await.ok();
        if !buf.trim().is_empty() { log::warn!("[claude warmup stderr] {}", buf.trim()); }
    }

    let _ = child.wait().await;
    if let Ok(mut g) = claude_state.pid.lock() { *g = None; }
    // 通知前端预热完成
    let _ = app.emit("claude-warmup-done", ());
    Ok(())
}

#[tauri::command]
pub async fn claude_send(
    app: AppHandle,
    claude_state: State<'_, ClaudeState>,
    message: String,
    mcp_config_path: Option<String>,
) -> Result<serde_json::Value, String> {
    // 如果有正在运行的进程（如 warmup），先杀掉
    {
        let old_pid = lock_claude(&claude_state.pid)?.take();
        if let Some(pid) = old_pid {
            kill_process(pid);
        }
    }
    // 让被杀进程有时间退出
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let claude_bin = which_claude().unwrap_or_else(|| "claude".to_string());
    let existing_session = lock_claude(&claude_state.session_id)?.clone();

    let mut args: Vec<String> = vec![
        "-p".into(),
        "--output-format".into(), "stream-json".into(),
        "--verbose".into(),
        "--include-partial-messages".into(),
    ];

    if let Some(ref config) = mcp_config_path {
        args.push(format!("--mcp-config={config}"));
        // 预授权 QAI MCP 工具，避免非交互模式下的权限弹窗
        args.push("--allowedTools".into());
        args.push("mcp__qai__*".into());
        args.push("--append-system-prompt".into());
        args.push(
            "You are running inside QAI, an API testing tool. \
             When the user mentions tests, modules, collections, suites, or requests, \
             they mean QAI's data — use the QAI MCP tools (search, run_collection, send_request, list_collections, etc.). \
             NEVER use 'cargo test', 'npm test', 'jest', 'pytest', or any shell test command. \
             Always resolve entity names via the 'search' MCP tool first.".into()
        );
    }

    // 复用 session：预热成功后秒回
    if let Some(ref sid) = existing_session {
        args.push("--resume".into());
        args.push(sid.clone());
    }

    args.push(message);

    let mut cmd = Command::new(&claude_bin);
    cmd.args(&args);

    let path = std::env::var("PATH").unwrap_or_default();
    cmd.env("PATH", format!("/opt/homebrew/bin:/usr/local/bin:{path}"));
    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", &home);
        cmd.current_dir(&home); // 避免继承 QAI 项目目录，防止 Claude Code 误读源码
    }

    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("启动 Claude 失败: {e}"))?;
    if let Some(pid) = child.id() {
        *lock_claude(&claude_state.pid)? = Some(pid);
    }

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
                            let detail = tool_use_summary(name, block.get("input"));
                            let _ = app.emit("claude-event", ClaudeEvent { event_type: "tool_use".into(), content: format!("{name}: {detail}"), raw: Some(block.clone()) });
                        }
                    }
                }
            }
            "result" => {
                // 保存 session_id 用于下次 --resume
                if let Some(sid) = json.get("session_id").and_then(|s| s.as_str()) {
                    if let Ok(mut g) = claude_state.session_id.lock() {
                        *g = Some(sid.to_string());
                    }
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
    if let Ok(mut g) = claude_state.pid.lock() {
        *g = None;
    }
    Ok(final_result)
}

#[tauri::command]
pub fn claude_stop(claude_state: State<'_, ClaudeState>) -> Result<(), String> {
    if let Some(pid) = lock_claude(&claude_state.pid)?.take() {
        kill_process(pid);
    }
    Ok(())
}

#[tauri::command]
pub fn claude_reset_session(claude_state: State<'_, ClaudeState>) -> Result<(), String> {
    *lock_claude(&claude_state.session_id)? = None;
    Ok(())
}

/// 根据工具名和输入参数生成简短摘要
fn tool_use_summary(name: &str, input: Option<&serde_json::Value>) -> String {
    let input = match input {
        Some(v) => v,
        None => return String::new(),
    };
    match name {
        "Bash" => {
            let cmd = input.get("command").and_then(|v| v.as_str()).unwrap_or("");
            truncate_str(cmd, 200)
        }
        "Read" => {
            let path = input.get("file_path").and_then(|v| v.as_str()).unwrap_or("");
            truncate_str(path, 200)
        }
        "Write" => {
            let path = input.get("file_path").and_then(|v| v.as_str()).unwrap_or("");
            truncate_str(path, 200)
        }
        "Edit" => {
            let path = input.get("file_path").and_then(|v| v.as_str()).unwrap_or("");
            truncate_str(path, 200)
        }
        "Glob" => {
            let pattern = input.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
            truncate_str(pattern, 200)
        }
        "Grep" => {
            let pattern = input.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
            truncate_str(pattern, 200)
        }
        "WebSearch" | "WebFetch" => {
            let q = input.get("query").or_else(|| input.get("url")).and_then(|v| v.as_str()).unwrap_or("");
            truncate_str(q, 200)
        }
        _ => {
            // 通用：取第一个字符串值
            if let Some(obj) = input.as_object() {
                for val in obj.values() {
                    if let Some(s) = val.as_str() {
                        if !s.is_empty() {
                            return truncate_str(s, 120);
                        }
                    }
                }
            }
            String::new()
        }
    }
}

fn truncate_str(s: &str, max: usize) -> String {
    let s = s.lines().next().unwrap_or(s); // 只取第一行
    if s.len() <= max { s.to_string() } else { format!("{}…", &s[..max]) }
}

fn which_claude() -> Option<String> {
    for p in &["/opt/homebrew/bin/claude", "/usr/local/bin/claude", "/usr/bin/claude"] {
        if std::path::Path::new(p).exists() { return Some(p.to_string()); }
    }
    // 尝试 PATH 中的 claude
    if let Ok(output) = std::process::Command::new("which").arg("claude").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() { return Some(path); }
        }
    }
    None
}

/// 快速检测 Claude Code CLI 是否已安装（只检查二进制，不发请求）
#[tauri::command]
pub fn claude_check_status() -> Result<serde_json::Value, String> {
    let claude_bin = match which_claude() {
        Some(p) => p,
        None => return Ok(serde_json::json!({
            "status": "not_installed"
        })),
    };

    // 只获取版本验证可执行，不做认证测试（认证由 warmup 处理）
    let version = match std::process::Command::new(&claude_bin).arg("--version").output() {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => return Ok(serde_json::json!({ "status": "not_installed" })),
    };

    Ok(serde_json::json!({
        "status": "ready",
        "version": version
    }))
}
