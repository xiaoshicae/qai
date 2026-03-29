use regex::Regex;

pub fn compare(actual: &str, operator: &str, expected: &str) -> bool {
    match operator {
        "eq" => actual == expected,
        "neq" => actual != expected,
        "contains" => actual.contains(expected),
        "not_contains" => !actual.contains(expected),
        "exists" => !actual.is_empty(),
        "not_exists" => actual.is_empty(),
        "matches" => Regex::new(expected).map(|re| re.is_match(actual)).unwrap_or(false),
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

pub fn truncate_str(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        format!("{}...", s.chars().take(max_chars).collect::<String>())
    }
}
