---
description: Rust 后端架构审查与优化（错误处理/资源管理/并发/性能）
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(cargo:*, wc:*), Agent
argument-hint: [--fix | --report | 模块路径 | 关注点]
---

# Rust 后端架构审查与优化

$ARGUMENTS

---

参数说明：
- 无参数：扫描全部后端代码，生成报告并修复
- `--report`：仅生成报告，不做修改
- `--fix`：扫描并自动修复所有发现的问题
- 模块路径：如 `commands/` `http/` `runner/`，缩小扫描范围
- 关注点：如 `错误处理` `并发` `资源管理`，聚焦特定维度

与 `/code-review`（增量 diff 审查）不同，本技能聚焦**全局架构问题**和**跨模块模式缺陷**。

## 1. 全局扫描

使用 Explore Agent 全面阅读 `src-tauri/src/` 源码，按以下维度逐一评估：

| 维度 | 关注点 | 典型问题 |
|------|--------|----------|
| 错误处理 | 统一错误类型？`.map_err(\|e\| e.to_string())` 泛滥？ | 错误分类丢失，前端无法差异化处理 |
| 资源生命周期 | 进程 handle 是否保留？fd/socket 是否及时关闭？ | 僵尸进程、socket 泄漏、无限制缓冲区 |
| 并发安全 | Mutex 粒度是否合理？异步中是否长时间持锁？ | 多个相关字段用多个独立 Mutex → 竞态 |
| 数据一致性 | 批量写入有事务？迁移错误被吞掉？ | 部分写入 → 数据不一致 |
| 超时控制 | 网络连接有超时？轮询间隔是否漂移？ | 慢服务器无限挂起 |
| 正则/模式 | 静态缓存？匹配范围是否覆盖所有合法输入？ | `\w+` 漏匹配含 `-`/`.` 的变量名 |
| Command 层 | 薄层？参数校验 → 调服务 → 返回？ | 业务逻辑混入 Command，文件超限 |

## 2. 深入审查

对每个模块，读取完整代码（不仅看文件名），记录：
- **具体行号和代码片段**
- 问题分类（P0/P1/P2）
- 影响范围和修复工作量

### P0 必修（影响正确性/安全性）
- 错误信息丢失（String 化导致无法分类）
- 批量操作无事务（部分失败 → 数据不一致）
- 资源泄漏（进程僵尸、socket 未关闭、无限制缓冲区）
- 无超时（网络连接/轮询可能永久挂起）

### P1 建议修复（影响健壮性）
- 迁移错误静默吞掉（`let _ = conn.execute(...)`）
- 输入模式不完整（正则/变量名匹配范围不足）
- 单连接瓶颈（Mutex<Connection> 串行所有 DB 访问）

### P2 可选优化（影响可维护性）
- 多个独立 Mutex 应合并为单 Mutex<Inner>
- 轮询间隔漂移（sleep vs interval）
- Command 层过厚（应提取服务层）
- 缺少集成测试

## 3. 生成优先级矩阵

输出表格：

| 优先级 | 问题 | 收益 | 工作量 | 涉及文件 |
|--------|------|------|--------|----------|
| P0 | ... | ... | 小/中/大 | ... |

如果是 `--report` 模式，到此结束。

## 4. 逐项修复（--fix 或默认模式）

用户确认后，按优先级逐项修复。每项修复遵循：

1. 创建 Task 跟踪进度
2. 读取完整文件（不盲改）
3. 最小化变更，不附带无关重构
4. 每项修复后 `cargo check` 验证编译
5. 全部完成后 `cargo test` 验证测试

### 常见修复模式参考

**统一错误类型**（thiserror + Serialize for Tauri IPC）：
```rust
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")] Db(#[from] rusqlite::Error),
    #[error("{0}")] Http(#[from] reqwest::Error),
    #[error("{0}")] Generic(String),
}
impl From<String> for AppError { ... }  // 兼容旧代码
impl serde::Serialize for AppError { ... }  // Tauri IPC
```

**批量操作加事务**：
```rust
let tx = conn.unchecked_transaction()?;
for item in &items { tx.execute("...", ...)?; }
tx.commit()?;
```

**资源限制读取**（防 OOM）：
```rust
const MAX_STDERR_BYTES: usize = 1024 * 1024;
async fn read_stderr_limited(child: &mut Child) -> String { ... }
```

**连接超时**：
```rust
tokio::time::timeout(Duration::from_secs(15), connect_async(&url)).await??
```

**轮询防漂移**（interval 替代 sleep）：
```rust
let mut ticker = tokio::time::interval(dur);
loop { ticker.tick().await; /* request */ }
```

**多 Mutex → 单 Mutex<Inner>**：
```rust
struct FooInner { writer: ..., reader: ..., child: ... }
struct FooState(Mutex<FooInner>);
```

**迁移错误区分处理**：
```rust
if let Err(e) = conn.execute(sql, []) {
    if !e.to_string().contains("duplicate column") {
        log::warn!("迁移失败: {sql} → {e}");
    }
}
```

## 5. 验证

```bash
cd src-tauri && cargo check      # 编译通过
cd src-tauri && cargo test       # 测试全过
npm run build                    # 前端不受影响
```

## 6. 经验沉淀

修复完成后，回顾本次发现的问题，判断是否有**可泛化的规律性教训**应写入 `.claude/rules/`：

- 对照 `rust-patterns.md`、`architecture.md`、`security.md`、`database.md` 现有规则
- 如果某类问题反复出现但 rules 中未覆盖 → 新增规则条目
- 如果某条现有规则表述不够具体导致遗漏 → 补充细化
- 输出一张"现有 rules 覆盖 vs 缺失"对照表，标注需要新增/强化的条目
- 确认后更新对应 rules 文件
