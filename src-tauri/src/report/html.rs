use crate::runner::batch::BatchResult;

pub fn generate_html_report(result: &BatchResult) -> String {
    let pass_rate = if result.total > 0 {
        (result.passed as f64 / result.total as f64) * 100.0
    } else {
        0.0
    };

    let mut rows = String::new();
    for (i, r) in result.results.iter().enumerate() {
        let status_class = match r.status.as_str() {
            "success" => "pass",
            "failed" => "fail",
            _ => "error",
        };
        let status_label = match r.status.as_str() {
            "success" => "PASS",
            "failed" => "FAIL",
            _ => "ERROR",
        };
        let time = r.response.as_ref().map(|resp| resp.time_ms).unwrap_or(0);
        let status_code = r.response.as_ref().map(|resp| resp.status.to_string()).unwrap_or_else(|| "-".to_string());
        let error_msg = r.error_message.as_deref().unwrap_or("");

        let assertion_details: String = r.assertion_results.iter().map(|a| {
            let icon = if a.passed { "&#10004;" } else { "&#10008;" };
            let cls = if a.passed { "pass" } else { "fail" };
            format!(
                "<div class=\"assertion {cls}\"><span>{icon}</span> {msg}</div>",
                cls = cls,
                icon = icon,
                msg = html_escape(&a.message),
            )
        }).collect::<Vec<_>>().join("\n");

        rows.push_str(&format!(
            r#"<tr class="{status_class}">
  <td>{index}</td>
  <td>{exec_id}</td>
  <td>{status_code}</td>
  <td><span class="badge {status_class}">{status_label}</span></td>
  <td>{time}ms</td>
  <td>{assertions}{error}</td>
</tr>"#,
            status_class = status_class,
            index = i + 1,
            exec_id = &r.execution_id[..8],
            status_code = status_code,
            status_label = status_label,
            time = time,
            assertions = assertion_details,
            error = if error_msg.is_empty() { String::new() } else { format!("<div class=\"error-msg\">{}</div>", html_escape(error_msg)) },
        ));
    }

    format!(
        r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>QAI 测试报告</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ font-family: -apple-system, sans-serif; background: #1a1a2e; color: #e0e0e0; padding: 24px; }}
  .header {{ text-align: center; margin-bottom: 32px; }}
  .header h1 {{ font-size: 24px; color: #fff; }}
  .header .time {{ color: #888; font-size: 13px; margin-top: 4px; }}
  .summary {{ display: flex; gap: 16px; justify-content: center; margin-bottom: 32px; }}
  .stat {{ background: #16213e; border-radius: 8px; padding: 16px 24px; text-align: center; min-width: 120px; }}
  .stat .number {{ font-size: 28px; font-weight: bold; }}
  .stat .label {{ font-size: 12px; color: #888; margin-top: 4px; }}
  .stat.total .number {{ color: #1890ff; }}
  .stat.passed .number {{ color: #52c41a; }}
  .stat.failed .number {{ color: #f5222d; }}
  .stat.rate .number {{ color: #faad14; }}
  table {{ width: 100%; border-collapse: collapse; background: #16213e; border-radius: 8px; overflow: hidden; }}
  th {{ background: #0f3460; padding: 12px; text-align: left; font-size: 13px; color: #aaa; }}
  td {{ padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 13px; }}
  .badge {{ padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }}
  .badge.pass {{ background: #52c41a22; color: #52c41a; }}
  .badge.fail {{ background: #f5222d22; color: #f5222d; }}
  .badge.error {{ background: #faad1422; color: #faad14; }}
  .assertion {{ font-size: 12px; padding: 2px 0; }}
  .assertion.pass {{ color: #52c41a; }}
  .assertion.fail {{ color: #f5222d; }}
  .error-msg {{ color: #faad14; font-size: 12px; margin-top: 4px; }}
</style>
</head>
<body>
<div class="header">
  <h1>QAI 测试报告</h1>
  <div class="time">生成时间: {timestamp}</div>
</div>
<div class="summary">
  <div class="stat total"><div class="number">{total}</div><div class="label">总计</div></div>
  <div class="stat passed"><div class="number">{passed}</div><div class="label">通过</div></div>
  <div class="stat failed"><div class="number">{failed}</div><div class="label">失败</div></div>
  <div class="stat rate"><div class="number">{pass_rate:.1}%</div><div class="label">通过率</div></div>
</div>
<table>
  <thead>
    <tr><th>#</th><th>ID</th><th>状态码</th><th>结果</th><th>耗时</th><th>详情</th></tr>
  </thead>
  <tbody>
    {rows}
  </tbody>
</table>
</body>
</html>"#,
        timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
        total = result.total,
        passed = result.passed,
        failed = result.failed,
        pass_rate = pass_rate,
        rows = rows,
    )
}

pub(crate) fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::assertion::AssertionResult;
    use crate::models::execution::ExecutionResult;
    use crate::models::item::HttpResponse;

    #[test]
    fn test_html_escape_ampersand() {
        assert_eq!(html_escape("a & b"), "a &amp; b");
    }

    #[test]
    fn test_html_escape_lt_gt() {
        assert_eq!(html_escape("<script>"), "&lt;script&gt;");
    }

    #[test]
    fn test_html_escape_quotes() {
        assert_eq!(html_escape(r#""hello""#), "&quot;hello&quot;");
    }

    #[test]
    fn test_html_escape_no_change() {
        assert_eq!(html_escape("plain text"), "plain text");
    }

    #[test]
    fn test_html_escape_combined() {
        assert_eq!(html_escape(r#"<a href="x">&"#), "&lt;a href=&quot;x&quot;&gt;&amp;");
    }

    fn make_exec_result(status: &str, resp_status: u16, time_ms: u64) -> ExecutionResult {
        ExecutionResult {
            execution_id: "12345678-abcd".into(),
            item_id: "i1".into(),
            item_name: "test".into(),
            status: status.into(),
            response: Some(HttpResponse {
                status: resp_status,
                status_text: "OK".into(),
                headers: vec![],
                body: String::new(),
                time_ms,
                size_bytes: 0,
            }),
            assertion_results: vec![],
            error_message: None,
        }
    }

    #[test]
    fn test_report_empty_results() {
        let batch = BatchResult {
            batch_id: "b1".into(),
            total: 0, passed: 0, failed: 0, errors: 0,
            total_time_ms: 0, results: vec![],
        };
        let html = generate_html_report(&batch);
        assert!(html.contains("0.0%"));
        assert!(html.contains("<!DOCTYPE html>"));
    }

    #[test]
    fn test_report_all_pass() {
        let batch = BatchResult {
            batch_id: "b1".into(),
            total: 2, passed: 2, failed: 0, errors: 0,
            total_time_ms: 100,
            results: vec![
                make_exec_result("success", 200, 50),
                make_exec_result("success", 200, 50),
            ],
        };
        let html = generate_html_report(&batch);
        assert!(html.contains("100.0%"));
    }

    #[test]
    fn test_report_mixed_results() {
        let batch = BatchResult {
            batch_id: "b1".into(),
            total: 3, passed: 2, failed: 1, errors: 0,
            total_time_ms: 150,
            results: vec![
                make_exec_result("success", 200, 50),
                make_exec_result("success", 200, 50),
                make_exec_result("failed", 404, 50),
            ],
        };
        let html = generate_html_report(&batch);
        assert!(html.contains("66.7%"));
    }

    #[test]
    fn test_report_contains_structure() {
        let batch = BatchResult {
            batch_id: "b1".into(),
            total: 1, passed: 1, failed: 0, errors: 0,
            total_time_ms: 50,
            results: vec![make_exec_result("success", 200, 50)],
        };
        let html = generate_html_report(&batch);
        assert!(html.contains("<!DOCTYPE html>"));
        assert!(html.contains("<table>"));
        assert!(html.contains("<thead>"));
        assert!(html.contains("QAI 测试报告"));
    }

    #[test]
    fn test_report_escapes_error_message() {
        let mut result = make_exec_result("error", 500, 0);
        result.error_message = Some("<script>alert('xss')</script>".into());
        let batch = BatchResult {
            batch_id: "b1".into(),
            total: 1, passed: 0, failed: 0, errors: 1,
            total_time_ms: 0,
            results: vec![result],
        };
        let html = generate_html_report(&batch);
        assert!(html.contains("&lt;script&gt;"));
        assert!(!html.contains("<script>alert"));
    }

    #[test]
    fn test_report_with_assertions() {
        let mut result = make_exec_result("success", 200, 50);
        result.assertion_results = vec![
            AssertionResult {
                assertion_id: "a1".into(),
                passed: true,
                actual: "200".into(),
                message: "状态码 200 eq 200".into(),
            },
            AssertionResult {
                assertion_id: "a2".into(),
                passed: false,
                actual: "{}".into(),
                message: "路径 $.id 未找到".into(),
            },
        ];
        let batch = BatchResult {
            batch_id: "b1".into(),
            total: 1, passed: 0, failed: 1, errors: 0,
            total_time_ms: 50,
            results: vec![result],
        };
        let html = generate_html_report(&batch);
        assert!(html.contains("&#10004;"));
        assert!(html.contains("&#10008;"));
    }
}
