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

## Toast 通知

使用 `sonner`：`toast.success(t('key'))`、`toast.error(t('key'))`。

## 无障碍

- 图标按钮必须有 `aria-label`
- Dialog 必须有 `role="dialog"` + `aria-modal` + `aria-labelledby`
- 所有交互元素支持 Tab 导航，Dialog 支持 Escape 关闭
