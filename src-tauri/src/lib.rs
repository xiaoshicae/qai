mod commands;
pub mod db;
mod http;
pub mod models;
pub mod runner;
pub mod ai;
mod report;
pub mod pty;

use db::init::initialize_database;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let app_handle = app.handle();
            initialize_database(app_handle)?;
            app.manage(pty::PtyState::new());
            app.manage(commands::claude_cmd::ClaudeState::new());

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
            commands::collection_cmd::update_collection_meta,
            commands::collection_cmd::delete_collection,
            commands::collection_cmd::get_collection_tree,
            commands::collection_cmd::create_folder,
            commands::collection_cmd::get_folder,
            commands::collection_cmd::update_folder,
            commands::collection_cmd::delete_folder,
            commands::request_cmd::create_request,
            commands::request_cmd::get_request,
            commands::request_cmd::update_request,
            commands::request_cmd::delete_request,
            commands::request_cmd::send_request,
            commands::request_cmd::send_request_stream,
            commands::assertion_cmd::list_assertions,
            commands::assertion_cmd::create_assertion,
            commands::assertion_cmd::update_assertion,
            commands::assertion_cmd::delete_assertion,
            commands::runner_cmd::run_collection,
            commands::runner_cmd::run_chain,
            commands::runner_cmd::export_report_html,
            commands::runner_cmd::list_history,
            commands::runner_cmd::list_request_runs,
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
            commands::claude_cmd::claude_send,
            commands::claude_cmd::claude_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
