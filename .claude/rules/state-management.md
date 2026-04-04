# 状态管理规范

## 全局 vs 本地

| 全局 store | 本地 state |
|-----------|-----------|
| 多组件共享、跨集合保持、async 需最新值 | 切换后应重置、UI 局部 |

**规则**：跨集合/组件共享的配置放 Zustand store。

## Async 闭包读取 Store

React hooks 解构值是渲染快照。async 函数必须用 `store.getState()` 在调用时读最新值：

```typescript
const runAll = async () => {
  const { runMode } = useRunConfigStore.getState()  // 不依赖闭包
}
```

## 运行队列（useRunQueueStore）

```
enqueue([A,B,C]) → 检测队首 → startRun → runAll → finishRun → 下一个
```

关键约束：
1. 一次只运行一个集合
2. `stopRun` 清空整个队列
3. 自动导航由 workbench-view 负责
4. `finishRun()` 必须在所有退出路径调用（否则队列卡死）
5. tree 未加载时 early return

## stopRun

并发模式：`cancel_run` → cancel_token 生效
顺序模式：`cancel_run` + `abortRef.current = true` → 下次循环 break（当前请求不会立即中断）
两种都需：清理 listener + 清空队列 + `setRunning(false)`
