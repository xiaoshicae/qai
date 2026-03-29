# 项目架构规范

## 产品定位

QAI 是**通用 API 测试工具**，面向所有用户，不为特定项目/团队定制功能。

**核心原则**：
- UI 功能必须通用化、抽象化，不绑定特定数据格式或业务场景
- 个人定制需求（如特定项目的数据导入）通过 `.claude/skills/` 或 Tauri 命令实现，不进入产品 UI
- 新功能设计时问自己：**其他用户也能用到这个功能吗？**

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

## Command 层设计原则

Commands 是前后端桥接的**薄层**，不包含业务逻辑：

```
Command 职责: 参数校验 → 调用服务层 → 返回结果
业务逻辑放: runner/, http/, db/ 等服务模块
```

**反模式**: `runner_cmd.rs` 的 `run_collection` 内嵌 100+ 行分拣/编排逻辑。应提取为 `runner::orchestrator`。

### 去重检测信号

以下模式出现时，必须提取公共函数：
- 两个 command 有相同的 DB 查询 + 变量替换 + 断言 + 保存流程 → 提取 `prepare_*()` / `finalize_*()`
- 多处代码用相同的字符串做 `match` / `==` 比较 → 提取为常量模块
- 多个 command 调用同一个下游函数但前置参数组装逻辑一样 → 提取参数构建函数

### 编排层数据完整性

在多步编排流程（如 run_collection 调用 run_chain）中：
- 上下文中已有的数据必须完整传递给下游，禁止传空字符串 / 默认值
- 如果需要聚合额外数据（如 chain 的 name），在编排开始时一次性收集（`HashMap`），不在循环中逐条查询

## 数据一致性

- 批量写入优先使用事务（`conn.execute_batch` 或手动 BEGIN/COMMIT）
- 执行记录保存失败**必须记录日志**，不得 `let _ =` 静默吞掉
- 树形查询使用 `HashMap<parent_id, Vec<child>>` 预分组，避免 O(N²) 扫描

## 文件体积规范

| 文件类型 | 建议上限 | 硬性上限 |
|---------|---------|---------|
| Rust 模块 (.rs) | 300 行 | 400 行 |
| React 组件 (.tsx) | 250 行 | 400 行 |
| TypeScript (.ts) | 200 行 | 300 行 |

超过上限时拆分为子模块/子组件。
