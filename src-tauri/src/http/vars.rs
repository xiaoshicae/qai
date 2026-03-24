use std::collections::HashMap;
use regex::Regex;

use crate::models::environment::EnvVariable;
use crate::models::request::{ApiRequest, KeyValuePair};

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

pub fn apply_vars(req: &ApiRequest, vars: &HashMap<String, String>) -> ApiRequest {
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
