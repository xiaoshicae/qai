//! 集合执行编排器 —— 从 DB 加载 items → 识别 chain → 批量加载断言 → 构建执行单元
//!
//! 供 Tauri command 层和 MCP handler 共同调用，消除重复的数据准备逻辑。

use std::collections::{HashMap, HashSet};

use rusqlite::Connection;

use crate::models::assertion::Assertion;
use crate::models::item::CollectionItem;
use crate::models::ItemType;

/// 执行单元：保持表格顺序，chain 和普通请求统一编排
#[allow(clippy::large_enum_variant)]
pub enum ExecUnit {
    Single(CollectionItem, Vec<Assertion>),
    Chain {
        chain_id: String,
        name: String,
        steps: Vec<(CollectionItem, Vec<Assertion>)>,
    },
}

impl ExecUnit {
    /// 该执行单元包含的请求数（chain 计子步骤数）
    pub fn request_count(&self) -> u32 {
        match self {
            ExecUnit::Single(..) => 1,
            ExecUnit::Chain { steps, .. } => steps.len() as u32,
        }
    }
}

/// 从 DB 构建有序执行单元列表（含变量映射）
///
/// 逻辑：加载 items → 识别 chain → 加载 chain 子请求 → 批量加载断言 → 按 sort_order 构建
pub fn build_exec_units(
    conn: &Connection,
    collection_id: &str,
    parent_id: Option<&str>,
    exclude_ids: &HashSet<String>,
) -> Result<(Vec<ExecUnit>, HashMap<String, String>), rusqlite::Error> {
    let mut all_items = if let Some(pid) = parent_id {
        crate::db::item::list_by_parent(conn, pid)?
    } else {
        crate::db::item::list_by_collection(conn, collection_id)?
    };
    if !exclude_ids.is_empty() {
        all_items.retain(|item| {
            !exclude_ids.contains(&item.id)
                && !item
                    .parent_id
                    .as_ref()
                    .is_some_and(|pid| exclude_ids.contains(pid))
        });
    }

    let var_map = crate::db::environment::get_active_var_map(conn);

    // 识别 chain 容器
    let chain_item_ids: HashSet<String> = all_items
        .iter()
        .filter(|i| i.item_type == ItemType::Chain.as_str())
        .map(|i| i.id.clone())
        .collect();

    // 收集所有 request items 用于批量加载断言
    let mut all_request_items: Vec<&CollectionItem> = all_items
        .iter()
        .filter(|i| i.item_type == ItemType::Request.as_str())
        .collect();

    // chain 子项可能不在 all_items 中（嵌套加载）
    let mut extra_children = Vec::new();
    for chain_id in &chain_item_ids {
        let has_child = all_items
            .iter()
            .any(|i| i.parent_id.as_deref() == Some(chain_id));
        if !has_child {
            let children = crate::db::item::list_by_parent(conn, chain_id)?;
            extra_children.extend(children);
        }
    }
    all_request_items.extend(
        extra_children
            .iter()
            .filter(|i| i.item_type == ItemType::Request.as_str()),
    );

    // 批量查询断言（消除 N+1）
    let request_ids: Vec<String> = all_request_items.iter().map(|i| i.id.clone()).collect();
    let mut assertions_map = crate::db::assertion::list_by_items(conn, &request_ids)?;

    // 构建 chain → steps 映射
    let mut chain_steps: HashMap<String, Vec<(CollectionItem, Vec<Assertion>)>> = HashMap::new();

    for item in &all_items {
        if item.item_type != ItemType::Request.as_str() || item.url.is_empty() {
            continue;
        }
        if let Some(ref pid) = item.parent_id {
            if chain_item_ids.contains(pid) {
                let assertions = assertions_map.remove(&item.id).unwrap_or_default();
                chain_steps
                    .entry(pid.clone())
                    .or_default()
                    .push((item.clone(), assertions));
            }
        }
    }
    for child in &extra_children {
        if child.item_type == ItemType::Request.as_str() && !child.url.is_empty() {
            let assertions = assertions_map.remove(&child.id).unwrap_or_default();
            if let Some(ref pid) = child.parent_id {
                chain_steps
                    .entry(pid.clone())
                    .or_default()
                    .push((child.clone(), assertions));
            }
        }
    }

    // 按 sort_order 遍历 all_items，构建有序执行单元
    let mut units: Vec<ExecUnit> = Vec::new();
    for item in &all_items {
        if item.item_type == ItemType::Chain.as_str() {
            if let Some(steps) = chain_steps.remove(&item.id) {
                if !steps.is_empty() {
                    units.push(ExecUnit::Chain {
                        chain_id: item.id.clone(),
                        name: item.name.clone(),
                        steps,
                    });
                }
            }
        } else if item.item_type == ItemType::Request.as_str() {
            // 跳过 chain 子请求和空 URL
            if item
                .parent_id
                .as_ref()
                .is_some_and(|pid| chain_item_ids.contains(pid))
            {
                continue;
            }
            if item.url.is_empty() {
                continue;
            }
            let assertions = assertions_map.remove(&item.id).unwrap_or_default();
            let item = crate::http::vars::apply_vars(item, &var_map);
            units.push(ExecUnit::Single(item, assertions));
        }
    }

    Ok((units, var_map))
}

/// 为单个 chain 构建执行步骤
pub fn build_chain_steps(
    conn: &Connection,
    chain_item_id: &str,
) -> Result<
    (
        Vec<(CollectionItem, Vec<Assertion>)>,
        HashMap<String, String>,
        String,
    ),
    rusqlite::Error,
> {
    let chain_item = crate::db::item::get(conn, chain_item_id)?;
    let children = crate::db::item::list_by_parent(conn, chain_item_id)?;
    let var_map = crate::db::environment::get_active_var_map(conn);

    let request_children: Vec<_> = children
        .iter()
        .filter(|c| c.item_type == ItemType::Request.as_str())
        .collect();
    let child_ids: Vec<String> = request_children.iter().map(|c| c.id.clone()).collect();
    let mut assertions_map = crate::db::assertion::list_by_items(conn, &child_ids)?;
    let steps: Vec<_> = request_children
        .into_iter()
        .map(|child| {
            let assertions = assertions_map.remove(&child.id).unwrap_or_default();
            (child.clone(), assertions)
        })
        .collect();

    Ok((steps, var_map, chain_item.name))
}

/// 将执行结果批量保存到 DB（事务包裹）
pub fn save_results(
    conn: &Connection,
    results: &[crate::models::execution::ExecutionResult],
    batch_id: &str,
) -> Result<(), rusqlite::Error> {
    let tx = conn.unchecked_transaction()?;
    for result in results {
        if let Ok(item) = crate::db::item::get(&tx, &result.item_id) {
            let mut exec = crate::http::client::to_execution(&item, result);
            exec.batch_id = Some(batch_id.to_string());
            if let Err(e) = crate::db::execution::save(&tx, &exec) {
                log::warn!("保存执行记录失败 [{}]: {e}", result.item_id);
            }
        }
    }
    tx.commit()
}
