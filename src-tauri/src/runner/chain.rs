use std::collections::HashMap;

use crate::models::assertion::Assertion;
use crate::models::execution::{ChainProgress, ChainResult, ChainStepResult, ExecutionResult};
use crate::models::request::{ApiRequest, ExtractRule, PollConfig};
use crate::runner::assertion::evaluate_assertions;

/// 按顺序执行链中的步骤，步骤间传递提取的变量，任一步骤失败则终止
pub async fn run_chain(
    client: &reqwest::Client,
    steps: Vec<(ApiRequest, Vec<Assertion>)>,
    base_vars: HashMap<String, String>,
    folder_id: String,
    folder_name: String,
    progress_callback: impl Fn(ChainProgress) + Send + Sync + 'static,
) -> ChainResult {
    let chain_id = uuid::Uuid::new_v4().to_string();
    let total_steps = steps.len() as u32;
    let mut accumulated_vars = base_vars;
    let mut step_results: Vec<ChainStepResult> = Vec::new();
    let mut overall_status = "success".to_string();
    let mut total_time: u64 = 0;

    for (i, (raw_req, assertions)) in steps.into_iter().enumerate() {
        let step_index = i as u32;

        progress_callback(ChainProgress {
            chain_id: chain_id.clone(),
            folder_id: folder_id.clone(),
            step_index,
            step_name: raw_req.name.clone(),
            status: "running".to_string(),
            total_steps,
        });

        // 变量替换
        let req = crate::http::vars::apply_vars(&raw_req, &accumulated_vars);

        // 检查是否有轮询配置
        let poll_config: Option<PollConfig> = if !raw_req.poll_config.is_empty() {
            serde_json::from_str(&raw_req.poll_config).ok()
        } else {
            None
        };

        // 执行请求（含轮询）
        let result = if let Some(ref poll) = poll_config {
            execute_with_poll(client, &req, poll).await
        } else {
            execute_once(client, &req).await
        };

        // 处理执行错误
        let result = match result {
            Ok(r) => r,
            Err(e) => {
                let err_result = ExecutionResult {
                    execution_id: uuid::Uuid::new_v4().to_string(),
                    request_id: req.id.clone(),
                    request_name: req.name.clone(),
                    status: "error".to_string(),
                    response: None,
                    assertion_results: vec![],
                    error_message: Some(e.to_string()),
                };
                progress_callback(ChainProgress {
                    chain_id: chain_id.clone(), folder_id: folder_id.clone(),
                    step_index, step_name: req.name.clone(), status: "error".to_string(), total_steps,
                });
                step_results.push(ChainStepResult { step_index, execution_result: err_result, extracted_variables: HashMap::new() });
                overall_status = "error".to_string();
                break;
            }
        };

        // 断言评估
        let mut result = result;
        if let Some(ref response) = result.response {
            if !assertions.is_empty() {
                result.assertion_results = evaluate_assertions(&assertions, response);
                if result.assertion_results.iter().any(|a| !a.passed) {
                    result.status = "failed".to_string();
                }
            }
        }

        // 记录耗时
        if let Some(ref response) = result.response {
            total_time += response.time_ms;
        }

        // 提取变量
        let extracted = if let Some(ref response) = result.response {
            let rules: Vec<ExtractRule> = serde_json::from_str(&raw_req.extract_rules).unwrap_or_default();
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
            chain_id: chain_id.clone(), folder_id: folder_id.clone(),
            step_index, step_name: req.name.clone(), status: step_status.clone(), total_steps,
        });

        step_results.push(ChainStepResult { step_index, execution_result: result, extracted_variables: extracted });

        if step_status != "success" {
            overall_status = step_status;
            break;
        }
    }

    ChainResult {
        chain_id, folder_id, folder_name, total_steps,
        completed_steps: step_results.len() as u32,
        status: overall_status,
        total_time_ms: total_time,
        steps: step_results,
        final_variables: accumulated_vars,
    }
}

/// 执行一次请求
async fn execute_once(client: &reqwest::Client, req: &ApiRequest) -> Result<ExecutionResult, anyhow::Error> {
    crate::http::client::execute(client, req).await
}

/// 带轮询的请求执行：反复请求直到 JSON 字段达到目标值
async fn execute_with_poll(
    client: &reqwest::Client,
    req: &ApiRequest,
    poll: &PollConfig,
) -> Result<ExecutionResult, anyhow::Error> {
    let start = std::time::Instant::now();
    let max_duration = std::time::Duration::from_secs(poll.max_seconds);
    let interval = std::time::Duration::from_secs(poll.interval_seconds);

    loop {
        let result = crate::http::client::execute(client, req).await?;

        // 检查轮询条件
        if let Some(ref response) = result.response {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&response.body) {
                if let Some(val) = json.get(&poll.field) {
                    let val_str = match val {
                        serde_json::Value::String(s) => s.clone(),
                        other => other.to_string(),
                    };
                    log::info!("[poll] {}: {} = {} (target: {})", req.name, poll.field, val_str, poll.target);
                    if val_str == poll.target {
                        return Ok(result);
                    }
                }
            }
        }

        // 超时检查
        if start.elapsed() >= max_duration {
            log::warn!("[poll] {} timeout after {}s", req.name, poll.max_seconds);
            // 返回最后一次结果，但标记为 error
            let mut result = result;
            result.error_message = Some(format!(
                "轮询超时: {} 未在 {}s 内达到 {} = {}",
                req.name, poll.max_seconds, poll.field, poll.target
            ));
            return Ok(result);
        }

        tokio::time::sleep(interval).await;
    }
}
