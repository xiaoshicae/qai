use std::process::Stdio;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// 验证 MCP 配置路径：必须是 .json 文件且位于合理目录
fn validate_mcp_config(path: &str) -> Result<(), String> {
    let p = std::path::Path::new(path);
    if !p.extension().map_or(false, |e| e == "json") {
        return Err("MCP 配置文件必须是 .json 格式".into());
    }
    // canonicalize 确保路径存在且无符号链接绕过
    let canonical = p.canonicalize().map_err(|e| format!("MCP 配置路径无效: {e}"))?;
    let path_str = canonical.to_string_lossy();
    // 禁止指向系统敏感目录
    #[cfg(unix)]
    if path_str.starts_with("/etc/") || path_str.starts_with("/var/") {
        return Err("MCP 配置路径不允许指向系统目录".into());
    }
    Ok(())
}

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

/// Claude 会话内部状态
/// 所有字段放在一个结构体中，由单个 Mutex 保护，避免竞态条件
struct ClaudeInner {
    /// 当前运行的进程 PID
    pid: Option<u32>,
    /// 当前会话 ID（用于 --resume）
    session_id: Option<String>,
    /// 预热的备用 session（新建 Tab 时秒用）
    spare_session_id: Option<String>,
}

/// Claude 会话状态
/// 使用单个 Mutex 包装所有状态，确保原子操作
pub struct ClaudeState(Mutex<ClaudeInner>);

impl ClaudeState {
    pub fn new() -> Self {
        Self(Mutex::new(ClaudeInner {
            pid: None,
            session_id: None,
            spare_session_id: None,
        }))
    }

    /// 获取状态的可变引用
    fn lock_inner(&self) -> Result<std::sync::MutexGuard<'_, ClaudeInner>, String> {
        self.0.lock().map_err(|_| "内部状态不可用（锁冲突）".to_string())
    }
}

#[derive(Clone, serde::Serialize)]
pub struct ClaudeEvent {
    pub event_type: String,
    pub content: String,
    pub session_id: Option<String>,
    pub raw: Option<serde_json::Value>,
}

/// 查询 session 是否已建立（面板用来判断预热状态）
#[tauri::command]
pub fn claude_session_ready(claude_state: State<'_, ClaudeState>) -> Result<bool, String> {
    Ok(claude_state.lock_inner()?.session_id.is_some())
}

