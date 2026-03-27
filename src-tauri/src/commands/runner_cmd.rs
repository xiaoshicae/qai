use tauri::{AppHandle, Emitter, State};

use crate::db::init::{DbState, HttpClient};
use crate::models::execution::ChainResult;
use crate::runner::batch::{self, BatchResult};

#[tauri::command]
pub async fn run_collection(
    app: AppHandle,
    db: State<'_, DbState>,
    http: State<'_, HttpClient>,
    collection_id: String,
    parent_id: Option<String>,
    concurrency: Option<usize>,
) -> Result<BatchResult, String> {
    // 分离：chain 类型 item 内的子请求用链式执行，其余并行
    let (normal_items, chain_groups, var_map) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;

        // 获取所有 items
        let all_items = if let Some(ref pid) = parent_id {
            crate::db::item::list_by_parent(&conn, pid)
                .map_err(|e| e.to_string())?
        } else {
            crate::db::item::list_by_collection(&conn, &collection_id)
                .map_err(|e| e.to_string())?
        };

        let var_map = if let Ok(Some(env)) = crate::db::environment::get_active(&conn) {
            crate::http::vars::build_var_map(&env.variables)
        } else {
            std::collections::HashMap::new()
        };

        // 区分 chain 容器和普通 request
        let chain_item_ids: std::collections::HashSet<String> = all_items
            .iter()
            .filter(|i| i.item_type == "chain")
            .map(|i| i.id.clone())
            .collect();

        let mut normal = Vec::new();
        let mut chains: std::collections::HashMap<String, Vec<_>> = std::collections::HashMap::new();

        // 收集顶层 request（无 parent 或 parent 不是 chain）
        for item in &all_items {
            if item.item_type == "request" {
                let assertions = crate::db::assertion::list_by_item(&conn, &item.id)
                    .map_err(|e| e.to_string())?;
                if item.url.is_empty() {
                    continue;
                }
                if let Some(ref pid) = item.parent_id {
                    if chain_item_ids.contains(pid) {
                        chains.entry(pid.clone()).or_default().push((item.clone(), assertions));
                        continue;
                    }
                }
                let item = crate::http::vars::apply_vars(item, &var_map);
                normal.push((item, assertions));
            }
        }

        // 对于 chain 容器，获取其子请求
        for chain_id in &chain_item_ids {
            if !chains.contains_key(chain_id) {
                // 如果 chain 下的子 items 还没被遍历到（可能是嵌套），手动获取
                let children = crate::db::item::list_by_parent(&conn, chain_id)
                    .map_err(|e| e.to_string())?;
                for child in children {
                    if child.item_type == "request" && !child.url.is_empty() {
                        let assertions = crate::db::assertion::list_by_item(&conn, &child.id)
                            .map_err(|e| e.to_string())?;
                        chains.entry(chain_id.clone()).or_default().push((child, assertions));
                    }
                }
            }
        }

        (normal, chains, var_map)
    };

    if normal_items.is_empty() && chain_groups.is_empty() {
        return Err("没有可执行的请求".to_string());
    }

    let batch_id = uuid::Uuid::new_v4().to_string();
    let mut all_results: Vec<crate::models::execution::ExecutionResult> = Vec::new();
    let start = std::time::Instant::now();

    // 1. 先执行所有 chain groups（顺序执行每条链）
    for (chain_item_id, steps) in &chain_groups {
        let chain_result = crate::runner::chain::run_chain(
            &http.0,
            steps.clone(),
            var_map.clone(),
            chain_item_id.clone(),
            String::new(),
            |_| {},
        ).await;

        for step in chain_result.steps {
            let progress = batch::TestProgress {
                batch_id: batch_id.clone(),
                item_id: step.execution_result.item_id.clone(),
                item_name: step.execution_result.item_name.clone(),
                status: step.execution_result.status.clone(),
                current: all_results.len() as u32 + 1,
                total: (normal_items.len() + chain_groups.values().map(|v| v.len()).sum::<usize>()) as u32,
            };
            let _ = app.emit("test-progress", &progress);
            all_results.push(step.execution_result);
        }
    }

    // 2. 并行执行普通请求
    if !normal_items.is_empty() {
        let chain_done = all_results.len() as u32;
        let total = chain_done + normal_items.len() as u32;
        let app_clone = app.clone();
        let batch_id_clone = batch_id.clone();
        let normal_result = batch::run_batch(
            &http.0,
            normal_items,
            concurrency.unwrap_or(5),
            move |mut progress| {
                progress.batch_id = batch_id_clone.clone();
                progress.current += chain_done;
                progress.total = total;
                let _ = app_clone.emit("test-progress", &progress);
            },
        ).await;
        all_results.extend(normal_result.results);
    }

    let total_time = start.elapsed().as_millis() as u64;
    let passed = all_results.iter().filter(|r| r.status == "success").count() as u32;
    let failed = all_results.iter().filter(|r| r.status == "failed").count() as u32;
    let errors = all_results.iter().filter(|r| r.status == "error").count() as u32;

    let batch_result = BatchResult {
        batch_id: batch_id.clone(),
        total: all_results.len() as u32,
        passed,
        failed,
        errors,
        total_time_ms: total_time,
        results: all_results,
    };

    // 保存执行记录
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        for result in &batch_result.results {
            // 获取 item 以构建完整的 Execution
            if let Ok(item) = crate::db::item::get(&conn, &result.item_id) {
                let mut exec = crate::http::client::to_execution(&item, result);
                exec.batch_id = Some(batch_id.clone());
                let _ = crate::db::execution::save(&conn, &exec);
            }
        }
    }

    Ok(batch_result)
}

