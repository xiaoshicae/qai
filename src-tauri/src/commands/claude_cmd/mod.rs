//! Claude CLI 集成命令
//!
//! 模块组织：
//! - [`session`]：会话状态、Mutex、MCP 参数构造
//! - [`process`]：子进程生命周期管理（路径探测、kill、stderr 限读）
//! - [`summary`]：工具调用摘要文本生成
//! - 本文件：6 个 Tauri 命令入口

mod process;
mod session;
mod summary;

use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::errors::AppError;

// 对外保留的公共类型与命令路径：commands::claude_cmd::xxx
pub use session::{ClaudeEvent, ClaudeState};

use process::{
    configure_cmd_env, kill_process, read_stderr_limited, wait_and_clear_pid, which_claude,
};
use session::build_mcp_args;
use summary::tool_use_summary;

/// 查询 session 是否已建立（面板用来判断预热状态）
#[tauri::command]
pub fn claude_session_ready(claude_state: State<'_, ClaudeState>) -> Result<bool, AppError> {
    Ok(claude_state.lock_inner()?.session_id.is_some())
}

/// 后台预热：建立 session，完成后 emit `claude-warmup-done`
#[tauri::command]
pub async fn claude_warmup(
    app: AppHandle,
    claude_state: State<'_, ClaudeState>,
    mcp_config_path: Option<String>,
) -> Result<(), AppError> {
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
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
    ];
    build_mcp_args(&mut args, mcp_config_path.as_deref())?;
    // 极简 prompt，只为建立 session
    args.push("Reply with only: ok".into());

    let mut cmd = Command::new(&claude_bin);
    cmd.args(&args);
    configure_cmd_env(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Generic(format!("Warmup failed: {e}")))?;
    if let Some(pid) = child.id() {
        claude_state.lock_inner()?.pid = Some(pid);
    }

    let stdout = child.stdout.take().ok_or("No stdout")?;
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        let json: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if json.get("type").and_then(|v| v.as_str()) == Some("result") {
            if let Some(sid) = json.get("session_id").and_then(|s| s.as_str()) {
                if let Ok(mut inner) = claude_state.lock_inner() {
                    inner.session_id = Some(sid.to_string());
                }
            }
        }
    }

    let stderr_output = read_stderr_limited(&mut child).await;
    if !stderr_output.trim().is_empty() {
        log::warn!("[claude warmup stderr] {}", stderr_output.trim());
    }

    wait_and_clear_pid(&mut child, &claude_state).await;
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
) -> Result<serde_json::Value, AppError> {
    // 如果有正在运行的进程（如 warmup），先杀掉并等待退出
    {
        let mut inner = claude_state.lock_inner()?;
        if let Some(pid) = inner.pid.take() {
            kill_process(pid);
        }
    }
    // 等待被杀进程退出，最多 500ms
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    let claude_bin = which_claude().unwrap_or_else(|| "claude".to_string());
    // 优先使用前端传入的 session_id（多 Tab 场景），其次用全局缓存的
    let resume_sid = session_id.or_else(|| {
        claude_state
            .lock_inner()
            .ok()
            .and_then(|g| g.session_id.clone())
    });

    let mut args: Vec<String> = vec![
        "-p".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--include-partial-messages".into(),
    ];

    build_mcp_args(&mut args, mcp_config_path.as_deref())?;

    // 复用 session：预热成功后秒回
    if let Some(ref sid) = resume_sid {
        args.push("--resume".into());
        args.push(sid.clone());
    }

    args.push(message);

    let mut cmd = Command::new(&claude_bin);
    cmd.args(&args);
    configure_cmd_env(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Generic(format!("启动 Claude 失败: {e}")))?;
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
        if line.trim().is_empty() {
            continue;
        }
        let json: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let event_type = json.get("type").and_then(|v| v.as_str()).unwrap_or("");

        match event_type {
            "stream_event" => {
                if let Some(event) = json.get("event") {
                    let sub = event.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    if sub == "content_block_delta" {
                        if let Some(text) = event
                            .get("delta")
                            .and_then(|d| d.get("text"))
                            .and_then(|t| t.as_str())
                        {
                            if !text.is_empty() {
                                let _ = app.emit(
                                    "claude-event",
                                    ClaudeEvent {
                                        event_type: "delta".into(),
                                        content: text.into(),
                                        session_id: current_sid.clone(),
                                        raw: None,
                                    },
                                );
                            }
                        }
                    }
                }
            }
            "assistant" => {
                if let Some(content) = json
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_array())
                {
                    for block in content {
                        if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                            let name = block.get("name").and_then(|n| n.as_str()).unwrap_or("");
                            // 检测 MCP 写操作（create/update/delete）
                            if name.starts_with("mcp__qai__")
                                && (name.contains("create")
                                    || name.contains("update")
                                    || name.contains("delete")
                                    || name.contains("save"))
                            {
                                has_mcp_write = true;
                            }
                            let detail = tool_use_summary(name, block.get("input"));
                            let _ = app.emit(
                                "claude-event",
                                ClaudeEvent {
                                    event_type: "tool_use".into(),
                                    content: format!("{name}: {detail}"),
                                    session_id: current_sid.clone(),
                                    raw: Some(block.clone()),
                                },
                            );
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
                let result_text = json
                    .get("result")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let _ = app.emit(
                    "claude-event",
                    ClaudeEvent {
                        event_type: "result".into(),
                        content: result_text,
                        session_id: current_sid.clone(),
                        raw: Some(json.clone()),
                    },
                );
                final_result = json;
            }
            _ => {}
        }
    }

    // stderr（有限读取）
    let stderr_output = read_stderr_limited(&mut child).await;
    if !stderr_output.trim().is_empty() {
        log::warn!("[claude stderr] {}", stderr_output.trim());
    }

    wait_and_clear_pid(&mut child, &claude_state).await;
    // MCP 写操作完成后通知前端刷新数据
    if has_mcp_write {
        let _ = app.emit("mcp:data-changed", ());
    }
    Ok(final_result)
}

