/// 根据工具名和输入参数生成简短摘要
pub fn tool_use_summary(name: &str, input: Option<&serde_json::Value>) -> String {
    let input = match input {
        Some(v) => v,
        None => return String::new(),
    };
    match name {
        "Bash" => {
            let cmd = input.get("command").and_then(|v| v.as_str()).unwrap_or("");
            truncate_str(cmd, 200)
        }
        "Read" | "Write" | "Edit" => {
            let path = input
                .get("file_path")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            truncate_str(path, 200)
        }
        "Glob" | "Grep" => {
            let pattern = input.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
            truncate_str(pattern, 200)
        }
        "WebSearch" | "WebFetch" => {
            let q = input
                .get("query")
                .or_else(|| input.get("url"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            truncate_str(q, 200)
        }
        _ => {
            // 通用：取第一个字符串值
            if let Some(obj) = input.as_object() {
                for val in obj.values() {
                    if let Some(s) = val.as_str() {
                        if !s.is_empty() {
                            return truncate_str(s, 120);
                        }
                    }
                }
            }
            String::new()
        }
    }
}

fn truncate_str(s: &str, max: usize) -> String {
    let s = s.lines().next().unwrap_or(s); // 只取第一行
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let end = s.char_indices().nth(max).map_or(s.len(), |(i, _)| i);
        format!("{}…", &s[..end])
    }
}