#[tauri::command]
pub async fn run_chain(
    app: AppHandle,
    db: State<'_, DbState>,
    http: State<'_, HttpClient>,
    item_id: String,
) -> Result<ChainResult, String> {
    let (steps, base_vars, item_name) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;

        let chain_item = crate::db::item::get(&conn, &item_id)
            .map_err(|e| e.to_string())?;
        if chain_item.item_type != "chain" {
            return Err("该节点不是请求链".to_string());
        }

        let children = crate::db::item::list_by_parent(&conn, &item_id)
            .map_err(|e| e.to_string())?;

        let var_map = if let Ok(Some(env)) = crate::db::environment::get_active(&conn) {
            crate::http::vars::build_var_map(&env.variables)
        } else {
            std::collections::HashMap::new()
        };

        let mut steps = Vec::new();
        for child in children {
            if child.item_type == "request" {
                let assertions = crate::db::assertion::list_by_item(&conn, &child.id)
                    .map_err(|e| e.to_string())?;
                steps.push((child, assertions));
            }
        }

        (steps, var_map, chain_item.name)
    };

    if steps.is_empty() {
        return Err("请求链中没有请求".to_string());
    }

    let app_clone = app.clone();
    let chain_result = crate::runner::chain::run_chain(
        &http.0,
        steps,
        base_vars,
        item_id,
        item_name,
        move |progress| {
            let _ = app_clone.emit("chain-progress", &progress);
        },
    )
    .await;

    // 保存每步执行记录
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        for step in &chain_result.steps {
            let result = &step.execution_result;
            if let Ok(item) = crate::db::item::get(&conn, &result.item_id) {
                let mut exec = crate::http::client::to_execution(&item, result);
                exec.batch_id = Some(chain_result.chain_id.clone());
                let _ = crate::db::execution::save(&conn, &exec);
            }
        }
    }

    Ok(chain_result)
}

#[tauri::command]
pub fn export_report_html(batch_result: BatchResult) -> Result<String, String> {
    Ok(crate::report::html::generate_html_report(&batch_result))
}

#[tauri::command]
pub fn list_history(
    db: State<'_, DbState>,
    limit: Option<u32>,
) -> Result<Vec<crate::db::execution::HistoryEntry>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::execution::list_recent(&conn, limit.unwrap_or(50)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_item_runs(
    db: State<'_, DbState>,
    item_id: String,
    limit: Option<u32>,
) -> Result<Vec<crate::db::execution::RunRecord>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::execution::list_by_item(&conn, &item_id, limit.unwrap_or(20)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_collection_status(
    db: State<'_, DbState>,
    collection_id: String,
) -> Result<Vec<crate::db::execution::ItemLastStatus>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::execution::get_last_status_for_collection(&conn, &collection_id).map_err(|e| e.to_string())
}