/// 后台预热：建立 session，完成后 emit `claude-warmup-done`
#[tauri::command]
pub async fn claude_warmup(
    app: AppHandle,
    claude_state: State<'_, ClaudeState>,
    mcp_config_path: Option<String>,
) -> Result<(), String> {
    // 已有 session，无需预热
    {
        let inner = claude_state.lock_inner()?;
        if inner.session_id.is_some() {
            let _ = app.emit("claude-warmup-done", ());
            return Ok(());
        }
        // 已有进程在跑（上次 warmup 或 send），跳过
        if inner.pid.is_some() {
            return Ok(());
        }
    }

    let claude_bin = which_claude().unwrap_or_else(|| "claude".to_string());
    let mut args: Vec<String> = vec![
        "-p".into(),
        "--output-format".into(), "stream-json".into(),
        "--verbose".into(),
    ];
    if let Some(ref config) = mcp_config_path {
        validate_mcp_config(config)?;
        args.push(format!("--mcp-config={config}"));
        args.push("--allowedTools".into());
        args.push("mcp__qai__*,Bash,Read,Write,Edit,Glob,Grep,Agent,ToolSearch".into());
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
    let home = std::env::var("HOME").unwrap_or_default();
    cmd.env("PATH", format!("{home}/.local/bin:/opt/homebrew/bin:/usr/local/bin:{path}"));
    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", &home);
        cmd.current_dir(&home);
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Warmup failed: {e}"))?;
    if let Some(pid) = child.id() {
        claude_state.lock_inner()?.pid = Some(pid);
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
                if let Ok(mut inner) = claude_state.lock_inner() {
                    inner.session_id = Some(sid.to_string());
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
    if let Ok(mut inner) = claude_state.lock_inner() {
        inner.pid = None;
    }
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
    session_id: Option<String>,
) -> Result<serde_json::Value, String> {
    // 如果有正在运行的进程（如 warmup），先杀掉
    {
        let mut inner = claude_state.lock_inner()?;
        if let Some(pid) = inner.pid.take() {
            kill_process(pid);
        }
    }
    // 让被杀进程有时间退出
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    let claude_bin = which_claude().unwrap_or_else(|| "claude".to_string());
    // 优先使用前端传入的 session_id（多 Tab 场景），其次用全局缓存的
    let resume_sid = session_id.or_else(|| {
        claude_state.lock_inner().ok().and_then(|g| g.session_id.clone())
    });

    let mut args: Vec<String> = vec![
        "-p".into(),
        "--output-format".into(), "stream-json".into(),
        "--verbose".into(),
        "--include-partial-messages".into(),
    ];

    if let Some(ref config) = mcp_config_path {
        validate_mcp_config(config)?;
        args.push(format!("--mcp-config={config}"));
        args.push("--allowedTools".into());
        args.push("mcp__qai__*,Bash,Read,Write,Edit,Glob,Grep,Agent,ToolSearch".into());
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
    if let Some(ref sid) = resume_sid {
        args.push("--resume".into());
        args.push(sid.clone());
    }

    args.push(message);

    let mut cmd = Command::new(&claude_bin);
    cmd.args(&args);

    let path = std::env::var("PATH").unwrap_or_default();
    let home = std::env::var("HOME").unwrap_or_default();
    cmd.env("PATH", format!("{home}/.local/bin:/opt/homebrew/bin:/usr/local/bin:{path}"));
    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", &home);
        cmd.current_dir(&home); // 避免继承 QAI 项目目录，防止 Claude Code 误读源码
    }

    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("启动 Claude 失败: {e}"))?;
    if let Some(pid) = child.id() {
        claude_state.lock_inner()?.pid = Some(pid);
    }

    let stdout = child.stdout.take().ok_or("无法获取 stdout")?;
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    let mut final_result = serde_json::Value::Null;
    let mut current_sid = resume_sid.clone();
    let mut has_mcp_write = false;

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
                                let _ = app.emit("claude-event", ClaudeEvent { event_type: "delta".into(), content: text.into(), session_id: current_sid.clone(), raw: None });
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
                            // 检测 MCP 写操作（create/update/delete）
                            if name.starts_with("mcp__qai__") && (name.contains("create") || name.contains("update") || name.contains("delete") || name.contains("save")) {
                                has_mcp_write = true;
                            }
                            let detail = tool_use_summary(name, block.get("input"));
                            let _ = app.emit("claude-event", ClaudeEvent { event_type: "tool_use".into(), content: format!("{name}: {detail}"), session_id: current_sid.clone(), raw: Some(block.clone()) });
                        }
                    }
                }
            }
            "result" => {
                // 保存 session_id 用于下次 --resume
                if let Some(sid) = json.get("session_id").and_then(|s| s.as_str()) {
                    current_sid = Some(sid.to_string());
                    if let Ok(mut inner) = claude_state.lock_inner() {
                        inner.session_id = Some(sid.to_string());
                    }
                }
                let result_text = json.get("result")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let _ = app.emit("claude-event", ClaudeEvent { event_type: "result".into(), content: result_text, session_id: current_sid.clone(), raw: Some(json.clone()) });
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
    if let Ok(mut inner) = claude_state.lock_inner() {
        inner.pid = None;
    }
    // MCP 写操作完成后通知前端刷新数据
    if has_mcp_write {
        let _ = app.emit("mcp:data-changed", ());
    }
    Ok(final_result)
}

