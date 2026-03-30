mod compare;
mod evaluators;
pub mod json_path;

use crate::models::assertion::{Assertion, AssertionResult};
use crate::models::execution::ExecutionResult;
use crate::models::item::HttpResponse;

pub fn evaluate_assertions(assertions: &[Assertion], response: &HttpResponse) -> Vec<AssertionResult> {
    assertions
        .iter()
        .filter(|a| a.enabled)
        .map(|a| evaluators::evaluate_single(a, response))
        .collect()
}

/// 对 ExecutionResult 执行断言并更新 status
pub fn apply_assertions(result: &mut ExecutionResult, assertions: &[Assertion]) {
    if let Some(ref response) = result.response {
        if !assertions.is_empty() {
            result.assertion_results = evaluate_assertions(assertions, response);
            if result.assertion_results.iter().any(|a| !a.passed) {
                result.status = crate::models::Status::Failed.to_string();
            } else {
                result.status = crate::models::Status::Success.to_string();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::item::KeyValuePair;
    use super::json_path::{extract_json_path, value_to_string};
    use super::compare::compare;
    use serde_json::Value;

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
