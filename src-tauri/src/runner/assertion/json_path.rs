use serde_json::Value;

/// 简易 JSON Path 提取（支持 $.a.b.c 和 $.a[0].b 语法）
pub fn extract_json_path(value: &Value, path: &str) -> Option<Value> {
    let path = path.trim();
    let path = if let Some(stripped) = path.strip_prefix("$.") {
        stripped
    } else if let Some(stripped) = path.strip_prefix('$') {
        stripped
    } else {
        path
    };

    if path.is_empty() {
        return Some(value.clone());
    }

    let mut current = value.clone();
    for segment in split_path(path) {
        match segment {
            PathSegment::Key(key) => {
                current = current.get(&key)?.clone();
            }
            PathSegment::Index(idx) => {
                current = current.get(idx)?.clone();
            }
        }
    }
    Some(current)
}

pub fn value_to_string(val: &Value) -> String {
    match val {
        Value::String(s) => s.clone(),
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        other => other.to_string(),
    }
}

enum PathSegment {
    Key(String),
    Index(usize),
}

fn split_path(path: &str) -> Vec<PathSegment> {
    let mut segments = Vec::new();
    let mut current = String::new();

    let chars: Vec<char> = path.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '.' => {
                if !current.is_empty() {
                    segments.push(PathSegment::Key(current.clone()));
                    current.clear();
                }
            }
            '[' => {
                if !current.is_empty() {
                    segments.push(PathSegment::Key(current.clone()));
                    current.clear();
                }
                i += 1;
                let mut idx_str = String::new();
                while i < chars.len() && chars[i] != ']' {
                    idx_str.push(chars[i]);
                    i += 1;
                }
                if let Ok(idx) = idx_str.parse::<usize>() {
                    segments.push(PathSegment::Index(idx));
                }
            }
            c => current.push(c),
        }
        i += 1;
    }
    if !current.is_empty() {
        segments.push(PathSegment::Key(current));
    }
    segments
}
