use crate::models::item::{CollectionItem, KeyValuePair};

/// 从 CollectionItem 构建 reqwest::RequestBuilder（method + headers + query + body）
pub async fn build_request(
    client: &reqwest::Client,
    item: &CollectionItem,
) -> Result<reqwest::RequestBuilder, anyhow::Error> {
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

    builder = apply_body(builder, &item.body_type, &item.body_content).await?;

    Ok(builder)
}

async fn apply_body(
    mut builder: reqwest::RequestBuilder,
    body_type: &str,
    body_content: &str,
) -> Result<reqwest::RequestBuilder, anyhow::Error> {
    match body_type {
        "json" => {
            if !body_content.is_empty() {
                let json_value: serde_json::Value = serde_json::from_str(body_content)
                    .unwrap_or(serde_json::Value::String(body_content.to_string()));
                builder = builder.json(&json_value);
            }
        }
        "raw" => {
            if !body_content.is_empty() {
                builder = builder.body(body_content.to_string());
            }
        }
        "form" | "urlencoded" => {
            let form_data: Vec<KeyValuePair> =
                serde_json::from_str(body_content).unwrap_or_default();
            let form: Vec<(&str, &str)> = form_data
                .iter()
                .filter(|kv| kv.enabled)
                .map(|kv| (kv.key.as_str(), kv.value.as_str()))
                .collect();
            builder = builder.form(&form);
        }
        "form-data" => {
            let form_data: Vec<KeyValuePair> =
                serde_json::from_str(body_content).unwrap_or_default();
            let mut multipart = reqwest::multipart::Form::new();
            for kv in form_data.iter().filter(|kv| kv.enabled) {
                if kv.field_type == "file" && !kv.value.is_empty() {
                    let file_bytes = tokio::fs::read(&kv.value).await?;
                    let filename = std::path::Path::new(&kv.value)
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();
                    let mime = mime_from_filename(&filename);
                    let part = reqwest::multipart::Part::bytes(file_bytes)
                        .file_name(filename)
                        .mime_str(&mime)
                        .unwrap();
                    multipart = multipart.part(kv.key.clone(), part);
                } else {
                    multipart = multipart.text(kv.key.clone(), kv.value.clone());
                }
            }
            builder = builder.multipart(multipart);
        }
        _ => {}
    }
    Ok(builder)
}

fn mime_from_filename(filename: &str) -> String {
    let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "webm" => "audio/webm",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "mp4" => "video/mp4",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
    .to_string()
}
