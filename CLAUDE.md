# QAI - AI 驱动的 API 测试工具

## 项目概览

**定位**: 类似 Postman 的桌面 API 测试工具，核心亮点是通过 AI 自动分析代码/文档并生成测试用例。
**技术栈**: Tauri 2.0, Rust, React 19, TypeScript, Vite, Tailwind CSS 4, Zustand, SQLite, i18next, xterm.js, dnd-kit

## 项目结构

```
qai/
├── .claude/              # Claude Code 配置 (rules, skills, agents)
├── doc/                  # 设计文档
│   └── ui-design-guide.md  # UI 设计规范详解（深色/浅色双主题）
├── src/                  # React 前端
│   ├── main.tsx          # 入口
│   ├── App.tsx           # 根组件, 路由, 主题初始化, ConfirmDialog 挂载
│   ├── i18n.ts           # 国际化配置
│   ├── index.css         # 全局样式, 主题变量, 效果类 (glass-card, btn-gradient 等)
│   ├── stores/           # Zustand 状态管理
│   │   ├── collection-store.ts  # 集合/树/分组 CRUD
│   │   ├── request-store.ts     # 当前请求状态
│   │   ├── ai-store.ts          # AI 面板状态和消息
│   │   ├── theme-store.ts       # 主题切换 (dark/light/system)
│   │   ├── tabs-store.ts        # 标签页
│   │   └── status-store.ts      # 执行状态
│   ├── components/
│   │   ├── ui/           # 基础 UI 组件 (CVA + Tailwind, 15 个)
│   │   │   ├── button.tsx, input.tsx, textarea.tsx, select.tsx
│   │   │   ├── confirm-dialog.tsx, dialog.tsx, context-menu.tsx
│   │   │   ├── card.tsx, badge.tsx, tabs.tsx, progress.tsx, empty-state.tsx
│   │   │   ├── json-highlight.tsx, json-editor.tsx
│   │   │   └── var-highlight.tsx, var-input.tsx
│   │   ├── layout/       # AppLayout (三栏可拖拽), Sidebar, EnvSelector
│   │   ├── request/      # RequestPanel, KeyValueTable, RunsTab, ExtractRulesEditor
│   │   ├── response/     # ResponsePanel
│   │   ├── assertion/    # AssertionEditor, AssertionResult
│   │   ├── collection/   # CollectionOverview (编辑弹窗, 批量执行)
│   │   ├── runner/       # RunnerPanel, ChainRunnerPanel
│   │   ├── tree/         # CollectionTree
│   │   ├── terminal/     # TerminalPanel (xterm.js)
│   │   └── ai/           # AIPanel, AIGenerateDialog
│   ├── hooks/            # React Hooks (use-inline-edit)
│   ├── views/            # 路由页面
│   │   ├── workbench-view.tsx    # 主工作台
│   │   ├── settings-view.tsx     # 设置 (主题/语言/AI 配置)
│   │   ├── environments-view.tsx # 环境变量管理
│   │   ├── history-view.tsx      # 请求历史
│   │   └── runner-view.tsx       # 批量执行入口
│   ├── locales/          # 国际化翻译
│   │   ├── zh.json       # 中文
│   │   └── en.json       # 英文
│   ├── types/            # TypeScript 类型定义
│   └── lib/              # 工具函数 (cn, formatters, syntax)
├── src-tauri/            # Rust 后端
│   ├── Cargo.toml        # tauri2, reqwest0.12, rusqlite0.32, tokio, serde, uuid, chrono, regex, portable-pty 等
│   ├── tauri.conf.json   # 窗口 1280x800, titleBarStyle: Overlay
│   └── src/
│       ├── lib.rs        # Tauri Builder, 51 个命令注册
│       ├── models/       # Group, Collection, CollectionItem, Assertion, Execution, Environment + 常量模块
│       ├── db/           # SQLite CRUD (init, collection, item, group, assertion, execution, environment)
│       ├── http/         # reqwest 客户端 (client, stream, request_builder, curl, vars)
│       ├── runner/       # 断言评估引擎, 批量执行器, 链式执行
│       ├── ai/           # AI API 客户端, Prompt 模板, JSON 解析器
│       ├── report/       # HTML 报告生成
│       ├── websocket/    # WebSocket 客户端
│       ├── pty/          # 伪终端会话管理
│       ├── mcp/          # MCP 服务器 (独立二进制)
│       └── commands/     # Tauri 命令 (collection, item, assertion, runner, ai, env, pty, claude, import)
└── package.json
```

## 核心配置

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 前端端口 | 5173 | Vite 开发服务器 |
| 窗口大小 | 1280x800 | Tauri 窗口 |
| 标题栏 | Overlay + hiddenTitle | macOS 原生融合 |
| 数据库 | qai.db | SQLite WAL 模式, Tauri app data 目录 |

## 数据库表

