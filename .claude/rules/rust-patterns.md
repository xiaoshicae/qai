# Rust 编码规范

## 错误处理

- Tauri command 层：`Result<T, String>`，用 `.map_err(|e| e.to_string())`
- 内部模块：保留具体错误类型（`rusqlite::Error`、`anyhow::Error`）
- 禁止生产代码 `unwrap()`，用 `?` 或 `unwrap_or_default()`
- DB 写入错误禁止 `let _ =` 静默吞掉，至少 `log::warn!`

## 数据库操作

- 获取连接统一 `db.conn()?`，禁止直接写 `db.0.lock().map_err(...)`
- 异步命令：先获取数据释放锁，再做网络请求
- 批量查询优先（`list_by_items`），避免 N+1 循环
- **多操作写入必须用事务**（`conn.transaction()`），确保原子性

```rust
// 异步命令模式
let req = { let conn = db.conn()?; crate::db::item::get(&conn, &id).map_err(|e| e.to_string())? };
let result = crate::http::client::execute(&http.0, &req).await?;

// 事务模式
let tx = conn.transaction().map_err(|e| e.to_string())?;
for item in &items { tx.execute("UPDATE ...", ...)?; }
tx.commit().map_err(|e| e.to_string())?;
```

## 请求构建 & 断言

- HTTP 请求构建统一用 `http::request_builder::build_request()`，禁止在各模块重复编写
- 断言评估统一用 `runner::assertion::apply_assertions()`，禁止重复编写

## 模型定义

- derive `Serialize, Deserialize, Debug, Clone`
- ID: `uuid::Uuid::new_v4().to_string()`（Rust 端生成）
- 时间: `TEXT` 存 ISO 格式，用 `Local::now()`（禁止 `Utc::now()`）

## 领域字符串常量化

业务状态/节点类型等必须定义在 `models/mod.rs` 常量模块中，禁止硬编码字符串字面量。

```rust
use crate::models::status;
if result.status == status::SUCCESS { ... }  // 而非 "success"
```

## 前后端序列化（serde + Tauri invoke）

- **嵌套 Payload 结构体**（前端传 camelCase）：必须加 `#[serde(rename_all = "camelCase")]`
- **DB JSON 结构体**（前端 camelCase 写入）：用 `#[serde(rename = "fieldType", alias = "field_type")]`
- **返回值**：保持默认 snake_case，不加 `rename_all`
- 顶层命令参数 Tauri 2 自动转换，无需处理

## 静态资源缓存

正则用 `OnceLock`/`LazyLock` 全局缓存，禁止热路径 `Regex::new()`。

## 并行执行计时

总耗时用 `Instant::now().elapsed()`（wall-clock），禁止累加各任务网络耗时。

## Command 层设计

- Command 是薄层：参数校验 → 调用服务层 → 返回结果
- 超过 5 个参数用 Payload 结构体
- 共享前置/后置逻辑提取为 `prepare_*()`/`finalize_*()`
- 调用下游禁止用空字符串替代已有数据

## 状态管理与竞态

- 多字段协同状态用单一 Mutex 包装结构体，禁止多个独立 Mutex
- 批量执行取消令牌每次运行独立创建

## 安全

- 用户输入正则：限制长度 + `RegexBuilder` 设 `size_limit`/`nest_limit`
- HTTP 响应体：设最大大小限制（10MB），流式也要检查累积大小
- 文件路径：`canonicalize()` + 检查敏感系统文件

## 常量定义

应用级常量在 `lib.rs` 集中定义，禁止硬编码魔法数字。

## 命名约定

模块 `snake_case`，结构体 `PascalCase`，函数 `snake_case`，常量 `UPPER_SNAKE`。

## 禁止事项

- `println!`（用 `log::*`） / `unsafe` / `let _ =` 吞 DB 错误
- 异步中长时间持有 Mutex / Command 内做复杂业务逻辑
- 热路径 `Regex::new()` / 散装参数 >5 个 / 累加并行耗时
- 硬编码领域字符串 / 空字符串替代已有数据
