use crate::models::assertion::{Assertion, AssertionResult};
use crate::models::item::HttpResponse;
use regex::Regex;
use serde_json::Value;

pub fn evaluate_assertions(assertions: &[Assertion], response: &HttpResponse) -> Vec<AssertionResult> {
    assertions
        .iter()
        .filter(|a| a.enabled)
        .map(|a| evaluate_single(a, response))
        .collect()
}

fn evaluate_single(assertion: &Assertion, response: &HttpResponse) -> AssertionResult {
    match assertion.assertion_type.as_str() {
        "status_code" => evaluate_status_code(assertion, response),
        "json_path" => evaluate_json_path(assertion, response),
        "body_contains" => evaluate_body_contains(assertion, response),
        "response_time" => evaluate_response_time(assertion, response),
        "header_contains" => evaluate_header_contains(assertion, response),
        _ => AssertionResult {
            assertion_id: assertion.id.clone(),
            passed: false,
            actual: String::new(),
            message: format!("未知断言类型: {}", assertion.assertion_type),
        },
    }
}

fn evaluate_status_code(assertion: &Assertion, response: &HttpResponse) -> AssertionResult {
    let actual = response.status.to_string();
    let passed = compare(&actual, &assertion.operator, &assertion.expected);
    AssertionResult {
        assertion_id: assertion.id.clone(),
        passed,
        actual: actual.clone(),
        message: if passed {
            format!("状态码 {} {} {}", actual, &assertion.operator, &assertion.expected)
        } else {
            format!("状态码 {} 不满足 {} {}", actual, &assertion.operator, &assertion.expected)
        },
    }
}

fn evaluate_json_path(assertion: &Assertion, response: &HttpResponse) -> AssertionResult {
    let body: Value = match serde_json::from_str(&response.body) {
        Ok(v) => v,
        Err(_) => {
            return AssertionResult {
                assertion_id: assertion.id.clone(),
                passed: false,
                actual: String::new(),
                message: "响应体不是有效 JSON".to_string(),
            };
        }
    };

    let actual = extract_json_path(&body, &assertion.expression);
    match actual {
        Some(val) => {
            let actual_str = value_to_string(&val);
            let passed = compare(&actual_str, &assertion.operator, &assertion.expected);
            AssertionResult {
                assertion_id: assertion.id.clone(),
                passed,
                actual: actual_str.clone(),
                message: if passed {
                    format!("{} = {} {} {}", &assertion.expression, actual_str, &assertion.operator, &assertion.expected)
                } else {
                    format!("{} = {}，不满足 {} {}", &assertion.expression, actual_str, &assertion.operator, &assertion.expected)
                },
            }
        }
        None => {
            let passed = assertion.operator == "not_exists";
            AssertionResult {
                assertion_id: assertion.id.clone(),
                passed,
                actual: String::new(),
                message: if passed {
                    format!("{} 不存在（符合预期）", &assertion.expression)
                } else {
                    format!("路径 {} 未找到匹配值", &assertion.expression)
                },
            }
        }
    }
}

fn evaluate_body_contains(assertion: &Assertion, response: &HttpResponse) -> AssertionResult {
    let contains = response.body.contains(&assertion.expected);
    let passed = match assertion.operator.as_str() {
        "not_contains" => !contains,
        _ => contains,
    };
    AssertionResult {
        assertion_id: assertion.id.clone(),
        passed,
        actual: truncate_str(&response.body, 100),
        message: if passed {
            format!("响应体{}包含 \"{}\"", if assertion.operator == "not_contains" { "不" } else { "" }, &assertion.expected)
        } else {
            format!("响应体{}包含 \"{}\"", if assertion.operator == "not_contains" { "" } else { "不" }, &assertion.expected)
        },
    }
}

fn evaluate_response_time(assertion: &Assertion, response: &HttpResponse) -> AssertionResult {
    let actual = response.time_ms.to_string();
    let passed = compare(&actual, &assertion.operator, &assertion.expected);
    AssertionResult {
        assertion_id: assertion.id.clone(),
        passed,
        actual: format!("{}ms", actual),
        message: if passed {
            format!("响应时间 {}ms {} {}ms", actual, &assertion.operator, &assertion.expected)
        } else {
            format!("响应时间 {}ms 不满足 {} {}ms", actual, &assertion.operator, &assertion.expected)
        },
    }
}

