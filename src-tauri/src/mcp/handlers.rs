use rusqlite::Connection;
use serde_json::{json, Value};

// ─── Collection ────────────────────────────────────────────────

pub fn list_collections(conn: &Connection) -> Result<String, String> {
    let cols = qai_lib::db::collection::list_all(conn).map_err(|e| e.to_string())?;
    ok_json(&cols)
}

pub fn get_collection(conn: &Connection, id: &str) -> Result<String, String> {
    let col = qai_lib::db::collection::get(conn, id).map_err(|e| e.to_string())?;
    let items = qai_lib::db::item::list_by_collection(conn, id).map_err(|e| e.to_string())?;
    ok_json(&json!({ "collection": col, "items": items }))
}

pub fn create_collection(conn: &Connection, name: &str, desc: Option<&str>, group_id: Option<&str>) -> Result<String, String> {
    let col = qai_lib::db::collection::create(conn, name, desc.unwrap_or(""), group_id).map_err(|e| e.to_string())?;
    ok_json(&col)
}

pub fn update_collection(conn: &Connection, id: &str, name: Option<&str>, desc: Option<&str>) -> Result<String, String> {
    let col = qai_lib::db::collection::update(conn, id, name, desc, None, None).map_err(|e| e.to_string())?;
    ok_json(&col)
}

pub fn delete_collection(conn: &Connection, id: &str) -> Result<String, String> {
    qai_lib::db::collection::delete(conn, id).map_err(|e| e.to_string())?;
    Ok(format!("Deleted collection {id}"))
}

// ─── Item ──────────────────────────────────────────────────────

pub fn create_item(conn: &Connection, args: &Value) -> Result<String, String> {
    let collection_id = req_str(args, "collection_id")?;
    let name = req_str(args, "name")?;
    let item_type = opt_str(args, "item_type").unwrap_or_else(|| "request".into());
    let method = opt_str(args, "method").unwrap_or_else(|| "GET".into());
    let parent_id = opt_str(args, "parent_id");

    let item = qai_lib::db::item::create(conn, &collection_id, parent_id.as_deref(), &item_type, &name, &method)
        .map_err(|e| e.to_string())?;

    let payload = qai_lib::models::item::UpdateItemPayload {
        url: opt_str(args, "url"),
        headers: opt_str(args, "headers"),
        query_params: opt_str(args, "query_params"),
        body_type: opt_str(args, "body_type"),
        body_content: opt_str(args, "body_content"),
        description: opt_str(args, "description"),
        extract_rules: opt_str(args, "extract_rules"),
        expect_status: args.get("expect_status").and_then(|v| v.as_u64()).map(|v| v as u16),
        ..Default::default()
    };

    let updated = qai_lib::db::item::update(conn, &item.id, &payload).map_err(|e| e.to_string())?;
    ok_json(&updated)
}

pub fn get_item(conn: &Connection, id: &str) -> Result<String, String> {
    let item = qai_lib::db::item::get(conn, id).map_err(|e| e.to_string())?;
    ok_json(&item)
}

pub fn update_item(conn: &Connection, args: &Value) -> Result<String, String> {
    let id = req_str(args, "id")?;
    let payload = qai_lib::models::item::UpdateItemPayload {
        name: opt_str(args, "name"),
        method: opt_str(args, "method"),
        url: opt_str(args, "url"),
        headers: opt_str(args, "headers"),
        query_params: opt_str(args, "query_params"),
        body_type: opt_str(args, "body_type"),
        body_content: opt_str(args, "body_content"),
        description: opt_str(args, "description"),
        extract_rules: opt_str(args, "extract_rules"),
        expect_status: args.get("expect_status").and_then(|v| v.as_u64()).map(|v| v as u16),
        ..Default::default()
    };
    let updated = qai_lib::db::item::update(conn, &id, &payload).map_err(|e| e.to_string())?;
    ok_json(&updated)
}

pub fn delete_item(conn: &Connection, id: &str) -> Result<String, String> {
    qai_lib::db::item::delete(conn, id).map_err(|e| e.to_string())?;
    Ok(format!("Deleted item {id}"))
}

// ─── Assertion ─────────────────────────────────────────────────

pub fn create_assertion(conn: &Connection, item_id: &str, atype: &str, expression: &str, operator: &str, expected: &str) -> Result<String, String> {
    let a = qai_lib::db::assertion::create(conn, item_id, atype, expression, operator, expected).map_err(|e| e.to_string())?;
    ok_json(&a)
}

