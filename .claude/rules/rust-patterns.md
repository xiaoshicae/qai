# Rust 编码规范

## 错误处理

```rust
// Tauri command 中使用 Result<T, String>
#[tauri::command]
pub fn my_command(db: State<'_, DbState>) -> Result<Data, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    do_something(&conn).map_err(|e| e.to_string())
}

// 内部模块使用 Result<T, rusqlite::Error> 或 anyhow::Error
pub fn get(conn: &Connection, id: &str) -> Result<Data, rusqlite::Error> { ... }
pub async fn execute(req: &ApiRequest) -> Result<ExecutionResult, anyhow::Error> { ... }
```

- Tauri command 层统一转 `String` 错误（前端只需字符串）
- 内部模块保留具体错误类型
- 避免生产代码中的 `unwrap()`，用 `?` 或 `unwrap_or_default()`

## 数据库操作

- 所有数据库连接通过 `DbState(Mutex<Connection>)` 管理
- 每次操作 `lock()` 获取连接，操作完立即释放（不长时间持有锁）
- SQLite 使用 WAL 模式提升并发读性能
- 异步命令中先获取数据释放锁，再做网络请求

```rust
// 正确：先取数据释放锁，再做异步操作
let req = {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::request::get(&conn, &id).map_err(|e| e.to_string())?
};
let result = crate::http::client::execute(&req).await?;
```

## 模型定义

- 所有模型 derive `Serialize, Deserialize, Debug, Clone`
- ID 使用 `uuid::Uuid::new_v4().to_string()`，在 Rust 端生成
- 时间字段使用 `TEXT` 存储 ISO 格式字符串
- JSON 字段（headers, query_params）以 `String` 存储，解析时用 `serde_json::from_str`

## 命名约定

| 类型 | 规则 | 示例 |
|------|------|------|
| 模块 | snake_case | `collection_cmd.rs` |
| 结构体 | PascalCase | `ApiRequest` |
| 函数 | snake_case | `list_by_request` |
| 常量 | UPPER_SNAKE | `MAX_CONCURRENCY` |
| Tauri 命令 | snake_case | `#[tauri::command] fn send_request` |

## 禁止事项

- 生产代码中使用 `println!`（使用 `log::info!` 等）
- 在异步操作中长时间持有 `Mutex` 锁
- 在 Tauri command 中做复杂业务逻辑（保持 command 为薄层）
- `unsafe` 代码（除非有充分理由并注释说明）
