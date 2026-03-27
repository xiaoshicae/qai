# Claude Code 项目级指引

本文件是 `.claude/` 目录下的补充说明，帮助 Claude Code 快速理解项目上下文。

## 核心文档入口

| 文档 | 路径 | 内容 |
|------|------|------|
| 项目总览 | `/CLAUDE.md` | 项目结构、命令、数据库、Tauri 命令一览 |
| UI 设计规范 | `@doc/ui-design-guide.md` | 设计方法论、配色、效果类、双主题实现详解 |
| UI 开发约束 | `@.claude/rules/ui-design.md` | overlay 色系统、禁止写法、组件检查清单 |

## 编码时必须遵守的 UI 约束

1. **半透明叠加用 `overlay`** — `bg-overlay/[0.04]` 而非 `bg-white/[0.04]`。overlay 在深色模式为白，浅色模式为黑，确保两种主题都能正常显示。
2. **禁止原生 `<select>`** — 用 `@/components/ui/select.tsx`
3. **禁止 `tauriConfirm`** — 用 `useConfirmStore`（`@/components/ui/confirm-dialog.tsx`）
4. **卡片用 `glass-card`** — 自动适配双主题的毛玻璃效果
5. **按钮默认用 `btn-gradient`** — 渐变主色按钮，已内置到 Button 组件

## Rules 目录说明

```
.claude/rules/
├── architecture.md        # 分层架构、依赖方向、文件体积规范
├── rust-patterns.md       # Rust 错误处理、数据库操作、命名约定
├── react-patterns.md      # 组件设计、状态管理、前后端通信
├── ui-design.md           # UI 设计规范（双主题、overlay 系统、禁止写法）
├── performance.md         # 渲染性能、代码分割、网络优化
├── security.md            # 敏感信息、前端安全、Rust 端安全
├── git-workflow.md        # 分支策略、提交规范、禁止操作
├── testing.md             # 测试策略、Rust 测试、手动验收
└── code-review-strategy.md # 代码审查方法论（边界情况优先）
```