pub fn list_assertions(conn: &Connection, item_id: &str) -> Result<String, String> {
    let list = qai_lib::db::assertion::list_by_item(conn, item_id).map_err(|e| e.to_string())?;
    ok_json(&list)
}

pub fn update_assertion(conn: &Connection, args: &Value) -> Result<String, String> {
    let id = req_str(args, "id")?;
    let a = qai_lib::db::assertion::update(
        conn, &id,
        opt_str(args, "assertion_type").as_deref(),
        opt_str(args, "expression").as_deref(),
        opt_str(args, "operator").as_deref(),
        opt_str(args, "expected").as_deref(),
        args.get("enabled").and_then(|v| v.as_bool()),
    ).map_err(|e| e.to_string())?;
    ok_json(&a)
}

pub fn delete_assertion(conn: &Connection, id: &str) -> Result<String, String> {
    qai_lib::db::assertion::delete(conn, id).map_err(|e| e.to_string())?;
    Ok(format!("Deleted assertion {id}"))
}

// ─── Execution ─────────────────────────────────────────────────

pub async fn send_request(conn: &Connection, client: &reqwest::Client, item_id: &str) -> Result<String, String> {
    let raw_item = qai_lib::db::item::get(conn, item_id).map_err(|e| e.to_string())?;
    let assertions = qai_lib::db::assertion::list_by_item(conn, item_id).map_err(|e| e.to_string())?;

    let item = apply_env_vars(conn, &raw_item);

    let mut result = qai_lib::http::client::execute(client, &item).await.map_err(|e| e.to_string())?;
    qai_lib::runner::assertion::apply_assertions(&mut result, &assertions);

    let exec = qai_lib::http::client::to_execution(&item, &result);
    if let Err(e) = qai_lib::db::execution::save(conn, &exec) {
        eprintln!("[qai-mcp] save execution failed: {e}");
    }

    ok_json(&result)
}

pub async fn quick_send(conn: &Connection, client: &reqwest::Client, args: &Value) -> Result<String, String> {
    let item = qai_lib::models::item::CollectionItem {
        id: String::new(),
        collection_id: String::new(),
        parent_id: None,
        item_type: "request".into(),
        name: String::new(),
        sort_order: 0,
        method: req_str(args, "method")?,
        url: req_str(args, "url")?,
        headers: opt_str(args, "headers").unwrap_or_else(|| "[]".into()),
        query_params: "[]".into(),
        body_type: opt_str(args, "body_type").unwrap_or_else(|| "none".into()),
        body_content: opt_str(args, "body_content").unwrap_or_default(),
        extract_rules: "[]".into(),
        description: String::new(),
        expect_status: 0,
        poll_config: String::new(),
        protocol: "http".into(),
        created_at: String::new(),
        updated_at: String::new(),
    };

    let item = apply_env_vars(conn, &item);
    let result = qai_lib::http::client::execute(client, &item).await.map_err(|e| e.to_string())?;
    ok_json(&result)
}

