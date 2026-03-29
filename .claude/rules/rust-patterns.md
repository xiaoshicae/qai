# Rust 编码规范

## 错误处理

```rust
// Tauri command 中使用 Result<T, String>
#[tauri::command]
pub fn my_command(db: State<'_, DbState>) -> Result<Data, String> {
    let conn = db.conn()?;
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

- 获取连接统一使用 `db.conn()?`（`DbState::conn()` 封装了 `Mutex::lock` + 错误转换）
- **禁止** 直接写 `db.0.lock().map_err(|e| e.to_string())?`
- 每次操作获取连接，操作完立即释放（不长时间持有锁）
- SQLite 使用 WAL 模式提升并发读性能
- 异步命令中先获取数据释放锁，再做网络请求
- 批量查询优先于循环逐条查询（避免 N+1），使用 `list_by_items` 等批量接口

```rust
// 正确：先取数据释放锁，再做异步操作
let req = {
    let conn = db.conn()?;
    crate::db::item::get(&conn, &id).map_err(|e| e.to_string())?
};
let result = crate::http::client::execute(&http.0, &req).await?;

// 正确：批量查询 assertions（而非 for 循环逐条查）
let ids: Vec<String> = items.iter().map(|i| i.id.clone()).collect();
let assertions_map = crate::db::assertion::list_by_items(&conn, &ids)?;
```

## 请求构建

- HTTP 请求构建统一使用 `http::request_builder::build_request()`
- **禁止**在 `client.rs`、`stream.rs` 等模块中重复编写 method/headers/query/body 构建逻辑
- body 类型处理（json/raw/urlencoded/form-data）全部在 `request_builder.rs` 中集中维护

## 断言评估

- 对 `ExecutionResult` 执行断言并更新 status 统一使用 `runner::assertion::apply_assertions()`
- **禁止**重复编写 `evaluate_assertions` + 判断 pass/fail + 设置 status 的代码块

## 模型定义

- 所有模型 derive `Serialize, Deserialize, Debug, Clone`
- ID 使用 `uuid::Uuid::new_v4().to_string()`，在 Rust 端生成
- 时间字段使用 `TEXT` 存储 ISO 格式字符串
- JSON 字段（headers, query_params）以 `String` 存储，解析时用 `serde_json::from_str`

## 领域字符串常量化

- 业务状态（success/failed/error）、节点类型（folder/chain/request）等跨文件使用的领域字符串，**必须**定义为 `models/mod.rs` 中的常量模块
- **禁止**在业务代码中直接写字符串字面量进行比较或赋值
- 常量命名用 `UPPER_SNAKE`，放在语义化的子模块中

```rust
// 错误：字符串字面量散布各处，拼错不会编译报错
if result.status == "sucess" { ... }  // typo，编译通过

// 正确：编译期检查
use crate::models::status;
if result.status == status::SUCCESS { ... }

// 定义位置：models/mod.rs
pub mod status {
    pub const SUCCESS: &str = "success";
    pub const FAILED: &str = "failed";
    pub const ERROR: &str = "error";
}
pub mod item_type {
    pub const FOLDER: &str = "folder";
    pub const CHAIN: &str = "chain";
    pub const REQUEST: &str = "request";
}
```

## 命名约定

| 类型 | 规则 | 示例 |
|------|------|------|
| 模块 | snake_case | `collection_cmd.rs` |
| 结构体 | PascalCase | `ApiRequest` |
| 函数 | snake_case | `list_by_request` |
| 常量 | UPPER_SNAKE | `MAX_CONCURRENCY` |
| Tauri 命令 | snake_case | `#[tauri::command] fn send_request` |

## 静态资源缓存

- 正则表达式、编译型资源使用 `std::sync::OnceLock` 或 `std::sync::LazyLock` 缓存
- **禁止**在热路径函数中重复调用 `Regex::new()`

```rust
// 错误：每次调用都编译
fn replace_vars(text: &str, vars: &HashMap<String, String>) -> String {
    let re = Regex::new(r"\{\{(\w+)\}\}").unwrap();
    // ...
}

// 正确：全局缓存
use std::sync::OnceLock;
fn var_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\{\{(\w+)\}\}").unwrap())
}
```

