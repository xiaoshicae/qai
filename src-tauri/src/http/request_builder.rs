use crate::models::item::{CollectionItem, KeyValuePair};

/// 文件上传最大大小限制（50MB）
const MAX_FILE_SIZE: u64 = 50 * 1024 * 1024;

/// 验证文件路径安全性
/// 防止目录遍历攻击和读取敏感系统文件
pub fn validate_file_path(path: &str) -> Result<std::path::PathBuf, anyhow::Error> {
    let path = std::path::Path::new(path);
    
    // 检查路径是否为空
    if path.as_os_str().is_empty() {
        return Err(anyhow::anyhow!("文件路径不能为空"));
    }
    
    // 规范化路径（解析 .. 和符号链接）
    let canonical = path.canonicalize()
        .map_err(|e| anyhow::anyhow!("文件路径无效: {}", e))?;

    // 检查是否尝试读取敏感系统文件（Unix）
    #[cfg(unix)]
    {
        let path_str = canonical.to_string_lossy();
        // 阻止读取 /etc/passwd, /etc/shadow 等敏感文件
        if path_str.starts_with("/etc/passwd") 
            || path_str.starts_with("/etc/shadow")
            || path_str.starts_with("/etc/sudoers") {
            return Err(anyhow::anyhow!("不允许读取系统敏感文件"));
        }
    }
    
    // 检查是否尝试读取敏感系统文件（Windows）
    #[cfg(windows)]
    {
        let path_str = canonical.to_string_lossy().to_lowercase();
        if path_str.contains("\\windows\\system32\\config\\")
            || path_str.contains("\\windows\\system32\\sam") {
            return Err(anyhow::anyhow!("不允许读取系统敏感文件"));
        }
    }
    
    Ok(canonical)
}

/// 检查文件大小是否在限制内
async fn check_file_size(path: &std::path::Path) -> Result<(), anyhow::Error> {
    let metadata = tokio::fs::metadata(path).await
        .map_err(|e| anyhow::anyhow!("无法获取文件信息: {}", e))?;
    let size = metadata.len();
    
    if size > MAX_FILE_SIZE {
        return Err(anyhow::anyhow!(
            "文件过大 ({}MB)，已超过 {}MB 限制", 
            size / 1024 / 1024, 
            MAX_FILE_SIZE / 1024 / 1024
        ));
    }
    
    Ok(())
}

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

    // form-data / json / urlencoded 由 reqwest 自动设置 Content-Type（含 boundary 等），
    // 用户手动设置的 Content-Type 会导致冲突（如 multipart 缺 boundary），因此需要过滤掉
    let auto_ct = matches!(item.body_type.as_str(), "form-data" | "json" | "form" | "urlencoded");
    let mut sent_headers = Vec::new();
    for kv in headers.iter().filter(|kv| kv.enabled) {
        if auto_ct && kv.key.eq_ignore_ascii_case("content-type") {
            log::info!("[request] 跳过用户 Content-Type: {}", kv.value);
            continue;
        }
        sent_headers.push(format!("{}: {}", kv.key, kv.value));
        builder = builder.header(&kv.key, &kv.value);
    }

    let enabled_params: Vec<(&str, &str)> = query_params
        .iter()
        .filter(|kv| kv.enabled)
        .map(|kv| (kv.key.as_str(), kv.value.as_str()))
        .collect();
    builder = builder.query(&enabled_params);

    log::info!("[request] {} {} body_type={} headers=[{}]",
        item.method, item.url, item.body_type, sent_headers.join(", "));

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
                    // 验证文件路径安全性
                    let validated_path = validate_file_path(&kv.value)?;
                    // 检查文件大小
                    check_file_size(&validated_path).await?;
                    // 读取文件
                    let file_bytes = tokio::fs::read(&validated_path).await?;
                    let filename = validated_path
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
