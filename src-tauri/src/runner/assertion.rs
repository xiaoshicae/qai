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
    use crate::models::item::KeyValuePair;

    fn make_assertion(atype: &str, expr: &str, op: &str, expected: &str) -> Assertion {
        Assertion {
            id: "a1".into(),
            item_id: "r1".into(),
            assertion_type: atype.into(),
            expression: expr.into(),
            operator: op.into(),
            expected: expected.into(),
            enabled: true,
            sort_order: 0,
            created_at: String::new(),
        }
    }

    fn make_response(status: u16, body: &str, time_ms: u64, headers: Vec<KeyValuePair>) -> HttpResponse {
        HttpResponse {
            status,
            status_text: "OK".into(),
            headers,
            body: body.into(),
            time_ms,
            size_bytes: body.len() as u64,
        }
    }

    // ─── JSON Path ──────────────────────────────────────────

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
    fn test_json_path_root_dollar() {
        let json: Value = serde_json::json!({"a": 1});
        assert_eq!(extract_json_path(&json, "$"), Some(json.clone()));
    }

    #[test]
    fn test_json_path_deeply_nested() {
        let json: Value = serde_json::json!({"a": {"b": {"c": {"d": "deep"}}}});
        assert_eq!(extract_json_path(&json, "$.a.b.c.d"), Some(Value::String("deep".into())));
    }

    #[test]
    fn test_json_path_not_found() {
        let json: Value = serde_json::json!({"a": 1});
        assert_eq!(extract_json_path(&json, "$.missing"), None);
    }

    #[test]
    fn test_json_path_without_dollar() {
        let json: Value = serde_json::json!({"name": "test"});
        assert_eq!(extract_json_path(&json, "name"), Some(Value::String("test".into())));
    }

    #[test]
    fn test_json_path_empty_path() {
        let json: Value = serde_json::json!({"a": 1});
        assert_eq!(extract_json_path(&json, ""), Some(json.clone()));
        assert_eq!(extract_json_path(&json, "$"), Some(json.clone()));
    }

    // ─── compare ────────────────────────────────────────────

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

    #[test]
    fn test_compare_exists() {
        assert!(compare("value", "exists", ""));
        assert!(!compare("", "exists", ""));
    }

    #[test]
    fn test_compare_not_exists() {
        assert!(compare("", "not_exists", ""));
        assert!(!compare("value", "not_exists", ""));
    }

    #[test]
    fn test_compare_matches_invalid_regex() {
        assert!(!compare("abc", "matches", "[invalid"));
    }

    #[test]
    fn test_compare_non_numeric_gt() {
        assert!(!compare("abc", "gt", "def"));
    }

    #[test]
    fn test_compare_unknown_operator_fallback_eq() {
        assert!(compare("same", "unknown_op", "same"));
        assert!(!compare("a", "unknown_op", "b"));
    }

    // ─── value_to_string ────────────────────────────────────

    #[test]
    fn test_value_to_string_all_types() {
        assert_eq!(value_to_string(&Value::String("hello".into())), "hello");
        assert_eq!(value_to_string(&Value::Null), "null");
        assert_eq!(value_to_string(&Value::Bool(true)), "true");
        assert_eq!(value_to_string(&Value::Bool(false)), "false");
        assert_eq!(value_to_string(&serde_json::json!(42)), "42");
        assert_eq!(value_to_string(&serde_json::json!(3.14)), "3.14");
        // Object/Array 用 JSON 格式
        let obj = serde_json::json!({"a": 1});
        assert_eq!(value_to_string(&obj), obj.to_string());
    }

    // ─── evaluate_status_code ───────────────────────────────

    #[test]
    fn test_eval_status_code_eq_pass() {
        let a = make_assertion("status_code", "", "eq", "200");
        let r = make_response(200, "", 0, vec![]);
        let results = evaluate_assertions(&[a], &r);
        assert!(results[0].passed);
        assert_eq!(results[0].actual, "200");
    }

    #[test]
    fn test_eval_status_code_eq_fail() {
        let a = make_assertion("status_code", "", "eq", "200");
        let r = make_response(404, "", 0, vec![]);
        let results = evaluate_assertions(&[a], &r);
        assert!(!results[0].passed);
    }

    #[test]
    fn test_eval_status_code_neq() {
        let a = make_assertion("status_code", "", "neq", "404");
        let r = make_response(200, "", 0, vec![]);
        let results = evaluate_assertions(&[a], &r);
        assert!(results[0].passed);
    }

    #[test]
    fn test_eval_status_code_gte() {
        let a = make_assertion("status_code", "", "gte", "200");
        let r = make_response(200, "", 0, vec![]);
        let results = evaluate_assertions(&[a], &r);
        assert!(results[0].passed);
    }

    #[test]
    fn test_eval_status_code_lt() {
        let a = make_assertion("status_code", "", "lt", "300");
        let r = make_response(200, "", 0, vec![]);
        let results = evaluate_assertions(&[a], &r);
        assert!(results[0].passed);
    }

    // ─── evaluate_json_path ─────────────────────────────────

    #[test]
    fn test_eval_json_path_eq_pass() {
        let a = make_assertion("json_path", "$.id", "eq", "1");
        let r = make_response(200, r#"{"id":1}"#, 0, vec![]);
        let results = evaluate_assertions(&[a], &r);
        assert!(results[0].passed);
    }

    #[test]
    fn test_eval_json_path_nested() {
        let a = make_assertion("json_path", "$.a.b.c", "eq", "deep");
        let r = make_response(200, r#"{"a":{"b":{"c":"deep"}}}"#, 0, vec![]);
        let results = evaluate_assertions(&[a], &r);
        assert!(results[0].passed);
    }

    #[test]
    fn test_eval_json_path_not_found() {
        let a = make_assertion("json_path", "$.missing", "eq", "x");
        let r = make_response(200, r#"{"a":1}"#, 0, vec![]);
        let results = evaluate_assertions(&[a], &r);
        assert!(!results[0].passed);
        assert!(results[0].message.contains("未找到"));
    }

    #[test]
    fn test_eval_json_path_not_exists_pass() {
        let a = make_assertion("json_path", "$.missing", "not_exists", "");
        let r = make_response(200, r#"{"a":1}"#, 0, vec![]);
        let results = evaluate_assertions(&[a], &r);
        assert!(results[0].passed);
    }

    #[test]
    fn test_eval_json_path_invalid_json() {
        let a = make_assertion("json_path", "$.id", "eq", "1");
        let r = make_response(200, "not json", 0, vec![]);
        let results = evaluate_assertions(&[a], &r);
        assert!(!results[0].passed);
        assert!(results[0].message.contains("不是有效 JSON"));
    }

    #[test]
    fn test_eval_json_path_boolean_value() {
        let a = make_assertion("json_path", "$.active", "eq", "true");
        let r = make_response(200, r#"{"active":true}"#, 0, vec![]);
        let results = evaluate_assertions(&[a], &r);
        assert!(results[0].passed);
    }

    #[test]
    fn test_eval_json_path_null_value() {
        let a = make_assertion("json_path", "$.val", "eq", "null");
        let r = make_response(200, r#"{"val":null}"#, 0, vec![]);
        let results = evaluate_assertions(&[a], &r);
        assert!(results[0].passed);
    }

    // ─── evaluate_body_contains ─────────────────────────────

    #[test]
    fn test_eval_body_contains_pass() {
        let a = make_assertion("body_contains", "", "contains", "hello");
        let r = make_response(200, "hello world", 0, vec![]);
        let results = evaluate_assertions(&[a], &r);
        assert!(results[0].passed);
    }

    #[test]
    fn test_eval_body_contains_fail() {
        let a = make_assertion("body_contains", "", "contains", "missing");
        let r = make_response(200, "hello world", 0, vec![]);
        let results = evaluate_assertions(&[a], &r);
        assert!(!results[0].passed);
    }

    #[test]
    fn test_eval_body_not_contains_pass() {
        let a = make_assertion("body_contains", "", "not_contains", "missing");
        let r = make_response(200, "hello world", 0, vec![]);
        let results = evaluate_assertions(&[a], &r);
        assert!(results[0].passed);
    }

    #[test]
    fn test_eval_body_not_contains_fail() {
        let a = make_assertion("body_contains", "", "not_contains", "hello");
        let r = make_response(200, "hello world", 0, vec![]);
        let results = evaluate_assertions(&[a], &r);
        assert!(!results[0].passed);
    }

    // ─── evaluate_response_time ─────────────────────────────

    #[test]
    fn test_eval_response_time_lt_pass() {
        let a = make_assertion("response_time", "", "lt", "100");
        let r = make_response(200, "", 50, vec![]);
        let results = evaluate_assertions(&[a], &r);
        assert!(results[0].passed);
    }

    #[test]
    fn test_eval_response_time_lt_fail() {
        let a = make_assertion("response_time", "", "lt", "100");
        let r = make_response(200, "", 200, vec![]);
        let results = evaluate_assertions(&[a], &r);
        assert!(!results[0].passed);
    }

    #[test]
    fn test_eval_response_time_gt() {
        let a = make_assertion("response_time", "", "gt", "100");
        let r = make_response(200, "", 200, vec![]);
        let results = evaluate_assertions(&[a], &r);
        assert!(results[0].passed);
    }

    // ─── evaluate_header_contains ───────────────────────────

    #[test]
    fn test_eval_header_exists() {
        let a = make_assertion("header_contains", "X-Custom", "exists", "");
        let r = make_response(200, "", 0, vec![KeyValuePair {
            key: "x-custom".into(), value: "val".into(), enabled: true, field_type: String::new(),
        }]);
        let results = evaluate_assertions(&[a], &r);
        assert!(results[0].passed);
    }

    #[test]
    fn test_eval_header_not_exists_pass() {
        let a = make_assertion("header_contains", "X-Missing", "not_exists", "");
        let r = make_response(200, "", 0, vec![]);
        let results = evaluate_assertions(&[a], &r);
        assert!(results[0].passed);
    }

    #[test]
    fn test_eval_header_missing_eq_fail() {
        let a = make_assertion("header_contains", "X-Missing", "eq", "val");
        let r = make_response(200, "", 0, vec![]);
        let results = evaluate_assertions(&[a], &r);
        assert!(!results[0].passed);
    }

    #[test]
    fn test_eval_header_case_insensitive() {
        let a = make_assertion("header_contains", "Content-Type", "contains", "json");
        let r = make_response(200, "", 0, vec![KeyValuePair {
            key: "content-type".into(), value: "application/json".into(), enabled: true, field_type: String::new(),
        }]);
        let results = evaluate_assertions(&[a], &r);
        assert!(results[0].passed);
    }

    // ─── evaluate_assertions 综合 ───────────────────────────

    #[test]
    fn test_eval_assertions_empty() {
        let r = make_response(200, "", 0, vec![]);
        let results = evaluate_assertions(&[], &r);
        assert!(results.is_empty());
    }

    #[test]
    fn test_eval_assertions_disabled_skipped() {
        let mut a = make_assertion("status_code", "", "eq", "999");
        a.enabled = false;
        let r = make_response(200, "", 0, vec![]);
        let results = evaluate_assertions(&[a], &r);
        assert!(results.is_empty());
    }

    #[test]
    fn test_eval_assertions_multiple_mixed() {
        let a1 = make_assertion("status_code", "", "eq", "200");
        let a2 = make_assertion("status_code", "", "eq", "404");
        let mut a3 = make_assertion("body_contains", "", "contains", "ok");
        a3.id = "a3".into();
        let r = make_response(200, "ok", 0, vec![]);
        let results = evaluate_assertions(&[a1, a2, a3], &r);
        assert_eq!(results.len(), 3);
        assert!(results[0].passed);
        assert!(!results[1].passed);
        assert!(results[2].passed);
    }

    #[test]
    fn test_eval_unknown_assertion_type() {
        let a = make_assertion("invalid_type", "", "eq", "x");
        let r = make_response(200, "", 0, vec![]);
        let results = evaluate_assertions(&[a], &r);
        assert!(!results[0].passed);
        assert!(results[0].message.contains("未知断言类型"));
    }
}
