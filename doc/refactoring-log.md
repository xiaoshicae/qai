# 代码重构记录 (2026-03-29)

## 概要

本次重构聚焦 **消除代码重复** 和 **性能优化**，不改变任何功能行为。

---

## 已完成

### 1. DbState.conn() 便捷方法

**问题**: `db.0.lock().map_err(|e| e.to_string())?` 在 7 个文件中出现 44 次。

**方案**: 在 `DbState` 上新增 `conn()` 方法封装锁获取和错误转换。

**影响范围**: `db/init.rs` + 7 个 command 文件

```rust
// 之前（44 处）
let conn = db.0.lock().map_err(|e| e.to_string())?;

// 之后
let conn = db.conn()?;
```

---

### 2. 提取 formatDuration / formatSize 到 lib/formatters.ts

**问题**: `formatTime(ms)` 在 4 个组件中重复定义，`formatSize(bytes)` 在 2 个组件中重复定义。

**方案**: 创建 `src/lib/formatters.ts`，导出 `formatDuration` 和 `formatSize`，所有组件统一引用。

**影响范围**: `response-panel.tsx`, `runner-panel.tsx`, `chain-runner-panel.tsx`, `collection-overview.tsx`

**附带优化**: `ScenarioRow` 和 `StepRow` 不再通过 prop 接收 `formatTime`，改为直接 import。

---

### 3. 合并 useResizable 和 useResizableRight

**问题**: `app-layout.tsx` 中两个 hook 逻辑完全相同，仅 delta 计算方向不同（左拖 vs 右拖）。

**方案**: 合并为 `useResizable(initial, min, max, reverse?)` 单一 hook。

**影响范围**: `app-layout.tsx`（减少 ~30 行）

---

### 4. 清理 Rust 无用代码

| 文件 | 清理内容 |
|------|---------|
| `import_cmd.rs` | 移除未使用字段 `model`, `subcategory`, `stream` |
| `curl.rs` | 修复重复的 match arm（`-o`, `-w` 同时出现在无参数和有参数分支） |
| `mcp/server.rs` | 移除未使用的 `Value` import |
| `mcp/protocol.rs` | `jsonrpc` 字段加 `#[allow(dead_code)]`（反序列化必需但不读取） |

---

### 5. 提取请求 body 构建到 http/request_builder.rs

**问题**: `client.rs` 和 `stream.rs` 中 method 构建 + headers + query params + body 处理代码几乎完全重复（~80 行）。且 `stream.rs` 缺少 `form-data`/`urlencoded` 支持。

**方案**: 创建 `http/request_builder.rs`，导出 `build_request()` 函数统一处理。`client.rs` 和 `stream.rs` 都调用它。

**影响范围**: `http/client.rs`, `http/stream.rs`, 新增 `http/request_builder.rs`

**附带收益**: `stream.rs` 现在也支持 `form-data` 和 `urlencoded` body 类型。

---

### 6. 提取断言评估公共函数

**问题**: "评估断言 → 判断 pass/fail → 设置 status" 的 7 行代码块在 4 个地方重复（`item_cmd.rs` x2, `batch.rs`, `chain.rs`）。

**方案**: 在 `runner/assertion.rs` 中新增 `apply_assertions(result, assertions)` 函数。

**影响范围**: `item_cmd.rs`, `batch.rs`, `chain.rs`

---

### 7. 优化 run_collection N+1 查询

**问题**: `run_collection` 先查所有 items，然后 for 循环逐个查 assertions。N 个用例 = N+1 次数据库查询。

**方案**:
- 在 `db/assertion.rs` 新增 `list_by_items(conn, item_ids)` 批量查询方法
- `run_collection` 和 `run_chain` 改为一次批量查询所有 assertions

**性能提升**: 100 个用例从 101 次查询降为 2 次查询。

---

### 8. 后端架构审查修复 (2026-03-29)

一次性修复 9 个后端架构问题：

| 问题 | 级别 | 修复方式 |
|------|------|---------|
| chain_item_name 为空 | P0 | runner_cmd.rs 传入实际链名称 |
| 执行记录保存静默失败 | P0 | `let _ =` → `log::warn!` |
| Regex 每次编译 | P1 | `OnceLock` 缓存正则 |
| batch total_time 语义错误 | P1 | 改为 `Instant::now().elapsed()` |
| update_item 13 个参数 | P1 | `UpdateItemPayload` 结构体 |
| 状态字符串硬编码 | P2 | `models::status` / `models::item_type` 常量 |
| send_request 代码重复 | P2 | 提取 `prepare_request()` + `finalize_result()` |
| 树形构建 O(N²) | P2 | HashMap 预分组，O(N) |

**规范更新**: `.claude/rules/rust-patterns.md`（OnceLock 缓存、错误记录、Payload 结构体）、`.claude/rules/architecture.md`（Command 层原则、数据一致性）、新增 `doc/backend-review.md`。

---

## 待完成

| 任务 | 优先级 | 说明 |
|------|--------|------|
| 提取 `<ContextMenu>` 组件 | 中 | sidebar 和 collection-tree 的右键菜单去重 |
| 提取 `useInlineEdit` hook | 中 | sidebar 和 collection-tree 的内联重命名去重 |
| 拆分 `collection-overview.tsx` (1230行) | 高 | 远超 400 行上限，需拆为子组件 |
| 拆分 `sidebar.tsx` (480行) | 中 | 提取拖拽/菜单逻辑 |
| 拆分 `settings-view.tsx` (384行) | 低 | 按区块拆子组件 |
| 单 Mutex\<Connection\> 瓶颈 | 中 | 改用连接池或 RwLock |
| CollectionItem 万能结构体 | 低 | 拆为 enum + 共享基础字段 |
| 响应体大小限制 | 低 | 添加可配置的上限（默认 10MB） |

---

## 规范更新

本次重构同步更新了以下规范文件：

- `.claude/rules/rust-patterns.md` — 新增 `db.conn()` 规范、禁止直接 `db.0.lock()`、请求构建和断言评估去重规范
- `.claude/rules/react-patterns.md` — 新增工具函数复用规范、禁止重复定义格式化函数
