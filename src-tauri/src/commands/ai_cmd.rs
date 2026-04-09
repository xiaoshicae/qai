use rusqlite::Connection;
use tauri::State;

use crate::ai::{claude, parser, prompts};
use crate::db::init::DbState;
use crate::errors::AppError;

#[derive(serde::Serialize)]
pub struct GeneratedTestResult {
    pub count: usize,
    pub message: String,
}

fn get_ai_config(conn: &Connection) -> Result<(String, String), AppError> {
    let api_key = get_setting(conn, "ai_api_key")
        .or_else(|| get_setting(conn, "claude_api_key"))
        .ok_or_else(|| AppError::Generic("请先在设置中配置 API Key".into()))?;
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
) -> Result<GeneratedTestResult, AppError> {
    let (api_key, model) = {
        let conn = db.conn()?;
        get_ai_config(&conn)?
    };

    let prompt = prompts::generate_test_cases_prompt(&context, &extra_instructions);
    let response = claude::chat(&api_key, &model, &prompt).await?;

    let test_cases = parser::parse_test_cases(&response)?;
    let count = test_cases.len();

    {
        let conn = db.conn()?;
        for tc in &test_cases {
            let item = crate::db::item::create(
                &conn,
                &collection_id,
                None,
                "request",
                &tc.name,
                &tc.method,
            )?;

            crate::db::item::update(
                &conn,
                &item.id,
                &crate::models::item::UpdateItemPayload {
                    url: Some(tc.url.clone()),
                    headers: Some(serde_json::to_string(&tc.headers).unwrap_or_default()),
                    query_params: Some(serde_json::to_string(&tc.query_params).unwrap_or_default()),
                    body_type: Some(tc.body_type.clone()),
                    body_content: Some(tc.body_content.clone()),
                    ..Default::default()
                },
            )?;

            for assertion in &tc.assertions {
                crate::db::assertion::create(
                    &conn,
                    &item.id,
                    &assertion.assertion_type,
                    &assertion.expression,
                    &assertion.operator,
                    &assertion.expected,
                )?;
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
) -> Result<Vec<parser::GeneratedAssertion>, AppError> {
    let (api_key, model) = {
        let conn = db.conn()?;
        get_ai_config(&conn)?
    };

    let prompt = prompts::suggest_assertions_prompt(&response_body, status_code);
    let response = claude::chat(&api_key, &model, &prompt).await?;

    Ok(parser::parse_assertions(&response)?)
}

#[tauri::command]
pub async fn ai_chat(db: State<'_, DbState>, message: String) -> Result<String, AppError> {
    let (api_key, model) = {
        let conn = db.conn()?;
        get_ai_config(&conn)?
    };

    Ok(claude::chat(&api_key, &model, &message).await?)
}

#[tauri::command]
pub fn save_setting(db: State<'_, DbState>, key: String, value: String) -> Result<(), AppError> {
    let conn = db.conn()?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = datetime('now', 'localtime')",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

#[tauri::command]
pub fn get_setting_cmd(db: State<'_, DbState>, key: String) -> Result<Option<String>, AppError> {
    let conn = db.conn()?;
    Ok(get_setting(&conn, &key))
}

#[tauri::command]
pub async fn test_ai_connection(
    provider: String,
    api_key: String,
    model: String,
    base_url: Option<String>,
) -> Result<String, AppError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(crate::AI_TEST_TIMEOUT_SECS))
        .build()?;

    let (url, headers, body) = match provider.as_str() {
        "openai" | "other" => {
            let base = base_url.unwrap_or_else(|| "https://api.openai.com".to_string());
            let url = format!("{}/v1/chat/completions", base.trim_end_matches('/'));
            let body = serde_json::json!({
                "model": model,
                "max_tokens": 5,
                "messages": [{"role": "user", "content": "hi"}]
            });
            (
                url,
                vec![("Authorization", format!("Bearer {}", api_key))],
                body,
            )
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
            (
                url,
                vec![
                    ("x-api-key", api_key.clone()),
                    ("anthropic-version", "2023-06-01".to_string()),
                ],
                body,
            )
        }
    };

    let mut req = client.post(&url).header("content-type", "application/json");
    for (k, v) in &headers {
        req = req.header(*k, v);
    }

    let resp = req
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Generic(format!("连接失败: {}", e)))?;
    let status = resp.status();

    if status.is_success() {
        Ok("连接成功".to_string())
    } else {
        let text = resp.text().await.unwrap_or_default();
        Err(format!("API 返回 {}: {}", status.as_u16(), text).into())
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