#[tauri::command]
pub fn claude_stop(claude_state: State<'_, ClaudeState>) -> Result<(), String> {
    if let Some(pid) = claude_state.lock_inner()?.pid.take() {
        kill_process(pid);
    }
    Ok(())
}

#[tauri::command]
pub fn claude_reset_session(claude_state: State<'_, ClaudeState>) -> Result<(), String> {
    claude_state.lock_inner()?.session_id = None;
    Ok(())
}

/// 取走预热的备用 session（原子操作：取走后清空）
#[tauri::command]
pub fn claude_take_spare(claude_state: State<'_, ClaudeState>) -> Result<Option<String>, String> {
    Ok(claude_state.lock_inner()?.spare_session_id.take())
}

/// 后台预热备用 session（不影响主 session，不占 pid）
#[tauri::command]
pub async fn claude_warmup_spare(
    app: AppHandle,
    claude_state: State<'_, ClaudeState>,
    mcp_config_path: Option<String>,
) -> Result<(), String> {
    // 已有备用 session，跳过
    if claude_state.lock_inner()?.spare_session_id.is_some() {
        return Ok(());
    }

    let claude_bin = which_claude().unwrap_or_else(|| "claude".to_string());
    let mut args: Vec<String> = vec![
        "-p".into(),
        "--output-format".into(), "stream-json".into(),
        "--verbose".into(),
    ];
    if let Some(ref config) = mcp_config_path {
        validate_mcp_config(config)?;
        args.push(format!("--mcp-config={config}"));
        args.push("--allowedTools".into());
        args.push("mcp__qai__*,Bash,Read,Write,Edit,Glob,Grep,Agent,ToolSearch".into());
        args.push("--append-system-prompt".into());
        args.push(
            "You are running inside QAI, an API testing tool. \
             When the user mentions tests, modules, collections, suites, or requests, \
             they mean QAI's data — use the QAI MCP tools (search, run_collection, send_request, list_collections, etc.). \
             NEVER use 'cargo test', 'npm test', 'jest', 'pytest', or any shell test command. \
             Always resolve entity names via the 'search' MCP tool first.".into()
        );
    }
    args.push("Reply with only: ok".into());

    let mut cmd = Command::new(&claude_bin);
    cmd.args(&args);
    let path = std::env::var("PATH").unwrap_or_default();
    let home = std::env::var("HOME").unwrap_or_default();
    cmd.env("PATH", format!("{home}/.local/bin:/opt/homebrew/bin:/usr/local/bin:{path}"));
    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", &home);
        cmd.current_dir(&home);
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Spare warmup failed: {e}"))?;
    let stdout = child.stdout.take().ok_or("No stdout")?;
    let mut lines = BufReader::new(stdout).lines();

    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() { continue; }
        let json: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v, Err(_) => continue,
        };
        if json.get("type").and_then(|v| v.as_str()) == Some("result") {
            if let Some(sid) = json.get("session_id").and_then(|s| s.as_str()) {
                claude_state.lock_inner()?.spare_session_id = Some(sid.to_string());
            }
        }
    }

    if let Some(stderr) = child.stderr.take() {
        let mut r = BufReader::new(stderr);
        let mut buf = String::new();
        tokio::io::AsyncReadExt::read_to_string(&mut r, &mut buf).await.ok();
    }
    let _ = child.wait().await;
    let _ = app.emit("claude-spare-ready", ());
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
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let end = s.char_indices().nth(max).map_or(s.len(), |(i, _)| i);
        format!("{}…", &s[..end])
    }
}

fn which_claude() -> Option<String> {
    // 检查常见安装路径，含 ~/.local/bin（Claude Code 默认安装位置）
    let home = std::env::var("HOME").unwrap_or_default();
    let local_bin = format!("{home}/.local/bin/claude");
    for p in &[local_bin.as_str(), "/opt/homebrew/bin/claude", "/usr/local/bin/claude", "/usr/bin/claude"] {
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
