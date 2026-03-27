use std::time::Instant;
use uuid::Uuid;

use crate::models::execution::{Execution, ExecutionResult};
use crate::models::item::{CollectionItem, HttpResponse, KeyValuePair};

pub async fn execute(client: &reqwest::Client, item: &CollectionItem) -> Result<ExecutionResult, anyhow::Error> {
    let headers: Vec<KeyValuePair> = serde_json::from_str(&item.headers).unwrap_or_default();
    let query_params: Vec<KeyValuePair> = serde_json::from_str(&item.query_params).unwrap_or_default();

    let mut builder = match item.method.to_uppercase().as_str() {
        "POST" => client.post(&item.url),
        "PUT" => client.put(&item.url),
        "DELETE" => client.delete(&item.url),
        "PATCH" => client.patch(&item.url),
        "HEAD" => client.head(&item.url),
        _ => client.get(&item.url),
    };

    for kv in headers.iter().filter(|kv| kv.enabled) {
        builder = builder.header(&kv.key, &kv.value);
    }

    let enabled_params: Vec<(&str, &str)> = query_params
        .iter()
        .filter(|kv| kv.enabled)
        .map(|kv| (kv.key.as_str(), kv.value.as_str()))
        .collect();
    builder = builder.query(&enabled_params);

    match item.body_type.as_str() {
        "json" => {
            if !item.body_content.is_empty() {
                let json_value: serde_json::Value = serde_json::from_str(&item.body_content)
                    .unwrap_or(serde_json::Value::String(item.body_content.clone()));
                builder = builder.json(&json_value);
            }
        }
        "raw" => {
            if !item.body_content.is_empty() {
                builder = builder.body(item.body_content.clone());
            }
        }
        "form" | "urlencoded" => {
            let form_data: Vec<KeyValuePair> =
                serde_json::from_str(&item.body_content).unwrap_or_default();
            let form: Vec<(&str, &str)> = form_data
                .iter()
                .filter(|kv| kv.enabled)
                .map(|kv| (kv.key.as_str(), kv.value.as_str()))
                .collect();
            builder = builder.form(&form);
        }
        "form-data" => {
            let form_data: Vec<KeyValuePair> =
                serde_json::from_str(&item.body_content).unwrap_or_default();
            let mut multipart = reqwest::multipart::Form::new();
            for kv in form_data.iter().filter(|kv| kv.enabled) {
                multipart = multipart.text(kv.key.clone(), kv.value.clone());
            }
            builder = builder.multipart(multipart);
        }
        _ => {}
    }

    let start = Instant::now();
    let resp = builder.send().await?;
    let time_ms = start.elapsed().as_millis() as u64;

    let status = resp.status().as_u16();
    let status_text = resp.status().canonical_reason().unwrap_or("").to_string();
    let resp_headers: Vec<KeyValuePair> = resp
        .headers()
        .iter()
        .map(|(k, v)| KeyValuePair {
            key: k.to_string(),
            value: v.to_str().unwrap_or("").to_string(),
            enabled: true,
        })
        .collect();

    let body = resp.text().await?;
    let size_bytes = body.len() as u64;

    let execution_id = Uuid::new_v4().to_string();

    let expected = item.expect_status;
    let is_success = if expected > 0 {
        status == expected
    } else {
        status >= 200 && status < 400
    };

    Ok(ExecutionResult {
        execution_id,
        item_id: item.id.clone(),
        item_name: item.name.clone(),
        status: if is_success { "success".to_string() } else { "failed".to_string() },
        response: Some(HttpResponse {
            status,
            status_text,
            headers: resp_headers,
            body,
            time_ms,
            size_bytes,
        }),
        assertion_results: vec![],
        error_message: None,
    })
}

pub fn to_execution(item: &CollectionItem, result: &ExecutionResult) -> Execution {
    let (response_status, response_headers, response_body, response_time_ms, response_size) =
        if let Some(ref resp) = result.response {
            (
                Some(resp.status),
                serde_json::to_string(&resp.headers).unwrap_or_default(),
                Some(resp.body.clone()),
                resp.time_ms,
                resp.size_bytes,
            )
        } else {
            (None, "{}".to_string(), None, 0, 0)
        };

    Execution {
        id: result.execution_id.clone(),
        item_id: item.id.clone(),
        collection_id: item.collection_id.clone(),
        batch_id: None,
        status: result.status.clone(),
        request_url: item.url.clone(),
        request_method: item.method.clone(),
        response_status,
        response_headers,
        response_body,
        response_time_ms,
        response_size,
        assertion_results: serde_json::to_string(&result.assertion_results).unwrap_or_default(),
        error_message: result.error_message.clone(),
        executed_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    }
}
