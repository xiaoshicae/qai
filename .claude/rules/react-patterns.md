# React 编码规范

## 组件设计

- 函数组件 + TypeScript，UI 基础组件放 `components/ui/`（CVA + Tailwind）
- 组件内代码顺序：imports → props → store/hooks → state → computed → effects → handlers → render
- 命名：组件文件 `kebab-case.tsx`，Store `kebab-case.ts`，类型 `PascalCase`，事件处理 `handle` 前缀

## 状态管理

- 服务端数据通过 Zustand Store + `invoke()` 管理，组件不直接调用 `invoke()`（设置页除外）
- 表单临时状态用 `useState()`，不直接修改 state 引用
- Tauri invoke 参数名用 camelCase，Rust 端自动转 snake_case
- **Store 层每个 `invoke()` 必须 try/catch**，catch 中 `toast.error(invokeErrorMessage(e))`。禁止裸 `await invoke()` 让异常静默上抛

## Tauri Event 监听

组件内 `listen()` 必须在 cleanup 时 `unlisten()`。详见 `tauri-events.md`。

## 工具函数与常量复用

- 通用格式化函数放 `src/lib/formatters.ts`，组件不重复定义
- **样式常量**（`METHOD_COLORS`、`STATUS_*` 等）定义在 `src/lib/styles.ts`
- **业务常量**（`METHOD_OPTIONS`、`EXTRACT_SOURCE_OPTIONS`、`PROTOCOL_OPTIONS` 等）定义在 `src/lib/constants.ts`
- 其他文件 `import` 引用，**禁止各文件重复定义同名常量**
- 相同逻辑的 hook 通过参数合并
- 常用工具：`safeJsonParse`/`getStatusColor`/`cn` from `@/lib/utils`

## 三面板一致性

修改请求编辑相关代码时，**必须检查三处是否同步**：

| 面板 | 文件 |
|------|------|
| 工作台 | `request-panel.tsx` + `request-store.ts` |
| 编辑弹窗 | `collection-overview-edit-parts.tsx` |
| 快速调试 | `quick-test-dialog.tsx` |

必须一致：METHOD_COLORS、VarInput、5 种 Body 类型、单按钮发送（禁止暴露普通/流式选项）、MiniResponseViewer/ResponsePanel、`toast.error(invokeErrorMessage(e))`、⌘+Enter、i18n。

## 性能

- JSX 中避免 IIFE，用 `useMemo` 缓存计算
- `useEffect` 正确声明依赖项，ref 模式添加注释
- 渲染中不创建新对象/数组（提取为常量或 `useMemo`）
- 频繁更新部分隔离为子组件
- 列表用稳定 key（禁止 index），大列表考虑虚拟滚动
- 搜索/筛选加 debounce（300ms），避免重复 invoke 调用
- 路由页面用 `lazy()` + `Suspense` 懒加载

## i18n

- 使用 `react-i18next`，翻译文件 `src/locales/{zh,en}.json`
- 所有用户可见文本走 `t('namespace.key')`，禁止硬编码中文
- key 命名：`<页面>.<用途>`（如 `dashboard.run_all`），插值用 `{{variable}}`
- 禁止在模块顶层常量中调用 `t()`（只能在组件/hook 内），纯函数中 `t` 通过参数传入
- **class 组件（如 ErrorBoundary）不能用 `useTranslation()`**，改用 `import i18n from '@/i18n'` 后 `i18n.t(key)` 调用
- `zh.json` 和 `en.json` 的 key 必须同步

## 安全

- 禁止 `console.log` 记录敏感数据，开发日志用 `import.meta.env.DEV` 守卫
- 禁止 `catch (e: any)`，用 `unknown` + `invokeErrorMessage(e)`

## 资源管理

- `setTimeout`/`setInterval` 必须在组件卸载时清理（`useRef` + cleanup effect）

## 禁止事项

- `console.log` / `fetch` / 直接修改 state 引用 / JSX 中复杂逻辑
- 重复定义工具函数或共享常量（提取到 `lib/`）
- 暴露"普通/流式"发送选项
- Store 中裸 `await invoke()` 无 try/catch
