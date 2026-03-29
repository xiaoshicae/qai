# 后端架构模式与反模式

> 源于 2026-03-29 全面架构审查，持续更新。
> 规则层面的约束见 `.claude/rules/rust-patterns.md` 和 `.claude/rules/architecture.md`。

---

## 一、反模式清单（踩过的坑）

### 1. 静默失败 — `let _ =` 吞掉写入错误

```rust
// 反模式
let _ = crate::db::execution::save(&conn, &exec);
```

**症状**: 用户执行测试后历史记录消失，无任何报错。
**教训**: 数据写入失败即使不阻断主流程，也必须 `log::warn!`。用户看不到的错误 = 永远不会被修复的 bug。

### 2. 参数传递断裂 — 空字符串替代已有数据

```rust
// 反模式：上下文有 chain 的 name，却传空
run_chain(..., chain_item_id.clone(), String::new(), ...);
```

**症状**: 链执行结果中 `item_name` 永远为空，报告/UI 无法展示链名称。
**教训**: 多步编排中，在最顶层一次性收集所有需要传递的数据（用 HashMap 等），循环内直接查取，而不是用空值占位"后面再处理"。

### 3. 并行计时语义错误 — 累加 vs wall-clock

```rust
// 反模式：累加各任务耗时
for result in &results {
    total_time += result.response.time_ms;
}
```

**症状**: 5 个并发请求各 1s，报告显示"总耗时 5s"而非"~1s"。
**教训**: 并行执行的总耗时必须用 `Instant::now().elapsed()`。累加耗时只能衡量"总 CPU/网络工作量"，不代表实际运行时长。

### 4. 热路径中重复编译 — Regex::new()

```rust
// 反模式：每次函数调用都编译正则
fn replace_vars(text: &str, vars: &HashMap<String, String>) -> String {
    let re = Regex::new(r"\{\{(\w+)\}\}").unwrap();
    ...
}
```

**症状**: 链式执行 10 个请求，每个请求替换 url/body/headers/query 4 个字段 = 40 次 Regex 编译。
**教训**: 编译型资源（Regex、模板）使用 `OnceLock` 全局缓存。识别方法：任何在循环体 / 被频繁调用的函数中出现的 `::new()` 都需要审视。

### 5. 字符串硬编码 — 散布式领域常量

```rust
// 反模式：同一个字符串在 10+ 个文件中出现
if result.status == "sucess" { ... }  // typo，编译通过
```

**症状**: 拼写错误不会被编译器捕获。改一个值需要全局搜索替换。
**教训**: 跨文件使用的领域字符串（状态码、类型标识）必须定义为常量模块。即使不用 enum，常量也能提供编译期拼写检查。

### 6. 散装参数爆炸 — 13 个 Option 参数

```rust
// 反模式
pub fn update(conn: &Connection, id: &str,
    name: Option<&str>, method: Option<&str>, url: Option<&str>,
    headers: Option<&str>, query_params: Option<&str>, body_type: Option<&str>,
    body_content: Option<&str>, extract_rules: Option<&str>, description: Option<&str>,
    expect_status: Option<u16>, parent_id: Option<Option<&str>>, protocol: Option<&str>,
) -> ...
```

**症状**: 每加一个字段，db 层 / command 层 / 前端 invoke 三处都要改。调用时参数顺序容易出错。
**教训**: 超过 5 个参数时，提取为 `Payload` 结构体 + `#[derive(Deserialize, Default)]`。Tauri 天然支持结构体参数反序列化。

### 7. Command 代码重复 — 相同的 setup/teardown

```rust
// 反模式：send_request 和 send_request_stream 70% 代码相同
// 都做：加载 item → 环境变量替换 → 执行 → 断言 → 保存
```

**症状**: 修改流程时需要同步改两处，遗漏一处导致行为不一致。
**教训**: 识别信号是"两个函数的差异只在中间一步"。提取 `prepare_*()` 和 `finalize_*()` 公共函数，让 command 只关注差异部分。

### 8. 树形构建 O(N²)

```rust
// 反模式：递归时对每个节点遍历全部 items
fn build_children(parent_id: Option<&str>, all_items: &[Item]) -> Vec<Node> {
    for item in all_items.iter().filter(|i| i.parent_id == parent_id) { ... }
}
```

**症状**: 100 个节点 = 10000 次比较。集合变大后树加载变慢。
**教训**: 先 `HashMap<parent_id, Vec<&Item>>` 分组，构建时 O(1) 查子节点。总复杂度 O(N)。

---

## 二、已验证的好模式

### 1. DbState::conn() 封装

统一 `Mutex::lock` + 错误转换，调用方一行 `db.conn()?`。避免每处都写 `db.0.lock().map_err(...)` 样板代码。

### 2. 批量查询 list_by_items

`crate::db::assertion::list_by_items(&conn, &ids)` 返回 `HashMap<item_id, Vec<Assertion>>`。一次 SQL 查询替代 N 次循环查询。

### 3. request_builder 集中化

所有 HTTP 请求构建（method/headers/query/body/multipart）集中在 `http::request_builder::build_request()`。client.rs 和 stream.rs 只负责发送和结果处理。

### 4. 信号量限并发

批量执行用 `Arc<Semaphore>` 限制并发数，防止连接数爆炸。比固定线程池更灵活（可配置 concurrency 参数）。

### 5. 先释放锁再异步

异步 command 中用 block scope 获取数据后立即释放 Mutex 锁，再做网络请求。避免持锁等待网络 I/O。

---

## 三、架构质量评分

| 维度 | 评分 | 备注 |
|------|------|------|
| 模块化设计 | 8/10 | 关注点分离清晰 |
| 数据模型 | 7/10 | 结构完整，CollectionItem 过载 |
| 并发安全 | 6/10 | 基础正确，缺连接池 |
| 错误处理 | 7/10 | 已修复静默失败，基本一致 |
| 性能优化 | 8/10 | 已修复 Regex/树构建/计时 |
| 代码质量 | 8/10 | 去重 + 常量化后明显改善 |
| **总体** | **7.5/10** | |

---

## 四、待改进（长期）

| 项目 | 方案 | 触发时机 |
|------|------|---------|
| 单 Mutex\<Connection\> 瓶颈 | r2d2-sqlite 连接池 | 并发性能出现实际瓶颈时 |
| CollectionItem 万能结构体 | 拆为 enum + 共享基础字段 | 下次大规模模型变更时 |
| 响应体大小无限制 | 可配置上限（默认 10MB） | 安全加固迭代 |
| 变量名不支持点号 | 正则改为 `[\w.]+` | 环境变量功能增强时 |
