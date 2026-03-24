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

/// 从 AI 响应文本中提取 JSON 数组
pub fn parse_test_cases(text: &str) -> Result<Vec<GeneratedTestCase>, anyhow::Error> {
    // 尝试直接解析
    if let Ok(cases) = serde_json::from_str::<Vec<GeneratedTestCase>>(text.trim()) {
        return Ok(cases);
    }

    // 尝试从 markdown code block 中提取
    if let Some(json_str) = extract_json_from_markdown(text) {
        if let Ok(cases) = serde_json::from_str::<Vec<GeneratedTestCase>>(&json_str) {
            return Ok(cases);
        }
    }

    // 尝试找到第一个 [ 和最后一个 ]
    if let (Some(start), Some(end)) = (text.find('['), text.rfind(']')) {
        if start < end {
            let json_str = &text[start..=end];
            if let Ok(cases) = serde_json::from_str::<Vec<GeneratedTestCase>>(json_str) {
                return Ok(cases);
            }
        }
    }

    anyhow::bail!("无法从 AI 响应中解析出测试用例 JSON")
}

pub fn parse_assertions(text: &str) -> Result<Vec<GeneratedAssertion>, anyhow::Error> {
    if let Ok(assertions) = serde_json::from_str::<Vec<GeneratedAssertion>>(text.trim()) {
        return Ok(assertions);
    }

    if let Some(json_str) = extract_json_from_markdown(text) {
        if let Ok(assertions) = serde_json::from_str::<Vec<GeneratedAssertion>>(&json_str) {
            return Ok(assertions);
        }
    }

    if let (Some(start), Some(end)) = (text.find('['), text.rfind(']')) {
        if start < end {
            let json_str = &text[start..=end];
            if let Ok(assertions) = serde_json::from_str::<Vec<GeneratedAssertion>>(json_str) {
                return Ok(assertions);
            }
        }
    }

    anyhow::bail!("无法从 AI 响应中解析出断言 JSON")
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
}
