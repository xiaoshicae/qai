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

## 全局（模块级）Listener

Store 或模块中的全局 listener 必须提供 `destroy` 函数，在应用卸载时调用：

```typescript
// ✅ 正确模式
let unlistenFn: (() => void) | null = null
export function initXxxListener() {
  if (initialized) return
  initialized = true
  listen('event', handler).then((fn) => { unlistenFn = fn })
}
export function destroyXxxListener() {
  unlistenFn?.()
  unlistenFn = null
  initialized = false
}

// App.tsx 中配对调用
useEffect(() => { initXxxListener(); return destroyXxxListener }, [])
```

**禁止** `listen()` 返回值被丢弃（`let _ = listen(...)`），这会导致内存泄漏。

## 检查清单

- [ ] 回调首行有 `if (!match) return` 过滤
- [ ] 过滤 ID 用 ref 而非闭包旧值
- [ ] 组件卸载时有兜底清理
- [ ] `await listen(...)` 注册前的事件丢失是否可接受
- [ ] 全局 listener 有配对的 `destroy` 函数

## Cancel Token

当前限制：一次只运行一个集合。`cancel_run` 影响全局 `AtomicBool`。
