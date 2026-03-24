# QAI - AI 驱动的 API 测试工具

## 项目概览

**定位**: 类似 Postman 的桌面 API 测试工具，核心亮点是通过 Claude API 自动分析代码/文档并生成测试用例。
**技术栈**: Tauri 2.0, Rust, React 19, TypeScript, Vite, Tailwind CSS 4, Zustand, SQLite

## 项目结构

```
qai/
├── .claude/              # Claude Code 配置 (rules, skills, agents)
├── src/                  # React 前端
│   ├── main.tsx          # 入口
│   ├── App.tsx           # 根组件, 路由 (/, /runner, /settings)
│   ├── stores/           # Zustand (collection, request)
│   ├── components/
│   │   ├── layout/       # AppLayout, Sidebar
│   │   ├── request/      # RequestPanel, KeyValueTable
│   │   ├── response/     # ResponsePanel
│   │   ├── assertion/    # AssertionEditor, AssertionResult
│   │   ├── runner/       # RunnerPanel
│   │   └── ai/           # AIGenerateDialog
│   └── views/            # WorkbenchView, RunnerView, SettingsView
├── src-tauri/            # Rust 后端
│   ├── Cargo.toml        # tauri2, reqwest0.12, rusqlite0.32, uuid, chrono, regex
│   ├── tauri.conf.json   # 窗口 1280x800, identifier com.qai.app
│   └── src/
│       ├── lib.rs        # Tauri Builder, 23个命令注册
│       ├── models/       # Collection, ApiRequest, Assertion, Execution
│       ├── db/           # SQLite CRUD (init, collection, request, assertion, execution)
│       ├── http/         # reqwest 客户端 (execute, to_execution)
│       ├── runner/       # 断言评估引擎, 批量执行器
│       ├── ai/           # Claude API, Prompt 模板, JSON 解析器
│       ├── report/       # HTML 报告生成
│       └── commands/     # Tauri 命令 (collection, request, assertion, runner, ai)
└── package.json
```

## 核心配置

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 前端端口 | 5173 | Vite 开发服务器 |
| 窗口大小 | 1280x800 | Tauri 窗口 |
| 数据库 | qai.db | SQLite WAL 模式, Tauri app data 目录 |
| 打包体积 | ~6.6MB | DMG |

## 数据库表

- `collections` (id, name, description, created_at, updated_at)
- `folders` (id, collection_id, parent_folder_id, name, sort_order)
- `requests` (id, collection_id, folder_id, name, method, url, headers JSON, query_params JSON, body_type, body_content)
- `assertions` (id, request_id, type, expression, operator, expected, enabled)
- `executions` (id, request_id, batch_id, status, response_*, assertion_results JSON)
- `settings` (key, value)

## Tauri 命令 (共 23 个)

集合: list_collections, create_collection, update_collection, delete_collection, get_collection_tree, create_folder, delete_folder
请求: create_request, get_request, update_request, delete_request, send_request
断言: list_assertions, create_assertion, update_assertion, delete_assertion
执行: run_collection, export_report_html
AI: ai_generate_tests, ai_suggest_assertions, ai_chat, save_setting, get_setting_cmd

## 断言系统

类型: status_code, json_path, body_contains, response_time, header_contains
操作符: eq, neq, gt, lt, gte, lte, contains, not_contains, exists, matches(正则)

## 常用命令

```bash
cargo tauri dev                     # 开发模式 (热重载)
cargo tauri build                   # 生产构建 (DMG + App)
cd src-tauri && cargo test          # Rust 测试 (6个)
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

已完成 MVP: HTTP 客户端, 集合管理, 断言系统, 批量执行, HTML 报告, AI 生成用例

## 待做 (后续迭代)

- 多标签页系统
- 快捷键 (Cmd+Enter 发送)
- 深色/浅色主题切换
- Postman 导入
- 环境变量 `{{variable}}` 替换
- Monaco Editor 代码高亮
- AI 流式响应 (SSE)
- 请求历史记录
- 拖拽排序
