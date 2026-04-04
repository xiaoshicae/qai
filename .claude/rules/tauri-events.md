# Tauri 事件通信规范

## 核心原则：所有 listener 必须过滤

`emit()`/`listen()` 是全局广播。必须在回调中按 ID 过滤：

| 事件 | 过滤字段 |
|------|---------|
| `stream-chunk` | `item_id` |
| `execution-result` | `item_id` 或 `batch_id` |
| `test-progress` | `batch_id` |
| `chain-progress` | `item_id`（chain ID） |

## Listener 生命周期

- 所有 listener 存入 `unlistenRef`，`cleanup()` 统一清理
- `collectionId` 变化时清理旧 listener
- 过滤用的 ID 集合/变量用 ref（避免闭包捕获旧值）

## 检查清单

- [ ] 回调首行有 `if (!match) return` 过滤
- [ ] 过滤 ID 用 ref 而非闭包旧值
- [ ] 组件卸载时有兜底清理
- [ ] `await listen(...)` 注册前的事件丢失是否可接受

## Cancel Token

当前限制：一次只运行一个集合。`cancel_run` 影响全局 `AtomicBool`。
