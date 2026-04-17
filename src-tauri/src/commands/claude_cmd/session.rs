use std::sync::Mutex;

use super::process::validate_mcp_config;
use crate::errors::AppError;

/// Claude 会话内部状态
/// 所有字段放在一个结构体中，由单个 Mutex 保护，避免竞态条件
pub struct ClaudeInner {
    /// 当前运行的进程 PID
    pub pid: Option<u32>,
    /// 当前会话 ID（用于 --resume）
    pub session_id: Option<String>,
    /// 预热的备用 session（新建 Tab 时秒用）
    pub spare_session_id: Option<String>,
}

/// Claude 会话状态
/// 使用单个 Mutex 包装所有状态，确保原子操作
pub struct ClaudeState(pub(super) Mutex<ClaudeInner>);

impl ClaudeState {
    pub fn new() -> Self {
        Self(Mutex::new(ClaudeInner {
            pid: None,
            session_id: None,
            spare_session_id: None,
        }))
    }

    /// 获取状态的可变引用
    pub fn lock_inner(&self) -> Result<std::sync::MutexGuard<'_, ClaudeInner>, AppError> {
        self.0
            .lock()
            .map_err(|_| AppError::Generic("内部状态不可用（锁冲突）".into()))
    }
}

#[derive(Clone, serde::Serialize)]
pub struct ClaudeEvent {
    pub event_type: String,
    pub content: String,
    pub session_id: Option<String>,
    pub raw: Option<serde_json::Value>,
}

/// 构建带 MCP 参数的公共 args
pub fn build_mcp_args(
    args: &mut Vec<String>,
    mcp_config_path: Option<&str>,
) -> Result<(), AppError> {
    if let Some(config) = mcp_config_path {
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
             Always resolve entity names via the 'search' MCP tool first."
                .into(),
        );
    }
    Ok(())
}
