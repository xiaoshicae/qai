use std::sync::Arc;
use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::models::assertion::Assertion;
use crate::models::execution::ExecutionResult;
use crate::models::item::CollectionItem;
use crate::runner::assertion::apply_assertions;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct TestProgress {
    pub batch_id: String,
    pub item_id: String,
    pub item_name: String,
    pub status: String,
    pub current: u32,
    pub total: u32,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct BatchResult {
    pub batch_id: String,
    pub total: u32,
    pub passed: u32,
    pub failed: u32,
    pub errors: u32,
    pub total_time_ms: u64,
    pub results: Vec<ExecutionResult>,
}

pub async fn run_batch(
    client: &reqwest::Client,
    items: Vec<(CollectionItem, Vec<Assertion>)>,
    concurrency: usize,
    cancel_token: Arc<std::sync::atomic::AtomicBool>,
    progress_callback: impl Fn(TestProgress) + Send + Sync + 'static,
    on_result: impl Fn(&ExecutionResult) + Send + Sync + 'static,
    dry_run: bool,
) -> BatchResult {
    let batch_id = Uuid::new_v4().to_string();
    let total = items.len() as u32;
    let semaphore = Arc::new(Semaphore::new(concurrency));
    let callback = Arc::new(progress_callback);
    let on_result = Arc::new(on_result);
    let client = client.clone();
    let start = std::time::Instant::now();

    let mut handles = Vec::new();

    for (index, (item, assertions)) in items.into_iter().enumerate() {
        let sem = semaphore.clone();
        let cb = callback.clone();
        let or = on_result.clone();
        let bid = batch_id.clone();
        let client = client.clone();
        let ct = cancel_token.clone();

        let handle = tokio::spawn(async move {
            let _permit = sem.acquire().await.expect("semaphore closed");
            if ct.load(std::sync::atomic::Ordering::Relaxed) {
                return None;
            }

            cb(TestProgress {
                batch_id: bid.clone(),
                item_id: item.id.clone(),
                item_name: item.name.clone(),
                status: crate::models::Status::Running.as_str().to_string(),
                current: index as u32 + 1,
                total,
            });

            let exec_future = if dry_run {
                Ok(crate::http::client::mock_execute(&item).await)
            } else if item.protocol == "websocket" {
                crate::websocket::client::execute(&item).await
            } else {
                crate::http::client::execute(&client, &item).await
            };
            let mut result = match exec_future {
                Ok(r) => r,
                Err(e) => ExecutionResult {
                    execution_id: Uuid::new_v4().to_string(),
                    item_id: item.id.clone(),
                    item_name: item.name.clone(),
                    request_url: item.url.clone(),
                    request_method: item.method.clone(),
                    status: crate::models::Status::Error.as_str().to_string(),
                    response: None,
                    assertion_results: vec![],
                    error_message: Some(e.to_string()),
                },
            };

            apply_assertions(&mut result, &assertions);
            or(&result);

            let status = result.status.clone();
            cb(TestProgress {
                batch_id: bid,
                item_id: item.id.clone(),
                item_name: item.name.clone(),
                status,
                current: index as u32 + 1,
                total,
            });

            Some(result)
        });
        handles.push(handle);
    }

    let mut results = Vec::new();
    for handle in handles {
        if let Ok(Some(result)) = handle.await {
            results.push(result);
        }
    }
    let total_time_ms = start.elapsed().as_millis() as u64;

    let passed = results
        .iter()
        .filter(|r| r.status == crate::models::Status::Success.as_str())
        .count() as u32;
    let failed = results
        .iter()
        .filter(|r| r.status == crate::models::Status::Failed.as_str())
        .count() as u32;
    let errors = results
        .iter()
        .filter(|r| r.status == crate::models::Status::Error.as_str())
        .count() as u32;

    BatchResult {
        batch_id,
        total: results.len() as u32,
        passed,
        failed,
        errors,
        total_time_ms,
        results,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

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

    fn noop_progress(_: TestProgress) {}
    fn noop_result(_: &ExecutionResult) {}

    #[tokio::test]
    async fn test_dry_run_all_pass() {
        let client = reqwest::Client::new();
        let items = vec![
            (make_item("1", "A"), vec![]),
            (make_item("2", "B"), vec![]),
            (make_item("3", "C"), vec![]),
        ];
        let cancel = Arc::new(AtomicBool::new(false));
        let result = run_batch(&client, items, 10, cancel, noop_progress, noop_result, true).await;
        assert_eq!(result.total, 3);
        assert_eq!(result.passed, 3);
        assert_eq!(result.failed, 0);
        assert_eq!(result.errors, 0);
    }

    #[tokio::test]
    async fn test_empty_items() {
        let client = reqwest::Client::new();
        let cancel = Arc::new(AtomicBool::new(false));
        let result = run_batch(
            &client,
            vec![],
            10,
            cancel,
            noop_progress,
            noop_result,
            true,
        )
        .await;
        assert_eq!(result.total, 0);
        assert_eq!(result.passed, 0);
    }

    #[tokio::test]
    async fn test_progress_callback_called() {
        let client = reqwest::Client::new();
        let items = vec![(make_item("1", "A"), vec![])];
        let cancel = Arc::new(AtomicBool::new(false));
        let count = Arc::new(AtomicU32::new(0));
        let count_clone = count.clone();
        let result = run_batch(
            &client,
            items,
            10,
            cancel,
            move |_| {
                count_clone.fetch_add(1, Ordering::Relaxed);
            },
            noop_result,
            true,
        )
        .await;
        assert_eq!(result.total, 1);
        // 每个 item 进度回调 2 次：running + completed
        assert_eq!(count.load(Ordering::Relaxed), 2);
    }

    #[tokio::test]
    async fn test_on_result_callback_called() {
        let client = reqwest::Client::new();
        let items = vec![(make_item("1", "A"), vec![]), (make_item("2", "B"), vec![])];
        let cancel = Arc::new(AtomicBool::new(false));
        let count = Arc::new(AtomicU32::new(0));
        let count_clone = count.clone();
        run_batch(
            &client,
            items,
            10,
            cancel,
            noop_progress,
            move |_| {
                count_clone.fetch_add(1, Ordering::Relaxed);
            },
            true,
        )
        .await;
        assert_eq!(count.load(Ordering::Relaxed), 2);
    }

    #[tokio::test]
    async fn test_cancel_token_prevents_execution() {
        let client = reqwest::Client::new();
        let items = vec![
            (make_item("1", "A"), vec![]),
            (make_item("2", "B"), vec![]),
            (make_item("3", "C"), vec![]),
        ];
        // 取消令牌在运行前就设置
        let cancel = Arc::new(AtomicBool::new(true));
        let result = run_batch(&client, items, 1, cancel, noop_progress, noop_result, true).await;
        // 所有 item 被取消，返回 None → total=0
        assert_eq!(result.total, 0);
    }

    #[tokio::test]
    async fn test_batch_id_is_uuid() {
        let client = reqwest::Client::new();
        let items = vec![(make_item("1", "A"), vec![])];
        let cancel = Arc::new(AtomicBool::new(false));
        let result = run_batch(&client, items, 10, cancel, noop_progress, noop_result, true).await;
        assert!(!result.batch_id.is_empty());
        assert!(uuid::Uuid::parse_str(&result.batch_id).is_ok());
    }

    #[tokio::test]
    async fn test_dry_run_with_failing_assertion() {
        let client = reqwest::Client::new();
        // dry_run 返回 status=200（默认 expect_status=200），断言期望 404 → 失败
        let item = make_item("1", "A");
        let assertion = Assertion {
            id: "a1".into(),
            item_id: "1".into(),
            assertion_type: "status_code".into(),
            expression: String::new(),
            operator: "eq".into(),
            expected: "404".into(), // mock 返回 200，断言失败
            enabled: true,
            sort_order: 0,
            created_at: String::new(),
        };
        let items = vec![(item, vec![assertion])];
        let cancel = Arc::new(AtomicBool::new(false));
        let result = run_batch(&client, items, 10, cancel, noop_progress, noop_result, true).await;
        assert_eq!(result.total, 1);
        assert_eq!(result.failed, 1);
        assert_eq!(result.passed, 0);
    }
}
