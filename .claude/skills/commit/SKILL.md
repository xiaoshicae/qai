---
description: 创建 Git 提交
allowed-tools: Bash(git:*, cargo:*, npm:*, npx:*), Read, Glob, Grep, AskUserQuestion
argument-hint: [ commit-message ]
---

# 创建 Git 提交

## 步骤

### 1. 检查状态

```bash
git status && git diff --stat && git diff --cached --stat
```

### 2. 质量检查

仅当有 `.rs` 文件变更时：
```bash
cd src-tauri && cargo check
cd src-tauri && cargo test
```

仅当有 `.ts` / `.tsx` 文件变更时：
```bash
npx tsc --noEmit
```

有错误时询问用户：取消/强制提交。

### 3. 规范合规检查

读取变更 diff，对照 `.claude/rules/` 进行检查：

| 规范来源 | 检查内容 |
|----------|----------|
| architecture.md | 依赖方向、文件放置位置、Tauri 命令注册 |
| rust-patterns.md | unwrap 使用、错误处理、Mutex 使用 |
| react-patterns.md | console.log、直接 fetch、组件结构 |
| security.md | 硬编码凭证、SQL 注入 |

### 4. 暂存并提交

```bash
git add -A
git commit -m "@<类型>: <描述>"
```

## 提交格式

`@<类型>: <描述>`

类型: feat/fix/refactor/docs/test/chore/perf

## 注意事项

- 提交信息使用中文
- 禁止提交敏感信息
- 禁止提交 node_modules 或 target
