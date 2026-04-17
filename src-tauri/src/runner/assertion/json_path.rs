use serde_json::Value;

/// JSON Path 提取（兼容旧调用方：返回首个匹配；多值场景用 [`extract_json_path_all`]）
///
/// 支持语法：
/// - `$.a.b.c` 普通字段
/// - `$.a[0].b` 数组索引
/// - `$.arr[*]` 数组通配（取所有元素）
/// - `$.obj.*` 对象通配（取所有 value）
/// - `$..name` 递归取所有名为 `name` 的字段
/// - `$.arr[0:3]` 数组切片（左闭右开），支持 `[:3]` `[2:]` `[:]`
pub fn extract_json_path(value: &Value, path: &str) -> Option<Value> {
    extract_json_path_all(value, path).into_iter().next()
}

/// 多值 JSON Path 提取，返回所有匹配
pub fn extract_json_path_all(value: &Value, path: &str) -> Vec<Value> {
    let normalized = normalize_path(path);
    if normalized.is_empty() {
        return vec![value.clone()];
    }
    let segments = match parse_segments(&normalized) {
        Some(s) => s,
        None => return Vec::new(),
    };
    walk(value, &segments)
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

fn normalize_path(path: &str) -> String {
    let trimmed = path.trim();
    if let Some(rest) = trimmed.strip_prefix('$') {
        rest.to_string()
    } else {
        trimmed.to_string()
    }
}

#[derive(Debug, Clone)]
enum PathSegment {
    /// `.key`
    Key(String),
    /// `[idx]`
    Index(usize),
    /// `[*]` 或 `.*`
    Wildcard,
    /// `..` 后续段递归向下查找
    RecursiveDescent,
    /// `[start:end]`，None 代表省略边界
    Slice(Option<usize>, Option<usize>),
}

fn parse_segments(path: &str) -> Option<Vec<PathSegment>> {
    let mut segments = Vec::new();
    let mut current = String::new();
    let chars: Vec<char> = path.chars().collect();
    let mut i = 0;

    let flush_key = |buf: &mut String, segs: &mut Vec<PathSegment>| {
        if !buf.is_empty() {
            if buf == "*" {
                segs.push(PathSegment::Wildcard);
            } else {
                segs.push(PathSegment::Key(std::mem::take(buf)));
            }
            buf.clear();
        }
    };

    while i < chars.len() {
        match chars[i] {
            '.' => {
                flush_key(&mut current, &mut segments);
                // `..` 递归 descent
                if i + 1 < chars.len() && chars[i + 1] == '.' {
                    segments.push(PathSegment::RecursiveDescent);
                    i += 2;
                    continue;
                }
                i += 1;
            }
            '[' => {
                flush_key(&mut current, &mut segments);
                i += 1;
                let mut inner = String::new();
                while i < chars.len() && chars[i] != ']' {
                    inner.push(chars[i]);
                    i += 1;
                }
                if i >= chars.len() {
                    // 未闭合
                    return None;
                }
                i += 1; // 跳过 ']'
                let inner = inner.trim();
                if inner == "*" {
                    segments.push(PathSegment::Wildcard);
                } else if inner.contains(':') {
                    let parts: Vec<&str> = inner.splitn(2, ':').collect();
                    let start = parts[0].trim();
                    let end = parts.get(1).map(|s| s.trim()).unwrap_or("");
                    let s = if start.is_empty() {
                        None
                    } else {
                        Some(start.parse::<usize>().ok()?)
                    };
                    let e = if end.is_empty() {
                        None
                    } else {
                        Some(end.parse::<usize>().ok()?)
                    };
                    segments.push(PathSegment::Slice(s, e));
                } else if let Ok(idx) = inner.parse::<usize>() {
                    segments.push(PathSegment::Index(idx));
                } else if inner.starts_with('\'') && inner.ends_with('\'') && inner.len() >= 2 {
                    // 引号 key：['name']
                    segments.push(PathSegment::Key(inner[1..inner.len() - 1].to_string()));
                } else {
                    // 不识别的语法（如 [?()] 过滤）：返回 None 让上层得到空匹配
                    return None;
                }
            }
            c => {
                current.push(c);
                i += 1;
            }
        }
    }
    if !current.is_empty() {
        if current == "*" {
            segments.push(PathSegment::Wildcard);
        } else {
            segments.push(PathSegment::Key(current));
        }
    }
    Some(segments)
}

fn walk(value: &Value, segments: &[PathSegment]) -> Vec<Value> {
    let mut current = vec![value.clone()];
    let mut i = 0;
    while i < segments.len() {
        let seg = &segments[i];
        match seg {
            PathSegment::Key(k) => {
                current = current.iter().filter_map(|v| v.get(k).cloned()).collect();
            }
            PathSegment::Index(idx) => {
                current = current.iter().filter_map(|v| v.get(idx).cloned()).collect();
            }
            PathSegment::Wildcard => {
                let mut next = Vec::new();
                for v in &current {
                    match v {
                        Value::Array(arr) => next.extend(arr.iter().cloned()),
                        Value::Object(obj) => next.extend(obj.values().cloned()),
                        _ => {}
                    }
                }
                current = next;
            }
            PathSegment::Slice(s, e) => {
                let mut next = Vec::new();
                for v in &current {
                    if let Value::Array(arr) = v {
                        let start = s.unwrap_or(0).min(arr.len());
                        let end = e.unwrap_or(arr.len()).min(arr.len());
                        if start < end {
                            next.extend(arr[start..end].iter().cloned());
                        }
                    }
                }
                current = next;
            }
            PathSegment::RecursiveDescent => {
                // 收集当前节点及其所有后代
                let mut all = Vec::new();
                for v in &current {
                    collect_descendants(v, &mut all);
                }
                current = all;
            }
        }
        i += 1;
    }
    current
}

fn collect_descendants(value: &Value, out: &mut Vec<Value>) {
    out.push(value.clone());
    match value {
        Value::Array(arr) => {
            for child in arr {
                collect_descendants(child, out);
            }
        }
        Value::Object(obj) => {
            for child in obj.values() {
                collect_descendants(child, out);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_simple_dot_path() {
        let v = json!({"a": {"b": {"c": 42}}});
        assert_eq!(extract_json_path(&v, "$.a.b.c"), Some(json!(42)));
    }

    #[test]
    fn test_array_index() {
        let v = json!({"arr": [10, 20, 30]});
        assert_eq!(extract_json_path(&v, "$.arr[1]"), Some(json!(20)));
    }

    #[test]
    fn test_root_only() {
        let v = json!({"x": 1});
        assert_eq!(extract_json_path(&v, "$"), Some(json!({"x": 1})));
    }

    #[test]
    fn test_missing_returns_none() {
        let v = json!({"a": 1});
        assert!(extract_json_path(&v, "$.missing").is_none());
    }

    #[test]
    fn test_wildcard_array() {
        let v = json!({"users": [{"name": "a"}, {"name": "b"}]});
        let all = extract_json_path_all(&v, "$.users[*].name");
        assert_eq!(all, vec![json!("a"), json!("b")]);
    }

    #[test]
    fn test_wildcard_object() {
        let v = json!({"obj": {"x": 1, "y": 2}});
        let mut all = extract_json_path_all(&v, "$.obj.*");
        all.sort_by(|a, b| a.to_string().cmp(&b.to_string()));
        assert_eq!(all, vec![json!(1), json!(2)]);
    }

    #[test]
    fn test_slice_full() {
        let v = json!({"a": [1, 2, 3, 4]});
        let all = extract_json_path_all(&v, "$.a[1:3]");
        assert_eq!(all, vec![json!(2), json!(3)]);
    }

    #[test]
    fn test_slice_open_end() {
        let v = json!({"a": [1, 2, 3, 4]});
        let all = extract_json_path_all(&v, "$.a[2:]");
        assert_eq!(all, vec![json!(3), json!(4)]);
    }

    #[test]
    fn test_slice_open_start() {
        let v = json!({"a": [1, 2, 3, 4]});
        let all = extract_json_path_all(&v, "$.a[:2]");
        assert_eq!(all, vec![json!(1), json!(2)]);
    }

    #[test]
    fn test_recursive_descent() {
        let v = json!({"a": {"b": {"name": "x"}}, "list": [{"name": "y"}]});
        let mut all = extract_json_path_all(&v, "$..name");
        all.sort_by(|a, b| a.to_string().cmp(&b.to_string()));
        assert_eq!(all, vec![json!("x"), json!("y")]);
    }

    #[test]
    fn test_filter_unsupported_returns_empty() {
        // 过滤语法 [?()] 暂不支持，返回空匹配（不 panic）
        let v = json!({"arr": [{"age": 18}, {"age": 25}]});
        let all = extract_json_path_all(&v, "$.arr[?(@.age>20)]");
        assert!(all.is_empty());
    }

    #[test]
    fn test_quoted_key() {
        let v = json!({"weird key": 1});
        assert_eq!(extract_json_path(&v, "$['weird key']"), Some(json!(1)));
    }

    #[test]
    fn test_value_to_string() {
        assert_eq!(value_to_string(&json!("hi")), "hi");
        assert_eq!(value_to_string(&json!(42)), "42");
        assert_eq!(value_to_string(&json!(true)), "true");
        assert_eq!(value_to_string(&json!(null)), "null");
    }
}