pub async fn run_collection(
    conn: &Connection,
    client: &reqwest::Client,
    collection_id: &str,
    parent_id: Option<&str>,
    concurrency: Option<usize>,
) -> Result<String, String> {
    use std::collections::{HashMap, HashSet};

    let all_items = if let Some(pid) = parent_id {
        qai_lib::db::item::list_by_parent(conn, pid).map_err(|e| e.to_string())?
    } else {
        qai_lib::db::item::list_by_collection(conn, collection_id).map_err(|e| e.to_string())?
    };

    let var_map = build_env_var_map(conn);

    // 识别 chain 容器
    let mut chain_names: HashMap<String, String> = HashMap::new();
    let chain_ids: HashSet<String> = all_items.iter()
        .filter(|i| i.item_type == qai_lib::models::item_type::CHAIN)
        .map(|i| { chain_names.insert(i.id.clone(), i.name.clone()); i.id.clone() })
        .collect();

    // 加载 chain 子请求
    let mut extra_children = Vec::new();
    for cid in &chain_ids {
        if !all_items.iter().any(|i| i.parent_id.as_deref() == Some(cid)) {
            let children = qai_lib::db::item::list_by_parent(conn, cid).map_err(|e| e.to_string())?;
            extra_children.extend(children);
        }
    }

    // 批量加载断言
    let mut all_request_refs: Vec<&qai_lib::models::item::CollectionItem> = all_items.iter()
        .filter(|i| i.item_type == qai_lib::models::item_type::REQUEST).collect();
    all_request_refs.extend(extra_children.iter().filter(|i| i.item_type == qai_lib::models::item_type::REQUEST));
    let req_ids: Vec<String> = all_request_refs.iter().map(|i| i.id.clone()).collect();
    let mut assertions_map = qai_lib::db::assertion::list_by_items(conn, &req_ids).map_err(|e| e.to_string())?;

    // 分类 chain vs normal
    let mut normal = Vec::new();
    let mut chains: HashMap<String, Vec<_>> = HashMap::new();

    for item in &all_items {
        if item.item_type != qai_lib::models::item_type::REQUEST || item.url.is_empty() { continue; }
        let assertions = assertions_map.remove(&item.id).unwrap_or_default();
        if let Some(ref pid) = item.parent_id {
            if chain_ids.contains(pid) {
                chains.entry(pid.clone()).or_default().push((item.clone(), assertions));
                continue;
            }
        }
        normal.push((qai_lib::http::vars::apply_vars(item, &var_map), assertions));
    }
    for child in &extra_children {
        if child.item_type != qai_lib::models::item_type::REQUEST || child.url.is_empty() { continue; }
        let assertions = assertions_map.remove(&child.id).unwrap_or_default();
        if let Some(ref pid) = child.parent_id {
            chains.entry(pid.clone()).or_default().push((child.clone(), assertions));
        }
    }

    if normal.is_empty() && chains.is_empty() {
        return Err("No executable requests found".into());
    }

    let batch_id = uuid::Uuid::new_v4().to_string();
    let mut all_results: Vec<qai_lib::models::execution::ExecutionResult> = Vec::new();
    let start = std::time::Instant::now();

    // 执行 chains
    for (chain_id, steps) in &chains {
        let name = chain_names.get(chain_id).cloned().unwrap_or_default();
        let cr = qai_lib::runner::chain::run_chain(client, steps.clone(), var_map.clone(), chain_id.clone(), name, |_| {}).await;
        for step in cr.steps { all_results.push(step.execution_result); }
    }

    // 并行执行普通请求
    if !normal.is_empty() {
        let br = qai_lib::runner::batch::run_batch(client, normal, concurrency.unwrap_or(5), |_| {}).await;
        all_results.extend(br.results);
    }

    let total_time = start.elapsed().as_millis() as u64;
    let passed = all_results.iter().filter(|r| r.status == qai_lib::models::status::SUCCESS).count();
    let failed = all_results.iter().filter(|r| r.status == qai_lib::models::status::FAILED).count();
    let errors = all_results.iter().filter(|r| r.status == qai_lib::models::status::ERROR).count();

    // 保存执行记录
    for result in &all_results {
        if let Ok(item) = qai_lib::db::item::get(conn, &result.item_id) {
            let mut exec = qai_lib::http::client::to_execution(&item, result);
            exec.batch_id = Some(batch_id.clone());
            if let Err(e) = qai_lib::db::execution::save(conn, &exec) {
                eprintln!("[qai-mcp] save execution failed: {e}");
            }
        }
    }

    // 返回精简摘要（不含大段 response body，避免 context 爆炸）
    let summary = json!({
        "batch_id": batch_id,
        "total": all_results.len(),
        "passed": passed,
        "failed": failed,
        "errors": errors,
        "total_time_ms": total_time,
        "results": all_results.iter().map(|r| json!({
            "item_id": r.item_id,
            "item_name": r.item_name,
            "status": r.status,
            "url": r.request_url,
            "method": r.request_method,
            "response_status": r.response.as_ref().map(|rr| rr.status),
            "response_time_ms": r.response.as_ref().map(|rr| rr.time_ms),
            "assertions_passed": r.assertion_results.iter().filter(|a| a.passed).count(),
            "assertions_total": r.assertion_results.len(),
            "error": r.error_message,
        })).collect::<Vec<_>>()
    });
    ok_json(&summary)
}

// ─── Environment ───────────────────────────────────────────────

pub fn list_environments(conn: &Connection) -> Result<String, String> {
    let envs = qai_lib::db::environment::list_all(conn).map_err(|e| e.to_string())?;
    ok_json(&envs)
}

pub fn create_environment(conn: &Connection, name: &str) -> Result<String, String> {
    let env = qai_lib::db::environment::create(conn, name).map_err(|e| e.to_string())?;
    ok_json(&env)
}

