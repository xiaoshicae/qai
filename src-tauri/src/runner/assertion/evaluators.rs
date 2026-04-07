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
