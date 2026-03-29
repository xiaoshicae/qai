# React 编码规范

## 组件设计

- 使用函数组件 + TypeScript
- UI 基础组件放 `components/ui/`，基于 Tailwind CSS + CVA
- 组件内代码顺序：imports → props → store/hooks → state → computed → effects → handlers → render

```tsx
// 1. imports
import { useState, useEffect, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'

// 2. props
interface Props { requestId: string }

export default function MyComponent({ requestId }: Props) {
  // 3. store / hooks
  const store = useRequestStore()

  // 4. local state
  const [loading, setLoading] = useState(false)

  // 5. derived / computed
  const isValid = useMemo(() => ..., [deps])

  // 6. effects
  useEffect(() => { ... }, [requestId])

  // 7. handlers
  async function handleSubmit() { ... }

  // 8. render
  return <div>...</div>
}
```

## 状态管理

- 服务端数据通过 Zustand Store + `invoke()` 管理
- Store 负责调用 Tauri 命令和缓存数据
- 组件不直接调用 `invoke()`，统一走 Store（设置页等简单场景除外）
- 表单临时状态用 `useState()` 在组件内管理
- 不要直接修改 state 对象引用，始终创建新对象

## 前后端通信

```typescript
// Store 中封装 invoke 调用
loadRequest: async (id: string) => {
  const req = await invoke<ApiRequest>('get_request', { id })
  set({ currentRequest: req })
}

// 注意：Tauri invoke 参数名必须是 camelCase，Rust 端自动转 snake_case
await invoke('create_request', {
  collectionId: '...',    // Rust 端接收为 collection_id
  folderId: null,
})
```

## Tauri Event 监听

```typescript
import { listen } from '@tauri-apps/api/event'

// 组件内监听，cleanup 时取消
useEffect(() => {
  let unlisten: (() => void) | undefined
  listen<ProgressPayload>('test-progress', (event) => {
    // 处理进度
  }).then((fn) => { unlisten = fn })
  return () => { unlisten?.() }
}, [])
```

## 命名约定

| 类型 | 规则 | 示例 |
|------|------|------|
| 组件文件 | kebab-case.tsx | `request-panel.tsx` |
| Store 文件 | kebab-case.ts | `collection-store.ts` |
| 类型/接口 | PascalCase | `ApiRequest` |
| 事件处理 | handle 前缀 | `handleSubmit` |

## 工具函数复用

- 通用格式化函数（时间、文件大小等）放 `src/lib/formatters.ts`，组件不重复定义
- 相同逻辑的 hook（如方向不同的拖拽）通过参数合并，不写两个 hook
- 通过 prop 传递的纯工具函数，如果无闭包依赖，应改为子组件直接 import

```typescript
// 错误：在每个组件内重复定义
const formatTime = (ms: number) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`

// 正确：从 lib/formatters.ts 导入
import { formatDuration, formatSize } from '@/lib/formatters'
```

## 禁止事项

- 生产代码中留 `console.log`
- 组件中直接调用 `fetch`（所有网络请求走 Rust 端）
- 直接修改 state 引用（`a.type = x` 后 `setX([...arr])`）
- 在 JSX 中写复杂逻辑（提取为 useMemo 或函数）
- 在多个组件中重复定义相同的工具函数（提取到 `lib/`）
