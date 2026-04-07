pub mod ai;
mod commands;
pub mod db;
pub mod http;
mod import;
pub mod models;
pub mod pty;
mod report;
pub mod runner;
pub mod websocket;

use db::init::initialize_database;
use tauri::Manager;

// ============================================================================
// 常量定义
// ============================================================================

/// 默认并发数（批量执行时的并发请求数）
pub const DEFAULT_CONCURRENCY: usize = 5;

/// 默认历史记录查询数量
pub const DEFAULT_HISTORY_LIMIT: u32 = 50;

/// 默认单个请求的执行记录查询数量
pub const DEFAULT_ITEM_RUNS_LIMIT: u32 = 20;

/// HTTP 客户端默认超时时间（秒）
pub const HTTP_TIMEOUT_SECS: u64 = 30;

/// AI 连接测试超时时间（秒）
pub const AI_TEST_TIMEOUT_SECS: u64 = 15;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 已有实例运行时，聚焦到主窗口
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let app_handle = app.handle();
            initialize_database(app_handle)?;
            app.manage(pty::PtyState::new());
            app.manage(commands::claude_cmd::ClaudeState::new());
            app.manage(commands::runner_cmd::RunnerState::new());

            if cfg!(debug_assertions) {
                app_handle.plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::collection_cmd::list_collections,
            commands::collection_cmd::create_collection,
            commands::collection_cmd::update_collection,
            commands::collection_cmd::delete_collection,
            commands::collection_cmd::get_collection_tree,
            commands::collection_cmd::list_groups,
            commands::collection_cmd::create_group,
            commands::collection_cmd::update_group,
            commands::collection_cmd::set_group_parent,
            commands::collection_cmd::delete_group,
            commands::collection_cmd::reorder_sidebar,
            commands::item_cmd::create_item,
            commands::item_cmd::get_item,
            commands::item_cmd::update_item,
            commands::item_cmd::reorder_items,
            commands::item_cmd::duplicate_item,
            commands::item_cmd::delete_item,
            commands::item_cmd::send_request,
            commands::item_cmd::send_request_stream,
            commands::item_cmd::quick_test,
            commands::item_cmd::quick_test_stream,
            commands::item_cmd::parse_curl,
            commands::item_cmd::export_curl,
            commands::item_cmd::read_file_preview,
            commands::assertion_cmd::list_assertions,
            commands::assertion_cmd::get_assertion_counts,
            commands::assertion_cmd::create_assertion,
            commands::assertion_cmd::update_assertion,
            commands::assertion_cmd::delete_assertion,
            commands::runner_cmd::run_collection,
            commands::runner_cmd::cancel_run,
            commands::runner_cmd::run_chain,
            commands::runner_cmd::export_report_html,
            commands::runner_cmd::list_history,
            commands::runner_cmd::list_history_filtered,
            commands::runner_cmd::history_stats,
            commands::runner_cmd::delete_history,
            commands::runner_cmd::clear_history,
            commands::runner_cmd::list_item_runs,
            commands::runner_cmd::get_collection_status,
            commands::ai_cmd::ai_generate_tests,
            commands::ai_cmd::ai_suggest_assertions,
            commands::ai_cmd::ai_chat,
            commands::ai_cmd::save_setting,
            commands::ai_cmd::get_setting_cmd,
            commands::ai_cmd::test_ai_connection,
            commands::env_cmd::list_environments,
            commands::env_cmd::create_environment,
            commands::env_cmd::update_environment,
            commands::env_cmd::delete_environment,
            commands::env_cmd::set_active_environment,
            commands::env_cmd::get_environment_with_vars,
            commands::env_cmd::save_env_variables,
            commands::pty_cmd::pty_spawn,
            commands::pty_cmd::pty_write,
            commands::pty_cmd::pty_resize,
            commands::pty_cmd::pty_kill,
            commands::pty_cmd::prepare_mcp_config,
            commands::claude_cmd::claude_warmup,
            commands::claude_cmd::claude_session_ready,
            commands::claude_cmd::claude_send,
            commands::claude_cmd::claude_stop,
            commands::claude_cmd::claude_reset_session,
            commands::claude_cmd::claude_take_spare,
            commands::claude_cmd::claude_warmup_spare,
            commands::claude_cmd::claude_check_status,
            commands::import_cmd::import_yaml_cases,
            commands::import_cmd::import_postman_collection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
