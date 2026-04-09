# QAI - AI 驱动的 API 测试工具

## 项目概览

**定位**: 类似 Postman 的桌面 API 测试工具，核心亮点是通过 AI 自动分析代码/文档并生成测试用例。
**技术栈**: Tauri 2.0, Rust, React 19, TypeScript, Vite, Tailwind CSS 4, Zustand, SQLite, i18next, xterm.js, dnd-kit

## 核心配置

| 配置项  | 值        | 说明                               |
|------|----------|----------------------------------|
| 前端端口 | 5173     | Vite 开发服务器                       |
| 窗口大小 | 1280x800 | titleBarStyle: Overlay           |
| 数据库  | qai.db   | SQLite WAL 模式, Tauri app data 目录 |

## 常用命令

```bash
cargo tauri dev                     # 开发模式 (热重载)
cargo tauri build                   # 生产构建 (DMG + App)
cd src-tauri && cargo test          # Rust 测试
cd src-tauri && cargo check         # Rust 编译检查
npx tsc --noEmit                    # TypeScript 类型检查
npm run build                       # 仅构建前端
```

## 关键设计决策

- **前后端通信**: 前端通过 `invoke()` + Tauri Event，禁止前端直接发 HTTP 请求
- **数据库**: SQLite WAL 模式，`collection_items` 统一树结构（folder/chain/request）
- **主题**: 双主题（dark/light），半透明叠加用 `overlay` 色，状态色用语义变量
- **国际化**: `react-i18next`，所有用户可见文本走 `t()`，zh/en key 必须同步

## 开发规范

**经验沉淀**: 每次犯错或发现规律性问题时，总结并写入 `.claude/rules/` 对应规范文件。

| 规范文件                      | 覆盖范围     | 关键要点                          |
|---------------------------|----------|-------------------------------|
| `architecture.md`         | 项目架构     | 依赖方向、Command 薄层、文件体积限制        |
| `rust-patterns.md`        | Rust 编码  | 错误处理、DB 操作模式、serde 序列化        |
| `react-patterns.md`       | React 编码 | 组件设计、状态管理、三面板一致性、i18n         |
| `ui-design.md`            | UI 设计约束  | overlay 色系、语义颜色、禁止写法速查        |
| `ux-patterns.md`          | 交互规范     | 快捷键、加载状态、自动保存、无障碍             |
| `database.md`             | 数据库设计    | 统一树结构、时间用 localtime           |
| `security.md`             | 安全规范     | API Key 存储策略、SQL 参数化、CSP      |
| `state-management.md`     | 状态管理     | Zustand 全局 vs 本地、运行队列、stopRun |
| `tauri-events.md`         | 事件通信     | listener 必须过滤、生命周期管理          |
| `git-workflow.md`         | Git 工作流  | 提交格式 `@<类型>: <描述>`、提交前检查      |
| `testing.md`              | 测试规范     | Rust 单元/集成测试、手动验收清单           |
| `code-review-strategy.md` | 代码审查     | 边界优先、追踪副作用链、必报 vs 忽略          |
| `dev-workflow.md`         | 开发服务器    | 启动前关闭正式版 APP、端口检查             |

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
@.claude/rules/ux-patterns.md
@.claude/rules/dev-workflow.md

## 扩展资料

- 详细 UI 设计方法论：@.claude/doc/ui-design-guide.md
- 数据库表结构定义：`src-tauri/src/db/init.rs`

## 暂时隐藏的功能

| 功能    | 位置                                 | 说明                |
|-------|------------------------------------|-------------------|
| AI 助手 | `src/views/settings-ai-config.tsx` | 已注释隐藏，开发完成后取消注释恢复 |