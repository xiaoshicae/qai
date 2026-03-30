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

            let exec_future = if item.protocol == "websocket" {
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

    let passed = results.iter().filter(|r| r.status == crate::models::Status::Success.as_str()).count() as u32;
    let failed = results.iter().filter(|r| r.status == crate::models::Status::Failed.as_str()).count() as u32;
    let errors = results.iter().filter(|r| r.status == crate::models::Status::Error.as_str()).count() as u32;

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
