# QAI - AI 驱动的 API 测试工具

## 项目概览

**定位**: 类似 Postman 的桌面 API 测试工具，核心亮点是通过 AI 自动分析代码/文档并生成测试用例。
**技术栈**: Tauri 2.0, Rust, React 19, TypeScript, Vite, Tailwind CSS 4, Zustand, SQLite, i18next, xterm.js, dnd-kit

## 核心配置

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 前端端口 | 5173 | Vite 开发服务器 |
| 窗口大小 | 1280x800 | titleBarStyle: Overlay |
| 数据库 | qai.db | SQLite WAL 模式, Tauri app data 目录 |

## 常用命令

```bash
cargo tauri dev                     # 开发模式 (热重载)
cargo tauri build                   # 生产构建 (DMG + App)
cd src-tauri && cargo test          # Rust 测试
cd src-tauri && cargo check         # Rust 编译检查
npx tsc --noEmit                    # TypeScript 类型检查
npm run build                       # 仅构建前端
```

## 开发规范

**经验沉淀**: 每次犯错或发现规律性问题时，总结并写入 `.claude/rules/` 对应规范文件。

@.claude/rules/architecture.md
@.claude/rules/rust-patterns.md
@.claude/rules/react-patterns.md
@.claude/rules/security.md
@.claude/rules/git-workflow.md
@.claude/rules/testing.md
@.claude/rules/code-review-strategy.md
@.claude/rules/ui-design.md
@.claude/rules/database.md
@.claude/rules/tauri-events.md
@.claude/rules/state-management.md

详细 UI 设计方法论见：@doc/ui-design-guide.md

## 暂时隐藏的功能

| 功能 | 位置 | 说明 |
|------|------|------|
| AI 助手 | `src/views/settings-ai-config.tsx` | 已注释隐藏，开发完成后取消注释恢复 |
