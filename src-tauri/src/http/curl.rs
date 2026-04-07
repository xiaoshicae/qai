use crate::models::item::KeyValuePair;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurlParseResult {
    pub method: String,
    pub url: String,
    pub headers: Vec<KeyValuePair>,
    pub body_type: String,
    pub body_content: String,
}

/// 解析 curl 命令为请求参数
pub fn parse_curl(input: &str) -> Result<CurlParseResult, String> {
    let input = input.trim();
    // 去掉行尾反斜杠续行
    let input = input.replace("\\\n", " ").replace("\\\r\n", " ");

    let tokens = tokenize(&input)?;
    if tokens.is_empty() || (tokens[0] != "curl" && !tokens[0].ends_with("/curl")) {
        return Err("不是有效的 curl 命令".into());
    }

    let mut method = String::new();
    let mut url = String::new();
    let mut headers: Vec<KeyValuePair> = Vec::new();
    let mut data: Option<String> = None;
    let mut form_fields: Vec<KeyValuePair> = Vec::new();

    let mut i = 1;
    while i < tokens.len() {
        let token = &tokens[i];
        match token.as_str() {
            "-X" | "--request" => {
                i += 1;
                if i < tokens.len() {
                    method = tokens[i].to_uppercase();
                }
            }
            "-H" | "--header" => {
                i += 1;
                if i < tokens.len() {
                    if let Some((key, value)) = tokens[i].split_once(':') {
                        headers.push(KeyValuePair {
                            key: key.trim().to_string(),
                            value: value.trim().to_string(),
                            enabled: true,
                            field_type: String::new(),
                        });
                    }
                }
            }
            "-d" | "--data" | "--data-raw" | "--data-binary" => {
                i += 1;
                if i < tokens.len() {
                    data = Some(tokens[i].clone());
                }
            }
            "--data-urlencode" => {
                i += 1;
                if i < tokens.len() {
                    data = Some(tokens[i].clone());
                }
            }
            "-F" | "--form" => {
                i += 1;
                if i < tokens.len() {
                    let val = &tokens[i];
                    if let Some((key, value)) = val.split_once('=') {
                        let is_file = value.starts_with('@');
                        let raw = if is_file { &value[1..] } else { value };
                        // 去掉 Postman 导出的包裹双引号，如 '"value"' → 'value'
                        let actual_value = strip_surrounding_quotes(raw);
                        form_fields.push(KeyValuePair {
                            key: key.to_string(),
                            value: actual_value,
                            enabled: true,
                            field_type: if is_file {
                                "file".to_string()
                            } else {
                                String::new()
                            },
                        });
                    }
                }
            }
            // 跳过常见无关 flag（无参数）
            "-s" | "--silent" | "-k" | "--insecure" | "-v" | "--verbose" | "-L" | "--location"
            | "--compressed" | "-i" | "--include" | "-S" | "--show-error" => {}
            // 跳过带参数的 flag
            "-o" | "--output" | "-w" | "--write-out" | "--connect-timeout" | "--max-time"
            | "-u" | "--user" | "--cacert" | "--cert" | "-b" | "--cookie" | "-c"
            | "--cookie-jar" => {
                i += 1; // 跳过参数值
            }
            _ => {
                // 可能是 URL
                if !token.starts_with('-') && url.is_empty() {
                    url = token.clone();
                }
            }
        }
        i += 1;
    }

    // 推断 method（--form 也隐含 POST）
    if method.is_empty() {
        method = if data.is_some() || !form_fields.is_empty() {
            "POST".into()
        } else {
            "GET".into()
        };
    }

    // 推断 body_type
    let content_type = headers
        .iter()
        .find(|h| h.key.eq_ignore_ascii_case("content-type"))
        .map(|h| h.value.to_lowercase());

    let (body_type, body_content) = if !form_fields.is_empty() {
        // -F 参数 → form-data，序列化为 JSON 数组（前端 KeyValueTable 格式）
        let json = serde_json::to_string(&form_fields).unwrap_or_default();
        ("form-data".into(), json)
    } else if let Some(ref d) = data {
        if content_type.as_deref() == Some("application/x-www-form-urlencoded") {
            ("urlencoded".into(), d.clone())
        } else if content_type
            .as_ref()
            .map(|c| c.contains("json"))
            .unwrap_or(false)
            || d.trim_start().starts_with('{')
        {
            ("json".into(), d.clone())
        } else {
            ("raw".into(), d.clone())
        }
    } else {
        ("none".into(), String::new())
    };

    Ok(CurlParseResult {
        method,
        url,
        headers,
        body_type,
        body_content,
    })
}

/// 从请求参数生成 curl 命令
pub fn to_curl(
    method: &str,
    url: &str,
    headers: &[KeyValuePair],
    body_type: &str,
    body_content: &str,
) -> String {
    let mut parts = vec![format!("curl -X {method}")];

    // URL
    parts.push(format!("  '{url}'"));

    // Headers
    for h in headers.iter().filter(|h| h.enabled) {
        parts.push(format!("  -H '{}: {}'", h.key, h.value));
    }

    // Body
    match body_type {
        "json" => {
            if !body_content.is_empty() {
                // 压缩 JSON
                let compact = serde_json::from_str::<serde_json::Value>(body_content)
                    .map(|v| serde_json::to_string(&v).unwrap_or_else(|_| body_content.to_string()))
                    .unwrap_or_else(|_| body_content.to_string());
                parts.push(format!("  -d '{compact}'"));
            }
        }
        "raw" => {
            if !body_content.is_empty() {
                parts.push(format!("  -d '{}'", body_content.replace('\'', "'\\''")));
            }
        }
        "urlencoded" | "form-data" => {
            if !body_content.is_empty() {
                // 尝试解析 KV 数组
                if let Ok(kvs) = serde_json::from_str::<Vec<KeyValuePair>>(body_content) {
                    for kv in kvs.iter().filter(|k| k.enabled) {
                        if body_type == "form-data" {
                            parts.push(format!("  -F '{}={}'", kv.key, kv.value));
                        } else {
                            parts.push(format!("  --data-urlencode '{}={}'", kv.key, kv.value));
                        }
                    }
                } else {
                    parts.push(format!("  -d '{body_content}'"));
                }
            }
        }
        _ => {}
    }

    parts.join(" \\\n")
}

