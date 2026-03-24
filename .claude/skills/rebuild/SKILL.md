---
description: 从 main 重建当前分支（保持与 main 差异最小）
allowed-tools: Bash(git:*, CLAUDE_PUSH=1 git push*, CLAUDE_REBUILD=1 git reset*), AskUserQuestion
argument-hint: ""
---

# 从 main 重建当前分支

将当前分支重置到最新 main，再 cherry-pick 本分支独有的 commit，使分支与 main 保持最小差异。

## 执行步骤

### 1. 检查状态

```bash
git status
git branch --show-current
```

- 工作区必须干净（无未提交的变更），否则提示先 commit 或 stash
- **禁止在 main 分支上执行**

### 2. 列出本分支独有的 commit

```bash
git fetch origin main
git log origin/main..HEAD --oneline --no-merges
```

- 过滤掉 merge commit，只保留实际功能提交
- 以表格展示：commit hash、message
- 统计总数

### 3. 用户确认

使用 `AskUserQuestion` 展示即将执行的操作并确认。

### 4. 备份当前分支

```bash
git branch <current-branch>-backup-$(date +%Y%m%d) HEAD
```

### 5. 重置到 main

```bash
CLAUDE_REBUILD=1 git reset --hard origin/main
```

### 6. Cherry-pick 提交

按时间顺序（从旧到新）逐个 cherry-pick：

```bash
git cherry-pick <commit-hash>
```

**冲突处理**：
- 简单冲突（import 顺序等）：自动解决
- 复杂冲突：询问用户
- 空 cherry-pick：`git cherry-pick --skip`

### 7. 推送

```bash
CLAUDE_PUSH=1 git push -u origin <current-branch> --force-with-lease
```

### 8. 完成报告

展示成功/跳过/冲突解决数量，提供回滚命令。

## 用法

```
/rebuild    # 从 main 重建当前分支
```
