use regex::RegexBuilder;

/// 正则表达式最大长度限制（防止 ReDoS）
const MAX_REGEX_LEN: usize = 500;
/// 正则表达式编译后自动机大小限制
const REGEX_SIZE_LIMIT: usize = 1_000_000; // 1MB
/// 正则嵌套深度限制
const REGEX_NEST_LIMIT: u32 = 100;

pub fn compare(actual: &str, operator: &str, expected: &str) -> bool {
    match operator {
        "eq" => actual == expected,
        "neq" => actual != expected,
        "contains" => actual.contains(expected),
        "not_contains" => !actual.contains(expected),
        "exists" => !actual.is_empty(),
        "not_exists" => actual.is_empty(),
        "matches" => match_regex_safe(actual, expected),
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

/// 安全地执行正则匹配，防止 ReDoS 攻击
fn match_regex_safe(actual: &str, pattern: &str) -> bool {
    // 长度限制：拒绝过长的正则表达式
    if pattern.len() > MAX_REGEX_LEN {
        log::warn!("正则表达式过长，已拒绝执行 (长度: {})", pattern.len());
        return false;
    }

    // 使用 RegexBuilder 设置安全限制
    match RegexBuilder::new(pattern)
        .size_limit(REGEX_SIZE_LIMIT)
        .nest_limit(REGEX_NEST_LIMIT)
        .build()
    {
        Ok(re) => re.is_match(actual),
        Err(e) => {
            log::warn!("正则表达式编译失败: {}", e);
            false
        }
    }
}

pub fn truncate_str(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        format!("{}...", s.chars().take(max_chars).collect::<String>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── eq / neq ───────────────────────────────────────────
    #[test]
    fn test_eq_same() {
        assert!(compare("200", "eq", "200"));
    }

    #[test]
    fn test_eq_different() {
        assert!(!compare("200", "eq", "201"));
    }

    #[test]
    fn test_neq() {
        assert!(compare("200", "neq", "404"));
        assert!(!compare("200", "neq", "200"));
    }

    // ─── contains / not_contains ────────────────────────────
    #[test]
    fn test_contains() {
        assert!(compare("hello world", "contains", "world"));
        assert!(!compare("hello", "contains", "xyz"));
    }

    #[test]
    fn test_contains_empty_expected() {
        assert!(compare("anything", "contains", ""));
    }

    #[test]
    fn test_not_contains() {
        assert!(compare("hello", "not_contains", "xyz"));
        assert!(!compare("hello", "not_contains", "ell"));
    }

    // ─── exists / not_exists ────────────────────────────────
    #[test]
    fn test_exists() {
        assert!(compare("something", "exists", ""));
        assert!(!compare("", "exists", ""));
    }

    #[test]
    fn test_not_exists() {
        assert!(compare("", "not_exists", ""));
        assert!(!compare("value", "not_exists", ""));
    }

    // ─── numeric: gt / lt / gte / lte ───────────────────────
    #[test]
    fn test_gt() {
        assert!(compare("5", "gt", "3"));
        assert!(!compare("3", "gt", "5"));
        assert!(!compare("5", "gt", "5"));
    }

    #[test]
    fn test_lt() {
        assert!(compare("3", "lt", "5"));
        assert!(!compare("5", "lt", "3"));
    }

    #[test]
    fn test_gte_lte() {
        assert!(compare("5", "gte", "5"));
        assert!(compare("5", "lte", "5"));
        assert!(compare("6", "gte", "5"));
        assert!(compare("4", "lte", "5"));
    }

    #[test]
    fn test_numeric_float() {
        assert!(compare("3.14", "gt", "2.71"));
        assert!(compare("0.001", "lt", "0.01"));
    }

    #[test]
    fn test_numeric_negative() {
        assert!(compare("-1", "lt", "0"));
        assert!(compare("0", "gt", "-100"));
    }

    #[test]
    fn test_numeric_non_parseable() {
        assert!(!compare("abc", "gt", "3"));
        assert!(!compare("5", "gt", "xyz"));
    }

    #[test]
    fn test_numeric_large_values() {
        assert!(compare("999999999999", "gt", "1"));
    }

    // ─── matches (regex) ────────────────────────────────────
    #[test]
    fn test_matches_valid() {
        assert!(compare("abc123", "matches", "^abc\\d+$"));
        assert!(!compare("xyz", "matches", "^abc"));
    }

    #[test]
    fn test_matches_invalid_regex() {
        assert!(!compare("test", "matches", "[invalid"));
    }

    #[test]
    fn test_matches_redos_protection() {
        let long_pattern = "a".repeat(MAX_REGEX_LEN + 1);
        assert!(!compare("aaa", "matches", &long_pattern));
    }

    // ─── unknown operator ───────────────────────────────────
    #[test]
    fn test_unknown_operator_falls_back_to_eq() {
        assert!(compare("hello", "unknown_op", "hello"));
        assert!(!compare("hello", "unknown_op", "world"));
    }

    // ─── truncate_str ───────────────────────────────────────
    #[test]
    fn test_truncate_short_string() {
        assert_eq!(truncate_str("hi", 10), "hi");
    }

    #[test]
    fn test_truncate_long_string() {
        assert_eq!(truncate_str("hello world", 5), "hello...");
    }

    #[test]
    fn test_truncate_exact_boundary() {
        assert_eq!(truncate_str("abc", 3), "abc");
    }

    #[test]
    fn test_truncate_multibyte_utf8() {
        let s = "你好世界测试";
        let result = truncate_str(s, 3);
        assert_eq!(result, "你好世...");
    }

    #[test]
    fn test_truncate_empty() {
        assert_eq!(truncate_str("", 5), "");
    }
}