/// 去掉包裹的双引号：`"value"` → `value`
fn strip_surrounding_quotes(s: &str) -> String {
    if s.len() >= 2 && s.starts_with('"') && s.ends_with('"') {
        s[1..s.len() - 1].to_string()
    } else {
        s.to_string()
    }
}

/// 简单的 shell tokenizer（处理引号）
fn tokenize(input: &str) -> Result<Vec<String>, String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut escape_next = false;

    for ch in input.chars() {
        if escape_next {
            current.push(ch);
            escape_next = false;
            continue;
        }
        if ch == '\\' && !in_single_quote {
            escape_next = true;
            continue;
        }
        if ch == '\'' && !in_double_quote {
            in_single_quote = !in_single_quote;
            continue;
        }
        if ch == '"' && !in_single_quote {
            in_double_quote = !in_double_quote;
            continue;
        }
        if ch.is_whitespace() && !in_single_quote && !in_double_quote {
            if !current.is_empty() {
                tokens.push(current.clone());
                current.clear();
            }
            continue;
        }
        current.push(ch);
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    Ok(tokens)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_get() {
        let result = parse_curl("curl https://api.example.com/health").unwrap();
        assert_eq!(result.method, "GET");
        assert_eq!(result.url, "https://api.example.com/health");
        assert_eq!(result.body_type, "none");
    }

    #[test]
    fn test_parse_post_json() {
        let result = parse_curl(r#"curl -X POST https://api.example.com/data -H 'Content-Type: application/json' -d '{"key":"value"}'"#).unwrap();
        assert_eq!(result.method, "POST");
        assert_eq!(result.url, "https://api.example.com/data");
        assert_eq!(result.body_type, "json");
        assert_eq!(result.body_content, r#"{"key":"value"}"#);
        assert_eq!(result.headers.len(), 1);
    }

    #[test]
    fn test_parse_multiline() {
        let curl = "curl -X POST \\\n  https://api.example.com/v1 \\\n  -H 'Authorization: Bearer token' \\\n  -d '{\"msg\":\"hi\"}'";
        let result = parse_curl(curl).unwrap();
        assert_eq!(result.method, "POST");
        assert!(result.url.contains("api.example.com"));
    }

    #[test]
    fn test_to_curl_get() {
        let curl = to_curl("GET", "https://example.com/api", &[], "none", "");
        assert!(curl.contains("curl -X GET"));
        assert!(curl.contains("https://example.com/api"));
    }

    #[test]
    fn test_to_curl_post_json() {
        let headers = vec![KeyValuePair {
            key: "Content-Type".into(),
            value: "application/json".into(),
            enabled: true,
            field_type: String::new(),
        }];
        let curl = to_curl(
            "POST",
            "https://example.com/api",
            &headers,
            "json",
            r#"{"a":1}"#,
        );
        assert!(curl.contains("-X POST"));
        assert!(curl.contains("-H 'Content-Type: application/json'"));
        assert!(curl.contains("-d"));
    }

    #[test]
    fn test_parse_form_data_postman_quoted_values() {
        // Postman 导出格式：单引号包裹双引号 --form 'key="value"'
        let curl = r#"curl --location 'https://api.example.com/upload' \
--header 'Authorization: Bearer token' \
--form 'model="whisper-v3"' \
--form 'language="en"' \
--form 'file=@"/Users/test/audio.webm"'"#;
        let result = parse_curl(curl).unwrap();
        assert_eq!(result.method, "POST"); // --form 隐含 POST
        let fields: Vec<KeyValuePair> = serde_json::from_str(&result.body_content).unwrap();
        assert_eq!(fields[0].value, "whisper-v3"); // 无多余引号
        assert_eq!(fields[1].value, "en");
        assert_eq!(fields[2].value, "/Users/test/audio.webm"); // 文件路径也无引号
        assert_eq!(fields[2].field_type, "file");
    }

    #[test]
    fn test_parse_form_data_fields() {
        let curl = r#"curl -X POST 'http://localhost:8000/api/v1/generate' -H 'Authorization: Bearer token' -F 'model=whisper_v3_turbo' -F 'language=en' -F 'file=@/Users/test/audio.wav'"#;
        let result = parse_curl(curl).unwrap();
        assert_eq!(result.method, "POST");
        assert_eq!(result.body_type, "form-data");
        let fields: Vec<serde_json::Value> = serde_json::from_str(&result.body_content).unwrap();
        assert_eq!(fields.len(), 3);
        assert_eq!(fields[0]["key"], "model");
        assert_eq!(fields[0]["value"], "whisper_v3_turbo");
        assert_eq!(fields[2]["key"], "file");
        assert_eq!(fields[2]["value"], "/Users/test/audio.wav");
        assert_eq!(fields[2]["fieldType"], "file");
    }
}