pub fn set_active_environment(conn: &Connection, id: &str) -> Result<String, String> {
    qai_lib::db::environment::set_active(conn, id).map_err(|e| e.to_string())?;
    let env = qai_lib::db::environment::get(conn, id).map_err(|e| e.to_string())?;
    Ok(format!("Activated environment: {}", env.name))
}

pub fn get_active_environment(conn: &Connection) -> Result<String, String> {
    match qai_lib::db::environment::get_active(conn).map_err(|e| e.to_string())? {
        Some(env) => ok_json(&env),
        None => Ok("null (no active environment)".into()),
    }
}

pub fn save_env_variables(conn: &Connection, env_id: &str, vars_json: Value) -> Result<String, String> {
    let arr = vars_json.as_array().ok_or("variables must be an array")?;
    let variables: Vec<qai_lib::models::environment::EnvVariable> = arr.iter().enumerate().map(|(i, v)| {
        qai_lib::models::environment::EnvVariable {
            id: String::new(),
            environment_id: env_id.to_string(),
            key: v.get("key").and_then(|k| k.as_str()).unwrap_or("").to_string(),
            value: v.get("value").and_then(|k| k.as_str()).unwrap_or("").to_string(),
            enabled: v.get("enabled").and_then(|k| k.as_bool()).unwrap_or(true),
            sort_order: i as i32,
        }
    }).collect();

    qai_lib::db::environment::save_variables(conn, env_id, &variables).map_err(|e| e.to_string())?;
    Ok(format!("Saved {} variables", variables.len()))
}

pub fn delete_environment(conn: &Connection, id: &str) -> Result<String, String> {
    qai_lib::db::environment::delete(conn, id).map_err(|e| e.to_string())?;
    Ok(format!("Deleted environment {id}"))
}

// ─── History ───────────────────────────────────────────────────

pub fn list_history(conn: &Connection, status: Option<&str>, method: Option<&str>, keyword: Option<&str>, limit: Option<u32>) -> Result<String, String> {
    let list = qai_lib::db::execution::list_filtered(conn, status, method, keyword, limit.unwrap_or(50), 0).map_err(|e| e.to_string())?;
    ok_json(&list)
}

pub fn get_history_stats(conn: &Connection) -> Result<String, String> {
    let stats = qai_lib::db::execution::get_stats(conn).map_err(|e| e.to_string())?;
    ok_json(&stats)
}

pub fn list_item_runs(conn: &Connection, item_id: &str, limit: Option<u32>) -> Result<String, String> {
    let runs = qai_lib::db::execution::list_by_item(conn, item_id, limit.unwrap_or(20)).map_err(|e| e.to_string())?;
    ok_json(&runs)
}

// ─── Group ─────────────────────────────────────────────────────

pub fn list_groups(conn: &Connection) -> Result<String, String> {
    let groups = qai_lib::db::group::list_all(conn).map_err(|e| e.to_string())?;
    ok_json(&groups)
}

pub fn create_group(conn: &Connection, name: &str, parent_id: Option<&str>) -> Result<String, String> {
    let g = qai_lib::db::group::create(conn, name, parent_id).map_err(|e| e.to_string())?;
    ok_json(&g)
}

pub fn delete_group(conn: &Connection, id: &str) -> Result<String, String> {
    qai_lib::db::group::delete(conn, id).map_err(|e| e.to_string())?;
    Ok(format!("Deleted group {id}"))
}

// ─── Helpers ───────────────────────────────────────────────────

fn ok_json(v: &impl serde::Serialize) -> Result<String, String> {
    serde_json::to_string_pretty(v).map_err(|e| e.to_string())
}

fn req_str(args: &Value, key: &str) -> Result<String, String> {
    args.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
        .ok_or_else(|| format!("Missing required argument: {key}"))
}

fn opt_str(args: &Value, key: &str) -> Option<String> {
    args.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

fn build_env_var_map(conn: &Connection) -> std::collections::HashMap<String, String> {
    if let Ok(Some(env)) = qai_lib::db::environment::get_active(conn) {
        qai_lib::http::vars::build_var_map(&env.variables)
    } else {
        std::collections::HashMap::new()
    }
}

fn apply_env_vars(conn: &Connection, item: &qai_lib::models::item::CollectionItem) -> qai_lib::models::item::CollectionItem {
    let var_map = build_env_var_map(conn);
    if var_map.is_empty() { item.clone() } else { qai_lib::http::vars::apply_vars(item, &var_map) }
}
