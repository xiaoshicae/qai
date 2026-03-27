use std::collections::HashMap;
use regex::Regex;

use crate::models::environment::EnvVariable;
use crate::models::item::{CollectionItem, ExtractRule, HttpResponse, KeyValuePair};
use crate::runner::assertion::{extract_json_path, value_to_string};

pub fn build_var_map(variables: &[EnvVariable]) -> HashMap<String, String> {
    variables
        .iter()
        .filter(|v| v.enabled && !v.key.is_empty())
        .map(|v| (v.key.clone(), v.value.clone()))
        .collect()
}

pub fn replace_vars(text: &str, vars: &HashMap<String, String>) -> String {
    if vars.is_empty() || !text.contains("{{") {
        return text.to_string();
    }
    let re = Regex::new(r"\{\{(\w+)\}\}").unwrap();
    re.replace_all(text, |caps: &regex::Captures| {
        let key = &caps[1];
        vars.get(key).cloned().unwrap_or_else(|| caps[0].to_string())
    })
    .to_string()
}

pub fn apply_vars(req: &CollectionItem, vars: &HashMap<String, String>) -> CollectionItem {
    if vars.is_empty() {
        return req.clone();
    }

    let mut result = req.clone();
    result.url = replace_vars(&result.url, vars);
    result.body_content = replace_vars(&result.body_content, vars);

    // headers
    if let Ok(headers) = serde_json::from_str::<Vec<KeyValuePair>>(&result.headers) {
        let replaced: Vec<KeyValuePair> = headers
            .into_iter()
            .map(|mut kv| {
                kv.key = replace_vars(&kv.key, vars);
                kv.value = replace_vars(&kv.value, vars);
                kv
            })
            .collect();
        result.headers = serde_json::to_string(&replaced).unwrap_or(result.headers);
    }

    // query params
    if let Ok(params) = serde_json::from_str::<Vec<KeyValuePair>>(&result.query_params) {
        let replaced: Vec<KeyValuePair> = params
            .into_iter()
            .map(|mut kv| {
                kv.key = replace_vars(&kv.key, vars);
                kv.value = replace_vars(&kv.value, vars);
                kv
            })
            .collect();
        result.query_params = serde_json::to_string(&replaced).unwrap_or(result.query_params);
    }

    result
}