- `groups` (id, name, parent_id, sort_order) — 侧边栏分组，支持嵌套
- `collections` (id, name, description, group_id, sort_order, created_at, updated_at) — 测试集
- `collection_items` (id, collection_id, parent_id, type, name, sort_order, method, url, headers, query_params, body_type, body_content, extract_rules, description, expect_status, poll_config, protocol, created_at, updated_at) — 统一节点 (folder/chain/request)
- `assertions` (id, item_id, type, expression, operator, expected, enabled, sort_order)
- `executions` (id, item_id, collection_id, batch_id, status, request_url, request_method, response_status, response_headers, response_body, response_time_ms, response_size, assertion_results, error_message, executed_at)
- `environments` (id, name, is_active, created_at, updated_at)
- `env_variables` (id, environment_id, key, value, enabled, sort_order)
- `settings` (key, value, updated_at)

## Tauri 命令 (共 51 个)

集合/分组: list_collections, create_collection, update_collection, delete_collection, get_collection_tree, list_groups, create_group, update_group, delete_group, reorder_sidebar
节点: create_item, get_item, update_item, delete_item, send_request, send_request_stream, parse_curl, export_curl, read_file_preview
断言: list_assertions, create_assertion, update_assertion, delete_assertion
执行: run_collection, run_chain, export_report_html, list_history, list_item_runs, get_collection_status
AI: ai_generate_tests, ai_suggest_assertions, ai_chat, save_setting, get_setting_cmd, test_ai_connection
环境: list_environments, create_environment, update_environment, delete_environment, set_active_environment, get_environment_with_vars, save_env_variables
终端: pty_spawn, pty_write, pty_resize, pty_kill, prepare_mcp_config
Claude: claude_send, claude_stop, claude_reset_session
导入: import_yaml_cases

## 断言系统

类型: status_code, json_path, body_contains, response_time, header_contains
操作符: eq, neq, gt, lt, gte, lte, contains, not_contains, exists, matches(正则)

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
@.claude/rules/performance.md
@.claude/rules/security.md
@.claude/rules/git-workflow.md
@.claude/rules/testing.md
@.claude/rules/code-review-strategy.md
@.claude/rules/ui-design.md
@.claude/rules/database.md
@.claude/rules/i18n.md

## UI 设计

**双主题系统**: 支持深色/浅色/跟随系统。核心机制是 `overlay` 色变量（深色=白，浅色=黑）。

详细设计规范和方法论见：@doc/ui-design-guide.md

关键约束：
- 所有半透明叠加用 `overlay` 色，禁止硬编码 `white/black`
- 禁止原生 `<select>` → 用 `@/components/ui/select.tsx`
- 禁止 `tauriConfirm` → 用 `@/components/ui/confirm-dialog.tsx` 的 `useConfirmStore`
- 效果类 `glass-card` / `btn-gradient` / `glow-ring` 自动适配双主题

## 可用 Agents

| Agent | 说明 | 使用场景 |
|-------|------|---------|
| code-reviewer | 全栈代码审查专家 | 代码修改后质量审查 |
| build-error-resolver | 构建错误解决专家 | Rust/TypeScript/Tauri 构建失败时 |
| security-reviewer | 安全漏洞检测专家 | 涉及用户输入、认证、敏感数据的代码 |

## 可用 Skills

| 类别 | 命令 | 说明 |
|------|------|------|
| Git | `/commit` (`/c`) | 创建规范提交（含质量检查） |
| Git | `/push` | 推送到远程（含质量检查） |
| Git | `/pr [target]` | 创建 Pull Request |
| Git | `/ship [target]` | 一键 commit + push + pr |
| Git | `/merge [branch]` | 合并分支到当前分支 |
| Git | `/rebuild` | 从 main 重建当前分支 |
| 质量 | `/lint` | Rust check + TypeScript 类型检查 |
| 质量 | `/build` | 完整 Tauri 构建并分析产物 |
| 质量 | `/check [filter]` | 运行 Rust 测试 |
| 质量 | `/code-review` | 全栈代码审查（Bugbot 策略） |
| 质量 | `/security-review` | 安全审查（OWASP Top 10） |
| 质量 | `/refactor <cmd>` | 代码重构（scan/dedup/extract/deps） |
| 依赖 | `/deps [cmd]` | 依赖安全审计与更新（npm + cargo） |
| 工具 | `/dev` | 启动 Tauri 开发模式 |
| 工具 | `/kill-port <port>` | Kill 端口占用进程 |

## 当前状态 (v0.1.0)

已完成: HTTP 客户端, 集合管理, 分组管理, 断言系统, 批量执行, 链式执行, HTML 报告, AI 生成用例, 环境变量及 `{{variable}}` 替换, 变量提取, 请求历史, 深色/浅色主题切换, 自定义 UI 组件系统, i18n 国际化(中英文), curl 导入/导出, WebSocket 支持, 终端/PTY, MCP 服务器, 拖拽排序, 流式响应

## 待做 (后续迭代)

- 多标签页系统
- 快捷键 (Cmd+Enter 发送)
- Postman 导入
- Monaco Editor 代码高亮
