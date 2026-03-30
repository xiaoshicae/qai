pub fn generate_test_cases_prompt(context: &str, extra_instructions: &str) -> String {
    let mut prompt = format!(
        r#"你是一个 API 测试专家。请分析以下代码或 API 文档，为其中的 API 端点生成全面的测试用例。

{context}

请为每个 API 端点生成测试用例，包括：
1. 正常流程（Happy Path）
2. 参数边界值测试
3. 缺失必填字段
4. 非法输入
5. 错误状态码验证

请以 JSON 数组格式返回，每个测试用例的格式如下：
```json
[
  {{
    "name": "测试用例名称",
    "method": "GET",
    "url": "完整的请求 URL",
    "headers": [
      {{"key": "Content-Type", "value": "application/json", "enabled": true}}
    ],
    "query_params": [
      {{"key": "page", "value": "1", "enabled": true}}
    ],
    "body_type": "json",
    "body_content": "{{\\"key\\": \\"value\\"}}",
    "assertions": [
      {{"type": "status_code", "operator": "eq", "expected": "200"}},
      {{"type": "json_path", "expression": "$.data.id", "operator": "exists", "expected": ""}},
      {{"type": "response_time", "operator": "lt", "expected": "2000"}}
    ]
  }}
]
```

body_type 可以是: none, json, form, raw
assertion type 可以是: status_code, json_path, body_contains, response_time, header_contains
operator 可以是: eq, neq, gt, lt, gte, lte, contains, not_contains, exists, matches

只返回 JSON 数组，不要有其他文字。"#,
        context = context,
    );

    if !extra_instructions.is_empty() {
        prompt.push_str(&format!("\n\n额外要求：{}", extra_instructions));
    }

    prompt
}

fn truncate_str(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        s.chars().take(max_chars).collect()
    }
}

pub fn suggest_assertions_prompt(response_body: &str, status_code: u16) -> String {
    format!(
        r#"分析以下 API 响应，建议合适的断言规则。

状态码: {status_code}
响应体:
```json
{response_body}
```

请以 JSON 数组格式返回建议的断言：
```json
[
  {{"type": "status_code", "expression": "", "operator": "eq", "expected": "200"}},
  {{"type": "json_path", "expression": "$.data.id", "operator": "exists", "expected": ""}}
]
```

只返回 JSON 数组，不要有其他文字。"#,
        status_code = status_code,
        response_body = truncate_str(response_body, 3000),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_prompt_contains_context() {
        let prompt = generate_test_cases_prompt("GET /api/users", "");
        assert!(prompt.contains("GET /api/users"));
        assert!(prompt.contains("JSON 数组"));
    }

    #[test]
    fn test_generate_prompt_with_extra_instructions() {
        let prompt = generate_test_cases_prompt("context", "只测POST");
        assert!(prompt.contains("只测POST"));
        assert!(prompt.contains("额外要求"));
    }

    #[test]
    fn test_generate_prompt_no_extra() {
        let prompt = generate_test_cases_prompt("context", "");
        assert!(!prompt.contains("额外要求"));
    }

    #[test]
    fn test_suggest_assertions_prompt() {
        let prompt = suggest_assertions_prompt(r#"{"id":1}"#, 200);
        assert!(prompt.contains("200"));
        assert!(prompt.contains(r#"{"id":1}"#));
        assert!(prompt.contains("JSON 数组"));
    }

    #[test]
    fn test_suggest_assertions_truncates_long_body() {
        let long_body = "x".repeat(5000);
        let prompt = suggest_assertions_prompt(&long_body, 200);
        assert!(prompt.len() < long_body.len() + 500);
    }

    #[test]
    fn test_truncate_str_short() {
        assert_eq!(truncate_str("hello", 10), "hello");
    }

    #[test]
    fn test_truncate_str_exact() {
        assert_eq!(truncate_str("hello", 5), "hello");
    }

    #[test]
    fn test_truncate_str_long() {
        assert_eq!(truncate_str("hello world", 5), "hello");
    }

    #[test]
    fn test_truncate_str_unicode() {
        assert_eq!(truncate_str("你好世界测试", 4), "你好世界");
    }
}
