use crate::pty::PtyState;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    pty: State<'_, PtyState>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    pty.spawn(app, cols, rows)
}

#[tauri::command]
pub fn pty_write(pty: State<'_, PtyState>, data: Vec<u8>) -> Result<(), String> {
    pty.write_data(&data)
}

#[tauri::command]
pub fn pty_resize(pty: State<'_, PtyState>, cols: u16, rows: u16) -> Result<(), String> {
    pty.resize(cols, rows)
}

#[tauri::command]
pub fn pty_kill(pty: State<'_, PtyState>) -> Result<(), String> {
    pty.kill()
}

/// 生成 MCP 配置文件，返回路径
#[tauri::command]
pub fn prepare_mcp_config(app: AppHandle) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = app_dir.join("qai.db");

    // 查找 qai-mcp 二进制：开发模式从 target/debug，生产模式从 externalBin sidecar
    let mcp_binary = find_mcp_binary(&app)?;

    let config = serde_json::json!({
        "mcpServers": {
            "qai": {
                "command": mcp_binary.to_string_lossy(),
                "args": [db_path.to_string_lossy()]
            }
        }
    });

    let config_path = app_dir.join("mcp-config.json");
    std::fs::write(&config_path, serde_json::to_string_pretty(&config).unwrap())
        .map_err(|e| e.to_string())?;

    Ok(config_path.to_string_lossy().to_string())
}

/// 查找 qai-mcp 二进制路径
/// 依次检查：exe 同目录 → resource 目录 → 常见路径
fn find_mcp_binary(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let suffix = if cfg!(target_os = "windows") {
        ".exe"
    } else {
        ""
    };
    let bin_name = format!("qai-mcp{suffix}");

    // 1. exe 同目录（开发模式 target/debug，生产模式 app bundle 内）
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let path = dir.join(&bin_name);
            if path.exists() {
                return Ok(path);
            }
        }
    }

    // 2. Tauri resource 目录
    if let Ok(dir) = app.path().resource_dir() {
        for sub in &["", "binaries"] {
            let path = dir.join(sub).join(&bin_name);
            if path.exists() {
                return Ok(path);
            }
        }
    }

    Err(format!(
        "{bin_name} not found. Ensure qai-mcp is built: cargo build --bin qai-mcp"
    ))
}
