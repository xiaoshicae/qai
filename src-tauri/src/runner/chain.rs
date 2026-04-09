use std::collections::HashMap;

use crate::models::assertion::Assertion;
use crate::models::execution::{ChainProgress, ChainResult, ChainStepResult, ExecutionResult};
use crate::models::item::{CollectionItem, ExtractRule, PollConfig};
use crate::runner::assertion::apply_assertions;

/// 按顺序执行链中的步骤，步骤间传递提取的变量，任一步骤失败则终止
#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub async fn run_chain(
    client: &reqwest::Client,
    steps: Vec<(CollectionItem, Vec<Assertion>)>,
    base_vars: HashMap<String, String>,
    chain_item_id: String,
    chain_item_name: String,
    cancel_token: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
    progress_callback: impl Fn(ChainProgress) + Send + Sync + 'static,
    on_result: Option<Box<dyn Fn(&ExecutionResult) + Send + Sync + 'static>>,
    dry_run: bool,
) -> ChainResult {
    let chain_id = uuid::Uuid::new_v4().to_string();
    let total_steps = steps.len() as u32;
    let mut accumulated_vars = base_vars;
    let mut step_results: Vec<ChainStepResult> = Vec::new();
    let mut overall_status = crate::models::Status::Success.as_str().to_string();
    let start = std::time::Instant::now();

    for (i, (raw_item, assertions)) in steps.into_iter().enumerate() {
        let step_index = i as u32;
        if cancel_token
            .as_ref()
            .is_some_and(|ct| ct.load(std::sync::atomic::Ordering::Relaxed))
        {
            break;
        }

        progress_callback(ChainProgress {
            chain_id: chain_id.clone(),
            item_id: chain_item_id.clone(),
            step_index,
            step_name: raw_item.name.clone(),
            status: crate::models::Status::Running.as_str().to_string(),
            total_steps,
        });

        // 变量替换
        let item = crate::http::vars::apply_vars(&raw_item, &accumulated_vars);

        // 检查是否有轮询配置
        let poll_config: Option<PollConfig> = if !raw_item.poll_config.is_empty() {
            serde_json::from_str(&raw_item.poll_config).ok()
        } else {
            None
        };

        // 执行请求（dry-run / 协议感知 + 轮询）
        let result = if dry_run {
            Ok(crate::http::client::mock_execute(&item).await)
        } else if item.protocol == "websocket" {
            crate::websocket::client::execute(&item).await
        } else if let Some(ref poll) = poll_config {
            execute_with_poll(client, &item, poll, cancel_token.as_ref()).await
        } else {
            crate::http::client::execute(client, &item).await
        };

        // 处理执行错误
        let result = match result {
            Ok(r) => r,
            Err(e) => {
                let err_result = ExecutionResult {
                    execution_id: uuid::Uuid::new_v4().to_string(),
                    item_id: item.id.clone(),
                    item_name: item.name.clone(),
                    request_url: item.url.clone(),
                    request_method: item.method.clone(),
                    status: crate::models::Status::Error.as_str().to_string(),
                    response: None,
                    assertion_results: vec![],
                    error_message: Some(e.to_string()),
                };
                progress_callback(ChainProgress {
                    chain_id: chain_id.clone(),
                    item_id: chain_item_id.clone(),
                    step_index,
                    step_name: item.name.clone(),
                    status: crate::models::Status::Error.as_str().to_string(),
                    total_steps,
                });
                step_results.push(ChainStepResult {
                    step_index,
                    execution_result: err_result,
                    extracted_variables: HashMap::new(),
                });
                overall_status = crate::models::Status::Error.as_str().to_string();
                break;
            }
        };

        // 断言评估
        let mut result = result;
        apply_assertions(&mut result, &assertions);
        if let Some(ref cb) = on_result {
            cb(&result);
        }

        // 提取变量
        let extracted = if let Some(ref response) = result.response {
            let rules: Vec<ExtractRule> =
                serde_json::from_str(&raw_item.extract_rules).unwrap_or_default();
            if !rules.is_empty() {
                let new_vars = crate::http::vars::extract_variables(&rules, response);
                log::info!(
                    "[chain] step {} '{}' extracted {} vars: {:?}",
                    step_index,
                    raw_item.name,
                    new_vars.len(),
                    new_vars.keys().collect::<Vec<_>>()
                );
                accumulated_vars.extend(new_vars.clone());
                new_vars
            } else {
                log::info!(
                    "[chain] step {} '{}' has no extract_rules",
                    step_index,
                    raw_item.name
                );
                HashMap::new()
            }
        } else {
            HashMap::new()
        };

        let step_status = result.status.clone();
        log::info!(
            "[chain] step {} '{}' status={}, url={}",
            step_index,
            item.name,
            step_status,
            item.url
        );

        progress_callback(ChainProgress {
            chain_id: chain_id.clone(),
            item_id: chain_item_id.clone(),
            step_index,
            step_name: item.name.clone(),
            status: step_status.clone(),
            total_steps,
        });

        step_results.push(ChainStepResult {
            step_index,
            execution_result: result,
            extracted_variables: extracted,
        });

        if step_status != crate::models::Status::Success.as_str() {
            log::info!(
                "[chain] step {} failed with '{}', breaking chain",
                step_index,
                step_status
            );
            overall_status = step_status;
            break;
        }
    }

    ChainResult {
        chain_id,
        item_id: chain_item_id,
        item_name: chain_item_name,
        total_steps,
        completed_steps: step_results.len() as u32,
        status: overall_status,
        total_time_ms: start.elapsed().as_millis() as u64,
        steps: step_results,
        final_variables: accumulated_vars,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::Arc;

    fn make_item(id: &str, name: &str) -> CollectionItem {
        CollectionItem {
            id: id.into(),
            collection_id: "coll-1".into(),
            parent_id: None,
            item_type: "request".into(),
            name: name.into(),
            sort_order: 0,
            method: "GET".into(),
            url: "http://example.com".into(),
            headers: "[]".into(),
            query_params: "[]".into(),
            body_type: "none".into(),
            body_content: String::new(),
            extract_rules: "[]".into(),
            description: String::new(),
            expect_status: 200,
            poll_config: String::new(),
            protocol: "http".into(),
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    fn noop_progress(_: ChainProgress) {}

    #[tokio::test]
    async fn test_single_step_dry_run() {
        let client = reqwest::Client::new();
        let steps = vec![(make_item("1", "Step1"), vec![])];
        let result = run_chain(
            &client, steps, HashMap::new(),
            "chain-1".into(), "TestChain".into(),
            None, noop_progress, None, true,
        ).await;
        assert_eq!(result.completed_steps, 1);
        assert_eq!(result.total_steps, 1);
        assert_eq!(result.status, crate::models::Status::Success.as_str());
    }

    #[tokio::test]
    async fn test_multi_step_dry_run() {
        let client = reqwest::Client::new();
        let steps = vec![
            (make_item("1", "Step1"), vec![]),
            (make_item("2", "Step2"), vec![]),
            (make_item("3", "Step3"), vec![]),
        ];
        let result = run_chain(
            &client, steps, HashMap::new(),
            "chain-1".into(), "TestChain".into(),
            None, noop_progress, None, true,
        ).await;
        assert_eq!(result.completed_steps, 3);
        assert_eq!(result.total_steps, 3);
    }

    #[tokio::test]
    async fn test_empty_steps() {
        let client = reqwest::Client::new();
        let result = run_chain(
            &client, vec![], HashMap::new(),
            "chain-1".into(), "TestChain".into(),
            None, noop_progress, None, true,
        ).await;
        assert_eq!(result.completed_steps, 0);
        assert_eq!(result.total_steps, 0);
    }

    #[tokio::test]
    async fn test_base_vars_passed_to_chain() {
        let client = reqwest::Client::new();
        let mut base = HashMap::new();
        base.insert("token".into(), "abc123".into());
        let steps = vec![(make_item("1", "Step1"), vec![])];
        let result = run_chain(
            &client, steps, base,
            "chain-1".into(), "TestChain".into(),
            None, noop_progress, None, true,
        ).await;
        assert_eq!(result.final_variables.get("token").unwrap(), "abc123");
    }

    #[tokio::test]
    async fn test_cancel_token_stops_chain() {
        let client = reqwest::Client::new();
        let steps = vec![
            (make_item("1", "Step1"), vec![]),
            (make_item("2", "Step2"), vec![]),
        ];
        let cancel = Arc::new(AtomicBool::new(true));
        let result = run_chain(
            &client, steps, HashMap::new(),
            "chain-1".into(), "TestChain".into(),
            Some(cancel), noop_progress, None, true,
        ).await;
        assert_eq!(result.completed_steps, 0);
    }

    #[tokio::test]
    async fn test_progress_callback_called() {
        let client = reqwest::Client::new();
        let steps = vec![(make_item("1", "Step1"), vec![])];
        let count = Arc::new(AtomicU32::new(0));
        let count_clone = count.clone();
        run_chain(
            &client, steps, HashMap::new(),
            "chain-1".into(), "TestChain".into(),
            None,
            move |_| { count_clone.fetch_add(1, Ordering::Relaxed); },
            None, true,
        ).await;
        // 每步 2 次进度回调：running + completed
        assert_eq!(count.load(Ordering::Relaxed), 2);
    }

    #[tokio::test]
    async fn test_step_failure_stops_chain() {
        let client = reqwest::Client::new();
        // 第一步断言失败 → 后续不执行
        let assertion = crate::models::assertion::Assertion {
            id: "a1".into(),
            item_id: "1".into(),
            assertion_type: "status_code".into(),
            expression: String::new(),
            operator: "eq".into(),
            expected: "404".into(), // dry_run 返回 200，断言失败
            enabled: true,
            sort_order: 0,
            created_at: String::new(),
        };
        let steps = vec![
            (make_item("1", "Step1"), vec![assertion]),
            (make_item("2", "Step2"), vec![]),
        ];
        let result = run_chain(
            &client, steps, HashMap::new(),
            "chain-1".into(), "TestChain".into(),
            None, noop_progress, None, true,
        ).await;
        assert_eq!(result.completed_steps, 1);
        assert_ne!(result.status, crate::models::Status::Success.as_str());
    }

    #[tokio::test]
    async fn test_on_result_callback() {
        let client = reqwest::Client::new();
        let steps = vec![
            (make_item("1", "Step1"), vec![]),
            (make_item("2", "Step2"), vec![]),
        ];
        let count = Arc::new(AtomicU32::new(0));
        let count_clone = count.clone();
        run_chain(
            &client, steps, HashMap::new(),
            "chain-1".into(), "TestChain".into(),
            None, noop_progress,
            Some(Box::new(move |_| { count_clone.fetch_add(1, Ordering::Relaxed); })),
            true,
        ).await;
        assert_eq!(count.load(Ordering::Relaxed), 2);
    }
}

/// 带轮询的请求执行（支持取消）
/// 使用 tokio::time::interval 避免间隔漂移（固定节拍，扣除请求耗时）
async fn execute_with_poll(
    client: &reqwest::Client,
    item: &CollectionItem,
    poll: &PollConfig,
    cancel_token: Option<&std::sync::Arc<std::sync::atomic::AtomicBool>>,
) -> Result<ExecutionResult, anyhow::Error> {
    let start = std::time::Instant::now();
    let max_duration = std::time::Duration::from_secs(poll.max_seconds);
    let interval_dur = std::time::Duration::from_secs(poll.interval_seconds);
    let mut ticker = tokio::time::interval(interval_dur);
    // 第一次 tick 立即触发（执行首次请求）
    ticker.tick().await;

    loop {
        if cancel_token
            .as_ref()
            .is_some_and(|ct| ct.load(std::sync::atomic::Ordering::Relaxed))
        {
            return Ok(ExecutionResult {
                execution_id: uuid::Uuid::new_v4().to_string(),
                item_id: item.id.clone(),
                item_name: item.name.clone(),
                request_url: item.url.clone(),
                request_method: item.method.clone(),
                status: crate::models::Status::Error.as_str().to_string(),
                response: None,
                assertion_results: vec![],
                error_message: Some("轮询已取消".to_string()),
            });
        }

        let result = crate::http::client::execute(client, item).await?;

        if let Some(ref response) = result.response {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&response.body) {
                let extracted =
                    crate::runner::assertion::json_path::extract_json_path(&json, &poll.field);
                if let Some(val) = extracted {
                    let val_str = crate::runner::assertion::json_path::value_to_string(&val);
                    if val_str == poll.target {
                        return Ok(result);
                    }
                }
            }
        }

        if start.elapsed() >= max_duration {
            let mut result = result;
            result.status = crate::models::Status::Failed.as_str().to_string();
            result.error_message = Some(format!(
                "轮询超时: {} 未在 {}s 内达到 {} = {}",
                item.name, poll.max_seconds, poll.field, poll.target
            ));
            return Ok(result);
        }

        // 等待下一个 tick（自动补偿请求耗时）
        ticker.tick().await;
    }
}
