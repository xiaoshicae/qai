---
description: 推送到远程仓库（含质量检查）
allowed-tools: Bash(git:*, cargo:*, npm:*, npx:*), Read, Glob, Grep, AskUserQuestion
argument-hint: ""
---

# 推送到远程仓库

## 执行步骤

### 1. 检查当前状态

```bash
git status
git branch --show-current
git log --oneline -5
```

如有未提交变更，提示先 `/commit`。

### 2. 质量检查

#### 2.1 Rust 编译 + 测试

```bash
cd src-tauri && cargo check && cargo test
```

#### 2.2 前端类型检查

```bash
npx vue-tsc --noEmit
```

#### 2.3 安全扫描

检查 `src/` 和 `src-tauri/src/` 下是否有硬编码凭证：

| 模式 | 说明 |
|------|------|
| `api[_-]?key\s*[:=]\s*["'][^"']{8,}` | 硬编码 API Key |
| `sk-[a-zA-Z0-9]{20,}` | OpenAI/Anthropic 风格密钥 |

### 3. 推送

```bash
git push -u origin $(git branch --show-current)
```

## 用法

```
/push
```
