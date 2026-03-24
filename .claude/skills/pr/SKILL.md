---
description: 创建 Pull Request
allowed-tools: Bash(git:*, gh:*), AskUserQuestion
argument-hint: [target-branch]
---

# 创建 Pull Request

目标分支: ${ARGUMENTS:-main}

## 执行步骤

### 1. 检查状态

```bash
git status
git log origin/${ARGUMENTS:-main}..HEAD --oneline
git diff origin/${ARGUMENTS:-main}..HEAD --stat
```

### 2. 推送分支

```bash
git push -u origin $(git branch --show-current)
```

### 3. 展示 PR 预览

标题和描述基于 commit 历史生成。

### 4. 用户确认

使用 AskUserQuestion 确认：确认创建 / 修改内容 / 取消

### 5. 创建 PR

```bash
gh pr create --base ${ARGUMENTS:-main} --title "<标题>" --body "<描述>"
```

## PR 描述格式

```markdown
## Summary
- 变更点

## Test Plan
- [ ] cargo test 通过
- [ ] npm run build 通过
- [ ] 手动验收

Generated with Claude Code
```

## 用法

```
/pr              # PR 到 main
/pr develop      # PR 到 develop
```
