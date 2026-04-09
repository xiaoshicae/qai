# 项目架构规范

## 产品定位

QAI 是**通用 API 测试工具**，UI 功能不为特定项目定制。个人需求通过 `.claude/skills/` 或 Tauri 命令实现。
**禁止硬编码本地路径**，所有文件路径通过 Tauri API 动态获取。

## 依赖方向

```
commands（薄层）→ db, http, runner, ai, report, websocket, pty → models（无依赖）
```

禁止反向依赖。前后端通过 `invoke()` + Tauri Event 通信，前端不直接发 HTTP 请求。

## 新增 Tauri 命令检查清单

1. `commands/<module>_cmd.rs` 添加 `#[tauri::command]`
2. `commands/mod.rs` 添加 `pub mod`
3. `lib.rs` 的 `invoke_handler` 注册
4. 前端 `invoke('<name>', { params })`

## Command 层

薄层：参数校验 → 调用服务层 → 返回结果。禁止内嵌业务逻辑。
去重信号：相同 DB 查询+变量替换+断言流程 → 提取 `prepare_*()`/`finalize_*()`。
编排层数据完整传递，禁止传空字符串替代已有数据。

## MCP 与 Command 共享逻辑

Tauri commands 和 MCP handlers 经常需要相同的业务逻辑（如集合执行编排、搜索、结果保存）。
**禁止两端各自实现**，必须提取到服务层模块供双方调用。

| 共享逻辑 | 提取位置 | 调用方 |
|---------|---------|-------|
| 执行单元构建 + 结果保存 | `runner/orchestrator.rs` | `runner_cmd.rs` + `mcp/handlers.rs` |
| 搜索 | `db/item.rs::search()` | `mcp/handlers.rs` |

新增编排逻辑时先检查：MCP handler 是否也需要？如果是，直接写在服务层。

## 数据一致性

- 批量写入用事务
- DB 保存失败必须记录日志
- 树形查询用 `HashMap<parent_id, Vec<child>>` 预分组

## 文件体积

| 文件类型 | 关注线 | 建议上限 | 硬限 |
|---------|--------|---------|------|
| .rs | 300 | 500 | 800 |
| .tsx | 300 | 500 | 800 |
| .ts | 200 | 400 | 600 |

拆分信号：多个不相关关注点、滚动迷失、频繁冲突、难以命名。
