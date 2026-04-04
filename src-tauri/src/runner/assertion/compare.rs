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