#[tauri::command]
pub fn claude_stop(claude_state: State<'_, ClaudeState>) -> Result<(), AppError> {
    if let Some(pid) = claude_state.lock_inner()?.pid.take() {
        kill_process(pid);
    }
    Ok(())
}

#[tauri::command]
pub fn claude_reset_session(claude_state: State<'_, ClaudeState>) -> Result<(), AppError> {
    claude_state.lock_inner()?.session_id = None;
    Ok(())
}

/// 取走预热的备用 session（原子操作：取走后清空）
#[tauri::command]
pub fn claude_take_spare(claude_state: State<'_, ClaudeState>) -> Result<Option<String>, AppError> {
    Ok(claude_state.lock_inner()?.spare_session_id.take())
}

/// 后台预热备用 session（不影响主 session，不占 pid）
#[tauri::command]
pub async fn claude_warmup_spare(
    app: AppHandle,
    claude_state: State<'_, ClaudeState>,
    mcp_config_path: Option<String>,
) -> Result<(), AppError> {
    // 已有备用 session，跳过
    if claude_state.lock_inner()?.spare_session_id.is_some() {
        return Ok(());
    }

    let claude_bin = which_claude().unwrap_or_else(|| "claude".to_string());
    let mut args: Vec<String> = vec![
        "-p".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
    ];
    build_mcp_args(&mut args, mcp_config_path.as_deref())?;
    args.push("Reply with only: ok".into());

    let mut cmd = Command::new(&claude_bin);
    cmd.args(&args);
    configure_cmd_env(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Generic(format!("Spare warmup failed: {e}")))?;
    let stdout = child.stdout.take().ok_or("No stdout")?;
    let mut lines = BufReader::new(stdout).lines();

    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        let json: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if json.get("type").and_then(|v| v.as_str()) == Some("result") {
            if let Some(sid) = json.get("session_id").and_then(|s| s.as_str()) {
                claude_state.lock_inner()?.spare_session_id = Some(sid.to_string());
            }
        }
    }

    let _ = read_stderr_limited(&mut child).await;
    let _ = child.wait().await;
    let _ = app.emit("claude-spare-ready", ());
    Ok(())
}

/// 快速检测 Claude Code CLI 是否已安装（只检查二进制，不发请求）
#[tauri::command]
pub fn claude_check_status() -> Result<serde_json::Value, AppError> {
    let claude_bin = match which_claude() {
        Some(p) => p,
        None => {
            return Ok(serde_json::json!({
                "status": "not_installed"
            }))
        }
    };

    // 只获取版本验证可执行，不做认证测试（认证由 warmup 处理）
    let version = match std::process::Command::new(&claude_bin)
        .arg("--version")
        .output()
    {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => return Ok(serde_json::json!({ "status": "not_installed" })),
    };

    Ok(serde_json::json!({
        "status": "ready",
        "version": version
    }))
}