/// 从响应中按规则提取变量
pub fn extract_variables(rules: &[ExtractRule], response: &HttpResponse) -> HashMap<String, String> {
    let mut vars = HashMap::new();

    for rule in rules {
        let value = match rule.source.as_str() {
            "json_body" => {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&response.body) {
                    let path = if rule.expression.starts_with('$') {
                        rule.expression.clone()
                    } else {
                        format!("$.{}", rule.expression)
                    };
                    extract_json_path(&json, &path).map(|v| value_to_string(&v))
                } else {
                    None
                }
            }
            "header" => {
                response.headers.iter()
                    .find(|h| h.key.eq_ignore_ascii_case(&rule.expression))
                    .map(|h| h.value.clone())
            }
            "status_code" => {
                Some(response.status.to_string())
            }
            _ => None,
        };

        if let Some(v) = value {
            vars.insert(rule.var_name.clone(), v);
        }
    }

    vars
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::item::{CollectionItem, ExtractRule, HttpResponse, KeyValuePair};

    fn make_env_var(key: &str, value: &str, enabled: bool) -> EnvVariable {
        EnvVariable {
            id: "v1".into(),
            environment_id: "e1".into(),
            key: key.into(),
            value: value.into(),
            enabled,
            sort_order: 0,
        }
    }

    fn make_item(url: &str, headers: &str, params: &str, body: &str) -> CollectionItem {
        CollectionItem {
            id: "i1".into(),
            collection_id: "c1".into(),
            parent_id: None,
            item_type: "request".into(),
            name: "test".into(),
            sort_order: 0,
            method: "GET".into(),
            url: url.into(),
            headers: headers.into(),
            query_params: params.into(),
            body_type: "json".into(),
            body_content: body.into(),
            extract_rules: "[]".into(),
            description: String::new(),
            expect_status: 200,
            poll_config: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    // ─── replace_vars ───────────────────────────────────────

    #[test]
    fn test_replace_vars() {
        let mut vars = HashMap::new();
        vars.insert("base_url".to_string(), "https://api.example.com".to_string());
        vars.insert("token".to_string(), "abc123".to_string());

        assert_eq!(replace_vars("{{base_url}}/users", &vars), "https://api.example.com/users");
        assert_eq!(replace_vars("Bearer {{token}}", &vars), "Bearer abc123");
        assert_eq!(replace_vars("no vars here", &vars), "no vars here");
        assert_eq!(replace_vars("{{unknown}}", &vars), "{{unknown}}");
    }

    #[test]
    fn test_replace_vars_empty() {
        let vars = HashMap::new();
        assert_eq!(replace_vars("{{base_url}}/users", &vars), "{{base_url}}/users");
    }

    #[test]
    fn test_replace_vars_multiple_same() {
        let mut vars = HashMap::new();
        vars.insert("x".into(), "val".into());
        assert_eq!(replace_vars("{{x}}/{{x}}", &vars), "val/val");
    }

    #[test]
    fn test_replace_vars_adjacent() {
        let mut vars = HashMap::new();
        vars.insert("a".into(), "1".into());
        vars.insert("b".into(), "2".into());
        assert_eq!(replace_vars("{{a}}{{b}}", &vars), "12");
    }

    #[test]
    fn test_replace_vars_no_braces_fast_path() {
        let mut vars = HashMap::new();
        vars.insert("x".into(), "y".into());
        assert_eq!(replace_vars("plain text", &vars), "plain text");
    }

    // ─── build_var_map ──────────────────────────────────────

    #[test]
    fn test_build_var_map_basic() {
        let vars = vec![
            make_env_var("host", "localhost", true),
            make_env_var("port", "8080", true),
        ];
        let map = build_var_map(&vars);
        assert_eq!(map.len(), 2);
        assert_eq!(map["host"], "localhost");
        assert_eq!(map["port"], "8080");
    }

    #[test]
    fn test_build_var_map_skips_disabled() {
        let vars = vec![
            make_env_var("host", "localhost", true),
            make_env_var("secret", "xxx", false),
        ];
        let map = build_var_map(&vars);
        assert_eq!(map.len(), 1);
        assert!(!map.contains_key("secret"));
    }

    #[test]
    fn test_build_var_map_skips_empty_key() {
        let vars = vec![make_env_var("", "val", true)];
        let map = build_var_map(&vars);
        assert!(map.is_empty());
    }

    #[test]
    fn test_build_var_map_empty_input() {
        let map = build_var_map(&[]);
        assert!(map.is_empty());
    }

    // ─── apply_vars ─────────────────────────────────────────

    #[test]
    fn test_apply_vars_url_replaced() {
        let mut vars = HashMap::new();
        vars.insert("host".into(), "example.com".into());
        let item = make_item("https://{{host}}/api", "[]", "[]", "");
        let result = apply_vars(&item, &vars);
        assert_eq!(result.url, "https://example.com/api");
    }

    #[test]
    fn test_apply_vars_body_replaced() {
        let mut vars = HashMap::new();
        vars.insert("token".into(), "abc".into());
        let item = make_item("http://x.com", "[]", "[]", r#"{"token":"{{token}}"}"#);
        let result = apply_vars(&item, &vars);
        assert_eq!(result.body_content, r#"{"token":"abc"}"#);
    }

    #[test]
    fn test_apply_vars_headers_replaced() {
        let mut vars = HashMap::new();
        vars.insert("auth".into(), "Bearer tok".into());
        let headers = r#"[{"key":"Authorization","value":"{{auth}}","enabled":true}]"#;
        let item = make_item("http://x.com", headers, "[]", "");
        let result = apply_vars(&item, &vars);
        let parsed: Vec<KeyValuePair> = serde_json::from_str(&result.headers).unwrap();
        assert_eq!(parsed[0].value, "Bearer tok");
    }

    #[test]
    fn test_apply_vars_empty_vars_returns_clone() {
        let vars = HashMap::new();
        let item = make_item("http://{{host}}", "[]", "[]", "");
        let result = apply_vars(&item, &vars);
        assert_eq!(result.url, "http://{{host}}");
    }

    #[test]
    fn test_apply_vars_invalid_headers_json() {
        let mut vars = HashMap::new();
        vars.insert("x".into(), "y".into());
        let item = make_item("http://x.com", "not json", "[]", "");
        let result = apply_vars(&item, &vars);
        assert_eq!(result.headers, "not json");
    }

    // ─── extract_variables ──────────────────────────────────

    #[test]
    fn test_extract_var_from_json_body() {
        let rules = vec![ExtractRule {
            var_name: "token".into(),
            source: "json_body".into(),
            expression: "$.data.token".into(),
        }];
        let response = HttpResponse {
            status: 200, status_text: "OK".into(),
            headers: vec![], body: r#"{"data":{"token":"abc123"}}"#.into(),
            time_ms: 50, size_bytes: 30,
        };
        let vars = extract_variables(&rules, &response);
        assert_eq!(vars["token"], "abc123");
    }

    #[test]
    fn test_extract_var_from_header() {
        let rules = vec![ExtractRule {
            var_name: "req_id".into(),
            source: "header".into(),
            expression: "X-Request-Id".into(),
        }];
        let response = HttpResponse {
            status: 200, status_text: "OK".into(),
            headers: vec![KeyValuePair { key: "x-request-id".into(), value: "rid-123".into(), enabled: true }],
            body: String::new(), time_ms: 50, size_bytes: 0,
        };
        let vars = extract_variables(&rules, &response);
        assert_eq!(vars["req_id"], "rid-123");
    }

    #[test]
    fn test_extract_var_from_status_code() {
        let rules = vec![ExtractRule {
            var_name: "code".into(),
            source: "status_code".into(),
            expression: String::new(),
        }];
        let response = HttpResponse {
            status: 201, status_text: "Created".into(),
            headers: vec![], body: String::new(), time_ms: 50, size_bytes: 0,
        };
        let vars = extract_variables(&rules, &response);
        assert_eq!(vars["code"], "201");
    }

    #[test]
    fn test_extract_var_unknown_source() {
        let rules = vec![ExtractRule {
            var_name: "x".into(),
            source: "unknown".into(),
            expression: String::new(),
        }];
        let response = HttpResponse {
            status: 200, status_text: "OK".into(),
            headers: vec![], body: String::new(), time_ms: 0, size_bytes: 0,
        };
        let vars = extract_variables(&rules, &response);
        assert!(vars.is_empty());
    }

    #[test]
    fn test_extract_var_json_body_not_json() {
        let rules = vec![ExtractRule {
            var_name: "x".into(),
            source: "json_body".into(),
            expression: "$.id".into(),
        }];
        let response = HttpResponse {
            status: 200, status_text: "OK".into(),
            headers: vec![], body: "not json".into(), time_ms: 0, size_bytes: 0,
        };
        let vars = extract_variables(&rules, &response);
        assert!(vars.is_empty());
    }

    #[test]
    fn test_extract_var_without_dollar_prefix() {
        let rules = vec![ExtractRule {
            var_name: "name".into(),
            source: "json_body".into(),
            expression: "data.name".into(),
        }];
        let response = HttpResponse {
            status: 200, status_text: "OK".into(),
            headers: vec![], body: r#"{"data":{"name":"test"}}"#.into(),
            time_ms: 0, size_bytes: 0,
        };
        let vars = extract_variables(&rules, &response);
        assert_eq!(vars["name"], "test");
    }
}
