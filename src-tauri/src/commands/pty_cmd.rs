use tauri::{AppHandle, Manager, State};
use crate::pty::PtyState;

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

    // MCP sidecar 在开发时用 cargo run --bin qai-mcp，生产时用 resource 目录
    let mcp_binary = if cfg!(debug_assertions) {
        // 开发模式：从 target/debug 目录找
        let target_dir = std::env::current_exe()
            .map_err(|e| e.to_string())?
            .parent().unwrap().to_path_buf();
        target_dir.join("qai-mcp")
    } else {
        app.path().resource_dir().map_err(|e| e.to_string())?
            .join("binaries").join("qai-mcp")
    };

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
