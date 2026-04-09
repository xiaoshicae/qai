use crate::models::assertion::{Assertion, AssertionResult};
use crate::models::item::HttpResponse;

use super::compare::{compare, truncate_str};
use super::json_path::{extract_json_path, value_to_string};

pub fn evaluate_single(assertion: &Assertion, response: &HttpResponse) -> AssertionResult {
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
            format!(
                "状态码 {} {} {}",
                actual, &assertion.operator, &assertion.expected
            )
        } else {
            format!(
                "状态码 {} 不满足 {} {}",
                actual, &assertion.operator, &assertion.expected
            )
        },
    }
}

fn evaluate_json_path(assertion: &Assertion, response: &HttpResponse) -> AssertionResult {
    let body: serde_json::Value = match serde_json::from_str(&response.body) {
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
                    format!(
                        "{} = {} {} {}",
                        &assertion.expression, actual_str, &assertion.operator, &assertion.expected
                    )
                } else {
                    format!(
                        "{} = {}，不满足 {} {}",
                        &assertion.expression, actual_str, &assertion.operator, &assertion.expected
                    )
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
            format!(
                "响应体{}包含 \"{}\"",
                if assertion.operator == "not_contains" {
                    "不"
                } else {
                    ""
                },
                &assertion.expected
            )
        } else {
            format!(
                "响应体{}包含 \"{}\"",
                if assertion.operator == "not_contains" {
                    ""
                } else {
                    "不"
                },
                &assertion.expected
            )
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
            format!(
                "响应时间 {}ms {} {}ms",
                actual, &assertion.operator, &assertion.expected
            )
        } else {
            format!(
                "响应时间 {}ms 不满足 {} {}ms",
                actual, &assertion.operator, &assertion.expected
            )
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
                    format!(
                        "Header {} = {} {} {}",
                        &assertion.expression, val, &assertion.operator, &assertion.expected
                    )
                } else {
                    format!(
                        "Header {} = {}，不满足 {} {}",
                        &assertion.expression, val, &assertion.operator, &assertion.expected
                    )
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

    fn make_response(status: u16, body: &str, time_ms: u64) -> HttpResponse {
        HttpResponse {
            status,
            status_text: "OK".into(),
            headers: vec![KeyValuePair {
                key: "content-type".into(),
                value: "application/json".into(),
                enabled: true,
                field_type: String::new(),
            }],
            body: body.into(),
            time_ms,
            size_bytes: body.len() as u64,
        }
    }

    // ─── status_code ────────────────────────────────────────
    #[test]
    fn test_status_code_eq_pass() {
        let a = make_assertion("status_code", "", "eq", "200");
        let r = make_response(200, "", 100);
        let result = evaluate_single(&a, &r);
        assert!(result.passed);
        assert_eq!(result.actual, "200");
    }

    #[test]
    fn test_status_code_eq_fail() {
        let a = make_assertion("status_code", "", "eq", "200");
        let r = make_response(404, "", 100);
        let result = evaluate_single(&a, &r);
        assert!(!result.passed);
        assert_eq!(result.actual, "404");
    }

    #[test]
    fn test_status_code_neq() {
        let a = make_assertion("status_code", "", "neq", "500");
        let r = make_response(200, "", 100);
        assert!(evaluate_single(&a, &r).passed);
    }

    // ─── json_path ──────────────────────────────────────────
    #[test]
    fn test_json_path_pass() {
        let a = make_assertion("json_path", "$.id", "eq", "42");
        let r = make_response(200, r#"{"id": 42}"#, 100);
        let result = evaluate_single(&a, &r);
        assert!(result.passed);
        assert_eq!(result.actual, "42");
    }

    #[test]
    fn test_json_path_fail() {
        let a = make_assertion("json_path", "$.id", "eq", "99");
        let r = make_response(200, r#"{"id": 42}"#, 100);
        assert!(!evaluate_single(&a, &r).passed);
    }

    #[test]
    fn test_json_path_invalid_json() {
        let a = make_assertion("json_path", "$.id", "eq", "1");
        let r = make_response(200, "not json", 100);
        let result = evaluate_single(&a, &r);
        assert!(!result.passed);
        assert!(result.message.contains("JSON"));
    }

    #[test]
    fn test_json_path_missing_path() {
        let a = make_assertion("json_path", "$.missing", "eq", "1");
        let r = make_response(200, r#"{"id": 1}"#, 100);
        let result = evaluate_single(&a, &r);
        assert!(!result.passed);
    }

    #[test]
    fn test_json_path_not_exists_pass() {
        let a = make_assertion("json_path", "$.missing", "not_exists", "");
        let r = make_response(200, r#"{"id": 1}"#, 100);
        assert!(evaluate_single(&a, &r).passed);
    }

    // ─── body_contains ──────────────────────────────────────
    #[test]
    fn test_body_contains_pass() {
        let a = make_assertion("body_contains", "", "contains", "success");
        let r = make_response(200, r#"{"result":"success"}"#, 100);
        assert!(evaluate_single(&a, &r).passed);
    }

    #[test]
    fn test_body_contains_fail() {
        let a = make_assertion("body_contains", "", "contains", "error");
        let r = make_response(200, r#"{"result":"success"}"#, 100);
        assert!(!evaluate_single(&a, &r).passed);
    }

    #[test]
    fn test_body_not_contains() {
        let a = make_assertion("body_contains", "", "not_contains", "error");
        let r = make_response(200, r#"{"result":"success"}"#, 100);
        assert!(evaluate_single(&a, &r).passed);
    }

    // ─── response_time ──────────────────────────────────────
    #[test]
    fn test_response_time_lt_pass() {
        let a = make_assertion("response_time", "", "lt", "1000");
        let r = make_response(200, "", 500);
        assert!(evaluate_single(&a, &r).passed);
    }

    #[test]
    fn test_response_time_lt_fail() {
        let a = make_assertion("response_time", "", "lt", "100");
        let r = make_response(200, "", 500);
        assert!(!evaluate_single(&a, &r).passed);
    }

    // ─── header_contains ────────────────────────────────────
    #[test]
    fn test_header_contains_pass() {
        let a = make_assertion("header_contains", "content-type", "contains", "json");
        let r = make_response(200, "", 100);
        assert!(evaluate_single(&a, &r).passed);
    }

    #[test]
    fn test_header_contains_case_insensitive_key() {
        let a = make_assertion("header_contains", "Content-Type", "contains", "json");
        let r = make_response(200, "", 100);
        assert!(evaluate_single(&a, &r).passed);
    }

    #[test]
    fn test_header_missing() {
        let a = make_assertion("header_contains", "x-custom", "eq", "value");
        let r = make_response(200, "", 100);
        let result = evaluate_single(&a, &r);
        assert!(!result.passed);
    }

    #[test]
    fn test_header_not_exists_pass() {
        let a = make_assertion("header_contains", "x-missing", "not_exists", "");
        let r = make_response(200, "", 100);
        assert!(evaluate_single(&a, &r).passed);
    }

    // ─── unknown type ───────────────────────────────────────
    #[test]
    fn test_unknown_assertion_type() {
        let a = make_assertion("unknown_type", "", "eq", "");
        let r = make_response(200, "", 100);
        let result = evaluate_single(&a, &r);
        assert!(!result.passed);
        assert!(result.message.contains("未知断言类型"));
    }
}
