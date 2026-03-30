use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct GeneratedTestCase {
    pub name: String,
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<GeneratedKeyValue>,
    #[serde(default)]
    pub query_params: Vec<GeneratedKeyValue>,
    #[serde(default = "default_body_type")]
    pub body_type: String,
    #[serde(default)]
    pub body_content: String,
    #[serde(default)]
    pub assertions: Vec<GeneratedAssertion>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct GeneratedKeyValue {
    pub key: String,
    pub value: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct GeneratedAssertion {
    #[serde(rename = "type")]
    pub assertion_type: String,
    #[serde(default)]
    pub expression: String,
    pub operator: String,
    #[serde(default)]
    pub expected: String,
}

fn default_body_type() -> String {
    "none".to_string()
}

fn default_true() -> bool {
    true
}

/// 从 AI 响应文本中提取 JSON 数组（泛型，支持任意可反序列化类型）
fn parse_json_array<T: serde::de::DeserializeOwned>(text: &str, desc: &str) -> Result<Vec<T>, anyhow::Error> {
    // 尝试直接解析
    if let Ok(items) = serde_json::from_str::<Vec<T>>(text.trim()) {
        return Ok(items);
    }

    // 尝试从 markdown code block 中提取
    if let Some(json_str) = extract_json_from_markdown(text) {
        if let Ok(items) = serde_json::from_str::<Vec<T>>(&json_str) {
            return Ok(items);
        }
    }

    // 尝试找到第一个 [ 和最后一个 ]
    if let (Some(start), Some(end)) = (text.find('['), text.rfind(']')) {
        if start < end {
            if let Ok(items) = serde_json::from_str::<Vec<T>>(&text[start..=end]) {
                return Ok(items);
            }
        }
    }

    anyhow::bail!("无法从 AI 响应中解析出{desc} JSON")
}

pub fn parse_test_cases(text: &str) -> Result<Vec<GeneratedTestCase>, anyhow::Error> {
    parse_json_array(text, "测试用例")
}

pub fn parse_assertions(text: &str) -> Result<Vec<GeneratedAssertion>, anyhow::Error> {
    parse_json_array(text, "断言")
}

fn extract_json_from_markdown(text: &str) -> Option<String> {
    let markers = ["```json", "```JSON", "```"];
    for marker in markers {
        if let Some(start) = text.find(marker) {
            let content_start = start + marker.len();
            if let Some(end) = text[content_start..].find("```") {
                return Some(text[content_start..content_start + end].trim().to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_direct_json() {
        let input = r#"[{"name":"test","method":"GET","url":"http://example.com","assertions":[{"type":"status_code","operator":"eq","expected":"200"}]}]"#;
        let cases = parse_test_cases(input).unwrap();
        assert_eq!(cases.len(), 1);
        assert_eq!(cases[0].name, "test");
        assert_eq!(cases[0].assertions.len(), 1);
        assert_eq!(cases[0].assertions[0].assertion_type, "status_code");
    }

    #[test]
    fn test_parse_markdown_wrapped() {
        let input = "这是一些说明文字\n```json\n[{\"name\":\"test\",\"method\":\"GET\",\"url\":\"http://example.com\"}]\n```\n其他文字";
        let cases = parse_test_cases(input).unwrap();
        assert_eq!(cases.len(), 1);
    }

    #[test]
    fn test_parse_with_surrounding_text() {
        let input = "下面是生成的测试用例：\n[{\"name\":\"test\",\"method\":\"POST\",\"url\":\"http://api.com/users\",\"body_type\":\"json\",\"body_content\":\"{}\"}]\n以上是所有用例。";
        let cases = parse_test_cases(input).unwrap();
        assert_eq!(cases.len(), 1);
        assert_eq!(cases[0].method, "POST");
    }

    #[test]
    fn test_parse_empty_array() {
        let cases = parse_test_cases("[]").unwrap();
        assert!(cases.is_empty());
    }

    #[test]
    fn test_parse_invalid_json() {
        let result = parse_test_cases("not json at all");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_defaults_body_type() {
        let input = r#"[{"name":"t","method":"GET","url":"http://x.com"}]"#;
        let cases = parse_test_cases(input).unwrap();
        assert_eq!(cases[0].body_type, "none");
    }

    #[test]
    fn test_parse_defaults_enabled() {
        let input = r#"[{"name":"t","method":"GET","url":"http://x.com","headers":[{"key":"a","value":"b"}]}]"#;
        let cases = parse_test_cases(input).unwrap();
        assert!(cases[0].headers[0].enabled);
    }

    #[test]
    fn test_parse_multiple_cases() {
        let input = r#"[
            {"name":"a","method":"GET","url":"http://a.com"},
            {"name":"b","method":"POST","url":"http://b.com"},
            {"name":"c","method":"PUT","url":"http://c.com"}
        ]"#;
        let cases = parse_test_cases(input).unwrap();
        assert_eq!(cases.len(), 3);
        assert_eq!(cases[2].method, "PUT");
    }

    #[test]
    fn test_parse_markdown_uppercase_json() {
        let input = "说明\n```JSON\n[{\"name\":\"t\",\"method\":\"GET\",\"url\":\"http://x.com\"}]\n```\n完毕";
        let cases = parse_test_cases(input).unwrap();
        assert_eq!(cases.len(), 1);
    }

    // ─── parse_assertions ───────────────────────────────────

    #[test]
    fn test_parse_assertions_direct() {
        let input = r#"[{"type":"status_code","operator":"eq","expected":"200"}]"#;
        let assertions = parse_assertions(input).unwrap();
        assert_eq!(assertions.len(), 1);
        assert_eq!(assertions[0].assertion_type, "status_code");
    }

    #[test]
    fn test_parse_assertions_markdown() {
        let input = "建议的断言：\n```json\n[{\"type\":\"json_path\",\"expression\":\"$.id\",\"operator\":\"exists\",\"expected\":\"\"}]\n```";
        let assertions = parse_assertions(input).unwrap();
        assert_eq!(assertions.len(), 1);
        assert_eq!(assertions[0].assertion_type, "json_path");
    }

    #[test]
    fn test_parse_assertions_in_text() {
        let input = "推荐以下断言：[{\"type\":\"body_contains\",\"operator\":\"contains\",\"expected\":\"ok\"}] 这些断言可以验证响应。";
        let assertions = parse_assertions(input).unwrap();
        assert_eq!(assertions.len(), 1);
    }

    #[test]
    fn test_parse_assertions_invalid() {
        let result = parse_assertions("garbage text with no json");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_assertions_empty_array() {
        let assertions = parse_assertions("[]").unwrap();
        assert!(assertions.is_empty());
    }

    // ─── extract_json_from_markdown ─────────────────────────

    #[test]
    fn test_extract_json_markdown_basic() {
        let input = "```json\n{\"a\":1}\n```";
        assert_eq!(extract_json_from_markdown(input), Some("{\"a\":1}".into()));
    }

    #[test]
    fn test_extract_json_markdown_no_close() {
        let input = "```json\n{\"a\":1}";
        assert_eq!(extract_json_from_markdown(input), None);
    }

    #[test]
    fn test_extract_json_no_marker() {
        let input = "plain text without code blocks";
        assert_eq!(extract_json_from_markdown(input), None);
    }

    #[test]
    fn test_extract_json_generic_block() {
        let input = "```\n[1,2,3]\n```";
        assert_eq!(extract_json_from_markdown(input), Some("[1,2,3]".into()));
    }
}
