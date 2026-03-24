# 项目架构规范

## 分层架构

```
src/                     # React 前端 (UI 层)
├── views/               # 页面级组件 (路由对应)
├── components/          # 通用组件 (按功能域分目录)
│   └── ui/              # 基础 UI 组件 (Button, Input, Tabs...)
├── stores/              # Zustand 状态管理 (通过 invoke 调 Rust)
├── types/               # TypeScript 类型定义
└── lib/                 # 工具函数

src-tauri/src/           # Rust 后端 (核心引擎)
├── commands/            # Tauri 命令 (前后端桥接, 薄层)
├── db/                  # 数据库 CRUD (SQLite)
├── models/              # 数据模型 (Serialize/Deserialize)
├── http/                # HTTP 客户端 (reqwest)
├── runner/              # 测试执行引擎 (断言评估, 批量执行)
├── ai/                  # AI 集成 (Claude API, Prompt, 解析)
└── report/              # 报告生成 (HTML)
```

## 依赖方向

```
commands → db, http, runner, ai, report → models
                                        ↑ (models 无依赖)
```

**禁止反向依赖**：
- models 不依赖任何其他模块
- db 不依赖 commands
- http/runner/ai 不依赖 commands

## 前后端通信

- 所有前后端通信通过 Tauri `invoke()` 调用 `#[tauri::command]`
- 前端不直接发 HTTP 请求（避免跨域），所有外部 HTTP 请求在 Rust 端执行
- 实时通信通过 Tauri Event (`app.emit()` + `listen()`)

## 新增 Tauri 命令检查清单

1. [ ] `src-tauri/src/commands/<module>_cmd.rs` 添加 `#[tauri::command]` 函数
2. [ ] `src-tauri/src/commands/mod.rs` 添加 `pub mod`
3. [ ] `src-tauri/src/lib.rs` 的 `invoke_handler` 中注册命令
4. [ ] 前端通过 `invoke('<command_name>', { params })` 调用

## 文件体积规范

| 文件类型 | 建议上限 | 硬性上限 |
|---------|---------|---------|
| Rust 模块 (.rs) | 300 行 | 400 行 |
| React 组件 (.tsx) | 250 行 | 400 行 |
| TypeScript (.ts) | 200 行 | 300 行 |

超过上限时拆分为子模块/子组件。
