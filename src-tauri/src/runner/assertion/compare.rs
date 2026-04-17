use regex::RegexBuilder;
use std::cmp::Ordering;

/// 正则表达式最大长度限制（防止 ReDoS）
const MAX_REGEX_LEN: usize = 500;
/// 正则表达式编译后自动机大小限制
const REGEX_SIZE_LIMIT: usize = 1_000_000; // 1MB
/// 正则嵌套深度限制
const REGEX_NEST_LIMIT: u32 = 100;

/// 数字字面量的解析结果，保留整数语义
#[derive(Debug, Clone, Copy)]
enum NumKind {
    Int(i128),
    Float(f64),
}

/// 优先按 i128 解析，失败再回退 f64；都不是数字返回 None
fn parse_number(s: &str) -> Option<NumKind> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(i) = trimmed.parse::<i128>() {
        return Some(NumKind::Int(i));
    }
    trimmed.parse::<f64>().ok().map(NumKind::Float)
}

/// 比较两个字符串的数字值，类型不一致时按 f64 提升比较
fn compare_numeric(actual: &str, expected: &str) -> Option<Ordering> {
    let a = parse_number(actual)?;
    let b = parse_number(expected)?;
    match (a, b) {
        (NumKind::Int(a), NumKind::Int(b)) => Some(a.cmp(&b)),
        (NumKind::Float(a), NumKind::Float(b)) => a.partial_cmp(&b),
        (NumKind::Int(a), NumKind::Float(b)) => (a as f64).partial_cmp(&b),
        (NumKind::Float(a), NumKind::Int(b)) => a.partial_cmp(&(b as f64)),
    }
}

pub fn compare(actual: &str, operator: &str, expected: &str) -> bool {
    match operator {
        // eq/neq：先按字符串完全相等判定（保留 "abc" 等非数字场景）
        // 都解析成数字时再按数值比较，让 "200" 与 "200.0" 等价
        "eq" => {
            if actual == expected {
                return true;
            }
            matches!(compare_numeric(actual, expected), Some(Ordering::Equal))
        }
        "neq" => {
            if actual == expected {
                return false;
            }
            !matches!(compare_numeric(actual, expected), Some(Ordering::Equal))
        }
        "contains" => actual.contains(expected),
        "not_contains" => !actual.contains(expected),
        "exists" => !actual.is_empty(),
        "not_exists" => actual.is_empty(),
        "matches" => match_regex_safe(actual, expected),
        "gt" | "lt" | "gte" | "lte" => match compare_numeric(actual, expected) {
            Some(ord) => match operator {
                "gt" => ord == Ordering::Greater,
                "lt" => ord == Ordering::Less,
                "gte" => ord != Ordering::Less,
                "lte" => ord != Ordering::Greater,
                _ => false,
            },
            None => false,
        },
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

    #[test]
    fn test_eq_numeric_equivalence() {
        // 整数与浮点字面量等价
        assert!(compare("200", "eq", "200.0"));
        assert!(compare("200.0", "eq", "200"));
        assert!(compare("0", "eq", "-0"));
        // 实际不等的数值仍然 false
        assert!(!compare("200", "eq", "201"));
    }

    #[test]
    fn test_neq_numeric_equivalence() {
        // "200" 与 "200.0" 数值相等，neq 应返回 false
        assert!(!compare("200", "neq", "200.0"));
        assert!(compare("200", "neq", "201"));
    }

    #[test]
    fn test_eq_strings_unaffected() {
        // 非数字字符串保持原 eq 语义
        assert!(compare("hello", "eq", "hello"));
        assert!(!compare("hello", "eq", "world"));
    }

    #[test]
    fn test_numeric_int_boundary() {
        // 超出 i64 但在 i128 内的数仍能精确比较
        assert!(compare("9223372036854775808", "gt", "9223372036854775807"));
    }

    #[test]
    fn test_numeric_mixed_int_float() {
        assert!(compare("1.5", "gt", "1"));
        assert!(compare("1", "lt", "1.5"));
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
