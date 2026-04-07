use crate::models::item::KeyValuePair;

/// 从 reqwest HeaderMap 提取为 KeyValuePair 列表
pub fn extract_headers(headers: &reqwest::header::HeaderMap) -> Vec<KeyValuePair> {
    headers
        .iter()
        .map(|(k, v)| KeyValuePair {
            key: k.to_string(),
            value: v.to_str().unwrap_or("").to_string(),
            enabled: true,
            field_type: String::new(),
        })
        .collect()
}

/// 判断 HTTP 状态码是否成功（支持 expect_status 自定义期望）
pub fn is_success_status(status: u16, expect_status: u16) -> bool {
    if expect_status > 0 {
        status == expect_status
    } else {
        (200..400).contains(&status)
    }
}

/// 根据成功/失败返回状态字符串
pub fn status_string(success: bool) -> String {
    if success {
        crate::models::Status::Success
    } else {
        crate::models::Status::Failed
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_success_default_range() {
        assert!(is_success_status(200, 0));
        assert!(is_success_status(301, 0));
        assert!(!is_success_status(400, 0));
        assert!(!is_success_status(500, 0));
    }

    #[test]
    fn test_is_success_custom_expect() {
        assert!(is_success_status(201, 201));
        assert!(!is_success_status(200, 201));
        assert!(is_success_status(404, 404));
    }

    #[test]
    fn test_status_string() {
        assert_eq!(status_string(true), "success");
        assert_eq!(status_string(false), "failed");
    }

    #[test]
    fn test_extract_headers() {
        let mut map = reqwest::header::HeaderMap::new();
        map.insert("content-type", "application/json".parse().unwrap());
        map.insert("x-custom", "value".parse().unwrap());
        let result = extract_headers(&map);
        assert_eq!(result.len(), 2);
        assert!(result
            .iter()
            .any(|h| h.key == "content-type" && h.value == "application/json"));
        assert!(result.iter().all(|h| h.enabled));
    }
}
