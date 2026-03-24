---
description: 一键提交、推送、创建 PR
allowed-tools: Bash(git:*, gh:*, cargo:*, npm:*, npx:*), Read, Glob, Grep, AskUserQuestion
argument-hint: [target-branch]
---

# 一键 Ship（commit → push → pr）

目标分支: ${ARGUMENTS:-main}

## 阶段一：Commit

### 1. 检查状态

```bash
git status && git diff --stat
```

无变更则跳过提交，直接进入阶段二。

### 2. 暂存并提交

```bash
git add -A
git commit -m "@<类型>: <描述>"
```

## 阶段二：Push

### 3. 质量检查

```bash
cd src-tauri && cargo check && cargo test
npx vue-tsc --noEmit
```

失败则终止。

### 4. 推送

```bash
git push -u origin $(git branch --show-current)
```

## 阶段三：PR

### 5. 创建 PR

```bash
gh pr create --base ${ARGUMENTS:-main} --title "<标题>" --body "<描述>"
```

## 用法

```
/ship              # commit + push + pr 到 main
/ship develop      # commit + push + pr 到 develop
```
