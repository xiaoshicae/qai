---
description: 代码重构（扫描/去重/提取/依赖分析）
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(npx tsc:*, cargo check:*, cargo test:*, wc:*)
argument-hint: <scan|dedup|extract|deps> [path|pattern]
---

# 代码重构工具

参数: $ARGUMENTS

## 子命令

| 子命令 | 用途 | 示例 |
|--------|------|------|
| `scan` | 扫描代码质量问题（大文件/复杂度） | `/refactor scan src/` |
| `dedup` | 消除重复代码 | `/refactor dedup request` |
| `extract` | 拆分大文件或提取公共代码 | `/refactor extract src/components/request/request-panel.tsx` |
| `deps` | 分析模块依赖关系 | `/refactor deps src-tauri/src/` |

## scan - 代码质量扫描

扫描以下问题：

| 类型 | 阈值（Rust） | 阈值（React） | 说明 |
|------|-------------|--------------|------|
| 大文件 | >400 行 | >400 行 | 应拆分 |
| `unwrap()` | 0（生产代码） | - | 应使用 `?` 或 `unwrap_or` |
| `any` 类型 | - | 0 | 应使用具体类型 |
| `console.log` | - | 0 | 生产代码不留调试日志 |
| `println!` | 0（生产代码） | - | 应使用 log 宏 |

```bash
# Rust 文件按行数排序
wc -l src-tauri/src/**/*.rs 2>/dev/null | sort -rn | head -20

# React 文件按行数排序
wc -l src/**/*.tsx src/**/*.ts 2>/dev/null | sort -rn | head -20
```

然后用 Grep 搜索 `unwrap()`、`any` 类型、`console.log`、`println!`。

## dedup - 消除重复

识别重复的组件、函数、模式，提取为公共代码。

判断标准：
- 相同代码 >= 3 处：必须提取
- 相同代码 2 处且 > 20 行：建议提取

## extract - 提取与拆分

- Rust 文件 > 400 行：按功能拆分为子模块
- React 组件 > 400 行：提取为独立子组件
- 重复逻辑 > 10 行：提取为自定义 Hook 或工具函数

## deps - 依赖分析

**Rust 端**检查：
- 依赖方向：commands → db, http, runner, ai → models
- 禁止反向依赖：models 不依赖其他模块
- 循环依赖检测

**React 端**检查：
- 依赖方向：views → components → stores → (无依赖)
- 禁止反向依赖：stores 不导入 views/components
- 循环依赖检测

## 重构原则

- 单一职责、不破坏功能、小步迭代
- 每次修改后验证：`npx tsc --noEmit` && `cd src-tauri && cargo check`
- 不在重构中添加新功能

## 用法

```
/refactor scan                              # 扫描整个项目
/refactor scan src-tauri/src/               # 扫描 Rust 代码
/refactor dedup request                     # 查找 request 相关重复代码
/refactor extract src-tauri/src/runner/evaluator.rs  # 拆分大文件
/refactor deps src/                         # 分析前端依赖关系
```

## 经验沉淀

重构完成后，回顾本次发现的问题模式，判断是否有**可泛化的规律性教训**应写入 `.claude/rules/`：

- 对照 `architecture.md`、`rust-patterns.md`、`react-patterns.md` 现有规则
- 如果某类代码坏味道反复出现但 rules 中未覆盖 → 新增规则条目
- 如果某条现有规则表述不够具体导致遗漏 → 补充细化
- 输出一张"现有 rules 覆盖 vs 缺失"对照表，标注需要新增/强化的条目
- 确认后更新对应 rules 文件
