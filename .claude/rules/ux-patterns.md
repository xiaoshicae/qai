# UX 交互规范

## 快捷键

在 `use-global-shortcuts.ts` 中定义。添加新快捷键时需同步更新 `locales/*.json` 和 `shortcut-help.tsx`。

| 快捷键 | 功能 |
|--------|------|
| `⌘/Ctrl + 1-4` | 切换视图 |
| `⌘/Ctrl + K` | 聚焦搜索 |
| `⌘/Ctrl + N` | 新建请求 |
| `⌘/Ctrl + B` | 切换侧边栏 |
| `⌘/Ctrl + Enter` | 发送请求 |
| `?` | 显示快捷键帮助 |

## 加载状态

- 骨架屏：`Skeleton`/`SkeletonText`/`SkeletonCard`/`SkeletonList`/`SkeletonSettings`（`@/components/ui/skeleton`）
- 页面级：`ViewLoader`（`@/components/ui/view-loader`），支持 `variant="settings"`

## 错误处理

- 全局用 `ErrorBoundary`（`@/components/ui/error-boundary`）
- 提供重试选项，错误详情可折叠

## 自动保存模式

状态机 `idle → saving → saved → idle`，用 500ms debounce + `Cloud`/`CloudOff` 图标指示。
**所有 debounce 自动保存都必须有状态指示**（参考环境变量页和请求名称的 Cloud 图标），禁止无声保存。

## Toast 通知

使用 `sonner`：`toast.success(t('key'))`、`toast.error(t('key'))`。

## 无障碍

- 图标按钮必须有 `aria-label`
- Dialog 必须有 `role="dialog"` + `aria-modal` + `aria-labelledby`
- 所有交互元素支持 Tab 导航，Dialog 支持 Escape 关闭
- **Tooltip 必须支持键盘聚焦**：`onFocus`/`onBlur` 触发显示，添加 `role="tooltip"` + `aria-describedby`

## 表单校验

- **必填字段 `onBlur` 即触发校验**，禁止仅在提交时才报错
- 校验错误在字段旁内联显示（Input 的 `error` prop），不仅依赖 toast
- 典型模式：`const [touched, setTouched] = useState(false)` + `onBlur={() => setTouched(true)}`

## 危险操作防护

- 删除操作必须弹确认（已有规则）
- **数据丢失的状态切换也需确认**：如协议切换（HTTP→WS 丢失 form body）、类型切换等
- **破坏性重置应分级**：优先只清空结果，用户再次点击才全部清空。禁止一键清空所有内容
- 发送前如有异常条件（未解析变量等），弹确认而非仅警告文字

## 可发现性

- **快捷键必须在 UI 中有可见提示**：搜索框 placeholder 显示 ⌘K、按钮 tooltip 显示快捷键
- 搜索/筛选无结果时必须显示空状态提示（`<EmptyState icon={Search}>`），不能留白
- 新增快捷键时同步更新：`use-global-shortcuts.ts` + `locales/*.json` + `shortcut-help.tsx` + UI 提示
