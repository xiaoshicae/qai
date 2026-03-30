use std::collections::HashMap;

use crate::models::assertion::Assertion;
use crate::models::execution::{ChainProgress, ChainResult, ChainStepResult, ExecutionResult};
use crate::models::item::{CollectionItem, ExtractRule, PollConfig};
use crate::runner::assertion::apply_assertions;

/// 按顺序执行链中的步骤，步骤间传递提取的变量，任一步骤失败则终止
pub async fn run_chain(
    client: &reqwest::Client,
    steps: Vec<(CollectionItem, Vec<Assertion>)>,
    base_vars: HashMap<String, String>,
    chain_item_id: String,
    chain_item_name: String,
    cancel_token: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
    progress_callback: impl Fn(ChainProgress) + Send + Sync + 'static,
) -> ChainResult {
    let chain_id = uuid::Uuid::new_v4().to_string();
    let total_steps = steps.len() as u32;
    let mut accumulated_vars = base_vars;
    let mut step_results: Vec<ChainStepResult> = Vec::new();
    let mut overall_status = crate::models::Status::Success.as_str().to_string();
    let start = std::time::Instant::now();

    for (i, (raw_item, assertions)) in steps.into_iter().enumerate() {
        let step_index = i as u32;
        if cancel_token.as_ref().is_some_and(|ct| ct.load(std::sync::atomic::Ordering::Relaxed)) {
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

        // 执行请求（协议感知 + 轮询）
        let result = if item.protocol == "websocket" {
            crate::websocket::client::execute(&item).await
        } else if let Some(ref poll) = poll_config {
            execute_with_poll(client, &item, poll).await
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
                    chain_id: chain_id.clone(), item_id: chain_item_id.clone(),
                    step_index, step_name: item.name.clone(), status: crate::models::Status::Error.as_str().to_string(), total_steps,
                });
                step_results.push(ChainStepResult { step_index, execution_result: err_result, extracted_variables: HashMap::new() });
                overall_status = crate::models::Status::Error.as_str().to_string();
                break;
            }
        };

        // 断言评估
        let mut result = result;
        apply_assertions(&mut result, &assertions);

        // 提取变量
        let extracted = if let Some(ref response) = result.response {
            let rules: Vec<ExtractRule> = serde_json::from_str(&raw_item.extract_rules).unwrap_or_default();
            if !rules.is_empty() {
                let new_vars = crate::http::vars::extract_variables(&rules, response);
                accumulated_vars.extend(new_vars.clone());
                new_vars
            } else {
                HashMap::new()
            }
        } else {
            HashMap::new()
        };

        let step_status = result.status.clone();

        progress_callback(ChainProgress {
            chain_id: chain_id.clone(), item_id: chain_item_id.clone(),
            step_index, step_name: item.name.clone(), status: step_status.clone(), total_steps,
        });

        step_results.push(ChainStepResult { step_index, execution_result: result, extracted_variables: extracted });

        if step_status != crate::models::Status::Success.as_str() {
            overall_status = step_status;
            break;
        }
    }

    ChainResult {
        chain_id, item_id: chain_item_id, item_name: chain_item_name, total_steps,
        completed_steps: step_results.len() as u32,
        status: overall_status,
        total_time_ms: start.elapsed().as_millis() as u64,
        steps: step_results,
        final_variables: accumulated_vars,
    }
}

/// 带轮询的请求执行
async fn execute_with_poll(
    client: &reqwest::Client,
    item: &CollectionItem,
    poll: &PollConfig,
) -> Result<ExecutionResult, anyhow::Error> {
    let start = std::time::Instant::now();
    let max_duration = std::time::Duration::from_secs(poll.max_seconds);
    let interval = std::time::Duration::from_secs(poll.interval_seconds);

    loop {
        let result = crate::http::client::execute(client, item).await?;

        if let Some(ref response) = result.response {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&response.body) {
                // 支持 JSON Path 格式（$.status）和直接 key（status）
                let extracted = crate::runner::assertion::json_path::extract_json_path(&json, &poll.field);
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

        tokio::time::sleep(interval).await;
    }
}
