# QAI - AI 驱动的 API 测试工具

## 项目概览

**定位**: 类似 Postman 的桌面 API 测试工具，核心亮点是通过 AI 自动分析代码/文档并生成测试用例。
**技术栈**: Tauri 2.0, Rust, React 19, TypeScript, Vite, Tailwind CSS 4, Zustand, SQLite

## 项目结构

```
qai/
├── .claude/              # Claude Code 配置 (rules, skills, agents)
├── doc/                  # 设计文档
│   └── ui-design-guide.md  # UI 设计规范详解（深色/浅色双主题）
├── src/                  # React 前端
│   ├── main.tsx          # 入口
│   ├── App.tsx           # 根组件, 路由, 主题初始化, ConfirmDialog 挂载
│   ├── index.css         # 全局样式, 主题变量, 效果类 (glass-card, btn-gradient 等)
│   ├── stores/           # Zustand 状态管理
│   │   ├── collection-store.ts  # 集合/树 CRUD
│   │   ├── request-store.ts     # 当前请求状态
│   │   ├── ai-store.ts          # AI 面板状态和消息
│   │   ├── theme-store.ts       # 主题切换 (dark/light/system)
│   │   ├── tabs-store.ts        # 标签页
│   │   └── status-store.ts      # 执行状态
│   ├── components/
│   │   ├── ui/           # 基础 UI 组件 (CVA + Tailwind)
│   │   │   ├── button.tsx        # 按钮 (btn-gradient 默认变体)
│   │   │   ├── input.tsx         # 输入框 (overlay 系统)
│   │   │   ├── textarea.tsx      # 文本域
│   │   │   ├── select.tsx        # 自定义下拉选择（替代原生 select）
│   │   │   ├── confirm-dialog.tsx # 自定义确认弹窗（替代 tauri-plugin-dialog）
│   │   │   ├── dialog.tsx        # 通用弹窗 (glass-card)
│   │   │   ├── card.tsx          # 卡片 (glass-card)
│   │   │   ├── badge.tsx         # 标签
│   │   │   ├── tabs.tsx          # 标签页
│   │   │   └── progress.tsx      # 进度条
│   │   ├── layout/       # AppLayout (三栏可拖拽), Sidebar
│   │   ├── request/      # RequestPanel, KeyValueTable, RunsTab, ExtractRulesEditor
│   │   ├── response/     # ResponsePanel
│   │   ├── assertion/    # AssertionEditor, AssertionResult
│   │   ├── collection/   # CollectionOverview (编辑弹窗, 批量执行)
│   │   ├── runner/       # RunnerPanel, ChainRunnerPanel
│   │   ├── tree/         # CollectionTree
│   │   └── ai/           # AIPanel, AIGenerateDialog
│   ├── views/            # 路由页面
│   │   ├── workbench-view.tsx    # 主工作台
│   │   ├── settings-view.tsx     # 设置 (主题切换 + AI 配置)
│   │   ├── environments-view.tsx # 环境变量管理
│   │   ├── history-view.tsx      # 请求历史
│   │   └── runner-view.tsx       # 批量执行入口
│   ├── types/            # TypeScript 类型定义
│   └── lib/              # 工具函数 (cn)
├── src-tauri/            # Rust 后端
│   ├── Cargo.toml        # tauri2, reqwest0.12, rusqlite0.32, uuid, chrono, regex
│   ├── tauri.conf.json   # 窗口 1280x800, titleBarStyle: Overlay
│   └── src/
│       ├── lib.rs        # Tauri Builder, 33 个命令注册
│       ├── models/       # Collection, ApiRequest, Assertion, Execution
│       ├── db/           # SQLite CRUD (init, collection, request, assertion, execution, env)
│       ├── http/         # reqwest 客户端 (execute, to_execution)
│       ├── runner/       # 断言评估引擎, 批量执行器, 链式执行
│       ├── ai/           # AI API 客户端, Prompt 模板, JSON 解析器
│       ├── report/       # HTML 报告生成
│       └── commands/     # Tauri 命令 (collection, request, assertion, runner, ai, env)
└── package.json
```

## 核心配置

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 前端端口 | 5173 | Vite 开发服务器 |
| 窗口大小 | 1280x800 | Tauri 窗口 |
| 标题栏 | Overlay + hiddenTitle | macOS 原生融合 |
| 数据库 | qai.db | SQLite WAL 模式, Tauri app data 目录 |
| 打包体积 | ~6.6MB | DMG |

## 数据库表

- `collections` (id, name, description, category, endpoint, created_at, updated_at)
- `folders` (id, collection_id, parent_folder_id, name, sort_order)
- `requests` (id, collection_id, folder_id, name, method, url, headers JSON, query_params JSON, body_type, body_content, expect_status, description, sort_order)
- `assertions` (id, request_id, type, expression, operator, expected, enabled)
- `executions` (id, request_id, batch_id, status, response_*, assertion_results JSON)
- `environments` (id, name, is_active, created_at, updated_at)
- `env_variables` (id, environment_id, key, value, enabled)
- `settings` (key, value)

## Tauri 命令 (共 33 个)

集合: list_collections, create_collection, update_collection, update_collection_meta, delete_collection, get_collection_tree, create_folder, get_folder, update_folder, delete_folder
请求: create_request, get_request, update_request, delete_request, send_request, send_request_stream
断言: list_assertions, create_assertion, update_assertion, delete_assertion
执行: run_collection, run_chain, export_report_html, list_history, list_request_runs, get_collection_status
AI: ai_generate_tests, ai_suggest_assertions, ai_chat, save_setting, get_setting_cmd, test_ai_connection
环境: list_environments, create_environment, update_environment, delete_environment, set_active_environment, get_environment_with_vars, save_env_variables

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

已完成: HTTP 客户端, 集合管理, 断言系统, 批量执行, 链式执行, HTML 报告, AI 生成用例, 环境变量, 请求历史, 深色/浅色主题切换, 自定义 UI 组件系统

## 待做 (后续迭代)

- 多标签页系统
- 快捷键 (Cmd+Enter 发送)
- Postman 导入
- 环境变量 `{{variable}}` 替换
- Monaco Editor 代码高亮
- AI 流式响应 (SSE)
- 拖拽排序