fn evaluate_header_contains(assertion: &Assertion, response: &HttpResponse) -> AssertionResult {
    let header_val = response
        .headers
        .iter()
        .find(|h| h.key.eq_ignore_ascii_case(&assertion.expression))
        .map(|h| h.value.clone());

    match header_val {
        Some(val) => {
            let passed = compare(&val, &assertion.operator, &assertion.expected);
            AssertionResult {
                assertion_id: assertion.id.clone(),
                passed,
                actual: val.clone(),
                message: if passed {
                    format!("Header {} = {} {} {}", &assertion.expression, val, &assertion.operator, &assertion.expected)
                } else {
                    format!("Header {} = {}，不满足 {} {}", &assertion.expression, val, &assertion.operator, &assertion.expected)
                },
            }
        }
        None => {
            let passed = assertion.operator == "not_exists";
            AssertionResult {
                assertion_id: assertion.id.clone(),
                passed,
                actual: String::new(),
                message: if passed {
                    format!("Header {} 不存在（符合预期）", &assertion.expression)
                } else {
                    format!("Header {} 不存在", &assertion.expression)
                },
            }
        }
    }
}

/// 简易 JSON Path 提取（支持 $.a.b.c 和 $.a[0].b 语法）
pub fn extract_json_path(value: &Value, path: &str) -> Option<Value> {
    let path = path.trim();
    let path = if path.starts_with("$.") {
        &path[2..]
    } else if path.starts_with('$') {
        &path[1..]
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

pub fn value_to_string(val: &Value) -> String {
    match val {
        Value::String(s) => s.clone(),
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        other => other.to_string(),
    }
}

fn truncate_str(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        format!("{}...", s.chars().take(max_chars).collect::<String>())
    }
}

fn compare(actual: &str, operator: &str, expected: &str) -> bool {
    match operator {
        "eq" => actual == expected,
        "neq" => actual != expected,
        "contains" => actual.contains(expected),
        "not_contains" => !actual.contains(expected),
        "exists" => !actual.is_empty(),
        "not_exists" => actual.is_empty(),
        "matches" => Regex::new(expected).map(|re| re.is_match(actual)).unwrap_or(false),
        "gt" | "lt" | "gte" | "lte" => {
            let a = actual.parse::<f64>();
            let b = expected.parse::<f64>();
            match (a, b) {
                (Ok(a), Ok(b)) => match operator {
                    "gt" => a > b,
                    "lt" => a < b,
                    "gte" => a >= b,
                    "lte" => a <= b,
                    _ => false,
                },
                _ => false,
            }
        }
        _ => actual == expected,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_json_path_simple() {
        let json: Value = serde_json::json!({"name": "test", "data": {"id": 1}});
        assert_eq!(extract_json_path(&json, "$.name"), Some(Value::String("test".to_string())));
        assert_eq!(extract_json_path(&json, "$.data.id"), Some(serde_json::json!(1)));
    }

    #[test]
    fn test_json_path_array() {
        let json: Value = serde_json::json!({"items": [{"name": "a"}, {"name": "b"}]});
        assert_eq!(extract_json_path(&json, "$.items[0].name"), Some(Value::String("a".to_string())));
        assert_eq!(extract_json_path(&json, "$.items[1].name"), Some(Value::String("b".to_string())));
    }

    #[test]
    fn test_compare_operators() {
        assert!(compare("200", "eq", "200"));
        assert!(compare("200", "neq", "404"));
        assert!(compare("200", "gt", "100"));
        assert!(compare("200", "lt", "300"));
        assert!(compare("200", "gte", "200"));
        assert!(compare("200", "lte", "200"));
        assert!(compare("hello world", "contains", "world"));
        assert!(compare("hello", "not_contains", "world"));
        assert!(compare("abc123", "matches", r"\d+"));
    }
}
