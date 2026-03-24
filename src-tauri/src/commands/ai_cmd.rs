use rusqlite::Connection;
use tauri::State;

use crate::ai::{claude, parser, prompts};
use crate::db::init::DbState;

#[derive(serde::Serialize)]
pub struct GeneratedTestResult {
    pub count: usize,
    pub message: String,
}

fn get_ai_config(conn: &Connection) -> Result<(String, String), String> {
    let api_key = get_setting(conn, "ai_api_key")
        .or_else(|| get_setting(conn, "claude_api_key"))
        .ok_or_else(|| "请先在设置中配置 API Key".to_string())?;
    let model = get_setting(conn, "ai_model")
        .or_else(|| get_setting(conn, "claude_model"))
        .unwrap_or_else(|| "claude-sonnet-4-20250514".to_string());
    Ok((api_key, model))
}

#[tauri::command]
pub async fn ai_generate_tests(
    db: State<'_, DbState>,
    collection_id: String,
    context: String,
    extra_instructions: String,
) -> Result<GeneratedTestResult, String> {
    let (api_key, model) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        get_ai_config(&conn)?
    };

    let prompt = prompts::generate_test_cases_prompt(&context, &extra_instructions);
    let response = claude::chat(&api_key, &model, &prompt)
        .await
        .map_err(|e| e.to_string())?;

    let test_cases = parser::parse_test_cases(&response).map_err(|e| e.to_string())?;
    let count = test_cases.len();

    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        for tc in &test_cases {
            let req = crate::db::request::create(
                &conn, &collection_id, None, &tc.name, &tc.method,
            ).map_err(|e| e.to_string())?;

            crate::db::request::update(
                &conn,
                &req.id,
                None,
                None,
                Some(&tc.url),
                Some(&serde_json::to_string(&tc.headers).unwrap_or_default()),
                Some(&serde_json::to_string(&tc.query_params).unwrap_or_default()),
                Some(&tc.body_type),
                Some(&tc.body_content),
            ).map_err(|e| e.to_string())?;

            for assertion in &tc.assertions {
                crate::db::assertion::create(
                    &conn,
                    &req.id,
                    &assertion.assertion_type,
                    &assertion.expression,
                    &assertion.operator,
                    &assertion.expected,
                ).map_err(|e| e.to_string())?;
            }
        }
    }

    Ok(GeneratedTestResult {
        count,
        message: format!("成功生成 {} 个测试用例", count),
    })
}

#[tauri::command]
pub async fn ai_suggest_assertions(
    db: State<'_, DbState>,
    response_body: String,
    status_code: u16,
) -> Result<Vec<parser::GeneratedAssertion>, String> {
    let (api_key, model) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        get_ai_config(&conn)?
    };

    let prompt = prompts::suggest_assertions_prompt(&response_body, status_code);
    let response = claude::chat(&api_key, &model, &prompt)
        .await
        .map_err(|e| e.to_string())?;

    parser::parse_assertions(&response).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ai_chat(
    db: State<'_, DbState>,
    message: String,
) -> Result<String, String> {
    let (api_key, model) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        get_ai_config(&conn)?
    };

    claude::chat(&api_key, &model, &message)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_setting(db: State<'_, DbState>, key: String, value: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = datetime('now')",
        rusqlite::params![key, value],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_setting_cmd(db: State<'_, DbState>, key: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    Ok(get_setting(&conn, &key))
}

#[tauri::command]
pub async fn test_ai_connection(
    provider: String,
    api_key: String,
    model: String,
    base_url: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let (url, headers, body) = match provider.as_str() {
        "openai" | "other" => {
            let base = base_url.unwrap_or_else(|| "https://api.openai.com".to_string());
            let url = format!("{}/v1/chat/completions", base.trim_end_matches('/'));
            let body = serde_json::json!({
                "model": model,
                "max_tokens": 5,
                "messages": [{"role": "user", "content": "hi"}]
            });
            (url, vec![("Authorization", format!("Bearer {}", api_key))], body)
        }
        "gemini" => {
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                model, api_key
            );
            let body = serde_json::json!({
                "contents": [{"parts": [{"text": "hi"}]}],
                "generationConfig": {"maxOutputTokens": 5}
            });
            (url, vec![], body)
        }
        _ => {
            let url = "https://api.anthropic.com/v1/messages".to_string();
            let body = serde_json::json!({
                "model": model,
                "max_tokens": 5,
                "messages": [{"role": "user", "content": "hi"}]
            });
            (url, vec![
                ("x-api-key", api_key.clone()),
                ("anthropic-version", "2023-06-01".to_string()),
            ], body)
        }
    };

    let mut req = client.post(&url).header("content-type", "application/json");
    for (k, v) in &headers {
        req = req.header(*k, v);
    }

    let resp = req.json(&body).send().await.map_err(|e| format!("连接失败: {}", e))?;
    let status = resp.status();

    if status.is_success() {
        Ok("连接成功".to_string())
    } else {
        let text = resp.text().await.unwrap_or_default();
        Err(format!("API 返回 {}: {}", status.as_u16(), text))
    }
}

fn get_setting(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get(0),
    )
    .ok()
}