## 错误记录

- DB 保存操作不得用 `let _ =` 静默吞掉错误，至少 `log::warn!`
- 非关键路径的错误（如执行记录保存）可以不阻断主流程，但必须记录

```rust
// 错误：静默失败
let _ = crate::db::execution::save(&conn, &exec);

// 正确：记录警告
if let Err(e) = crate::db::execution::save(&conn, &exec) {
    log::warn!("保存执行记录失败: {e}");
}
```

## Tauri Command 参数设计

- 超过 5 个参数的命令，使用 Payload 结构体替代散装参数
- Payload 结构体 derive `Deserialize`，Tauri 自动从前端 JSON 反序列化

```rust
// 错误：13 个散装参数
pub fn update_item(id: String, name: Option<String>, method: Option<String>, ...) {}

// 正确：Payload 结构体
#[derive(Deserialize)]
pub struct UpdateItemPayload {
    pub name: Option<String>,
    pub method: Option<String>,
    // ...
}
pub fn update_item(db: State<'_, DbState>, id: String, payload: UpdateItemPayload) {}
```

## 并行执行计时

- 并行任务的**总耗时**必须用 wall-clock 时间（`Instant::now().elapsed()`）
- **禁止**累加各任务的网络耗时作为总时间（5 个并发请求各 1s ≠ 总耗时 5s）

```rust
// 错误：累加各任务耗时
let mut total_time = 0u64;
for result in &results {
    total_time += result.response.time_ms;  // 并行时总和远大于实际
}

// 正确：wall-clock 时间
let start = std::time::Instant::now();
// ... 并行执行 ...
let total_time = start.elapsed().as_millis() as u64;
```

## Command 层去重模式

- 多个 command 共享相同的前置逻辑（加载数据、变量替换）和后置逻辑（断言、保存），必须提取为公共函数
- 命名约定：`prepare_*()` 做前置准备，`finalize_*()` 做后置收尾
- 公共函数放在同一 command 模块文件顶部（`pub(crate)`），或提取到服务层

```rust
// 提取的公共前置逻辑
fn prepare_request(db: &DbState, id: &str) -> Result<(CollectionItem, Vec<Assertion>), String> {
    let conn = db.conn()?;
    let item = crate::db::item::get(&conn, id).map_err(|e| e.to_string())?;
    let assertions = crate::db::assertion::list_by_item(&conn, id).map_err(|e| e.to_string())?;
    // 环境变量替换 ...
    Ok((item, assertions))
}

// command 变得简洁
pub async fn send_request(...) -> Result<ExecutionResult, String> {
    let (item, assertions) = prepare_request(&db, &id)?;
    let mut result = crate::http::client::execute(&http.0, &item).await?;
    finalize_result(&db, &item, &mut result, &assertions)?;
    Ok(result)
}
```

## 编排层数据完整传递

- 调用下游函数时，**禁止**用空字符串 / 默认值替代当前上下文中已有的数据
- 如果上下文中有数据，就传下去；如果没有，显式说明为什么没有

```rust
// 错误：明明有 chain 的 name，却传空字符串
run_chain(..., chain_item_id.clone(), String::new(), ...);

// 正确：从上下文中获取真实数据
let name = chain_names.get(&chain_item_id).cloned().unwrap_or_default();
run_chain(..., chain_item_id.clone(), name, ...);
```

## 禁止事项

- 生产代码中使用 `println!`（使用 `log::info!` 等）
- 在异步操作中长时间持有 `Mutex` 锁
- 在 Tauri command 中做复杂业务逻辑（保持 command 为薄层）
- `unsafe` 代码（除非有充分理由并注释说明）
- 用 `let _ =` 吞掉数据库写入错误
- 在热路径中重复编译 `Regex::new()`
- 散装参数超过 5 个（用 Payload 结构体）
- 累加各任务耗时作为并行执行总时间
- 调用函数时用空字符串替代已有数据
- 在业务代码中硬编码领域状态字符串（用 `models::status::*` 常量）
