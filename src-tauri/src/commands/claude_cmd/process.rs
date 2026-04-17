use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use super::session::ClaudeState;
use crate::errors::AppError;

/// stderr 最大读取字节数（1MB），防止恶意输出耗尽内存
pub const MAX_STDERR_BYTES: usize = 1024 * 1024;

/// 验证 MCP 配置路径：必须是 .json 文件且位于合理目录
pub fn validate_mcp_config(path: &str) -> Result<(), AppError> {
    let p = std::path::Path::new(path);
    if !p.extension().is_some_and(|e| e == "json") {
        return Err("MCP 配置文件必须是 .json 格式".into());
    }
    // canonicalize 确保路径存在且无符号链接绕过
    let canonical = p
        .canonicalize()
        .map_err(|e| AppError::Generic(format!("MCP 配置路径无效: {e}")))?;
    let path_str = canonical.to_string_lossy();
    // 禁止指向系统敏感目录
    #[cfg(unix)]
    if path_str.starts_with("/etc/") || path_str.starts_with("/var/") {
        return Err("MCP 配置路径不允许指向系统目录".into());
    }
    let _ = path_str;
    Ok(())
}

/// 跨平台终止子进程
pub fn kill_process(pid: u32) {
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

/// 有限读取 stderr，超出 MAX_STDERR_BYTES 截断
pub async fn read_stderr_limited(child: &mut tokio::process::Child) -> String {
    let Some(stderr) = child.stderr.take() else {
        return String::new();
    };
    let mut reader = BufReader::new(stderr);
    let mut buf = Vec::with_capacity(4096);
    let mut total = 0usize;

    loop {
        let bytes_read = match tokio::io::AsyncBufReadExt::fill_buf(&mut reader).await {
            Ok([]) => break,
            Ok(b) => {
                let take = b.len().min(MAX_STDERR_BYTES - total);
                buf.extend_from_slice(&b[..take]);
                total += take;
                b.len()
            }
            Err(_) => break,
        };
        reader.consume(bytes_read);
        if total >= MAX_STDERR_BYTES {
            break;
        }
    }

    String::from_utf8_lossy(&buf).to_string()
}

/// 配置 Claude 命令的环境变量
pub fn configure_cmd_env(cmd: &mut Command) {
    let path = std::env::var("PATH").unwrap_or_default();
    let home = std::env::var("HOME").unwrap_or_default();
    cmd.env(
        "PATH",
        format!("{home}/.local/bin:/opt/homebrew/bin:/usr/local/bin:{path}"),
    );
    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", &home);
        cmd.current_dir(&home);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
}

/// 等待进程退出并确保 PID 被清理
pub async fn wait_and_clear_pid(child: &mut tokio::process::Child, state: &ClaudeState) {
    let _ = child.wait().await;
    if let Ok(mut inner) = state.lock_inner() {
        inner.pid = None;
    }
}

/// 探测 Claude CLI 二进制路径
pub fn which_claude() -> Option<String> {
    // 检查常见安装路径，含 ~/.local/bin（Claude Code 默认安装位置）
    let home = std::env::var("HOME").unwrap_or_default();
    let local_bin = format!("{home}/.local/bin/claude");
    for p in &[
        local_bin.as_str(),
        "/opt/homebrew/bin/claude",
        "/usr/local/bin/claude",
        "/usr/bin/claude",
    ] {
        if std::path::Path::new(p).exists() {
            return Some(p.to_string());
        }
    }
    // 尝试 PATH 中的 claude
    if let Ok(output) = std::process::Command::new("which").arg("claude").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }
    None
}
