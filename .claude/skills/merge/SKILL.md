---
description: 合并分支到当前分支
allowed-tools: Bash(git:*)
argument-hint: [target-branch]
---

# 合并分支

将目标分支合并到当前分支。

目标分支: $ARGUMENTS（默认为 main）

## 执行步骤

### 1. 确定目标分支

- 如果用户指定了分支名，使用指定的分支
- 如果未指定，默认使用 `main`

### 2. 检查当前状态

```bash
git branch --show-current
git status --porcelain
```

**如果工作区有未提交的更改**：
- 提示用户先提交或暂存更改
- 不继续执行 merge

### 3. 拉取目标分支

```bash
git fetch origin <target-branch>
```

如果目标分支不存在，提示用户并终止。

### 4. 执行合并

```bash
git merge origin/<target-branch>
```

### 5. 处理结果

**合并成功**：
- 显示合并结果摘要
- 提示是否需要 push

**合并冲突**：
- 列出冲突的文件
- 提示用户手动解决冲突
- 提供解决冲突后的命令提示

## 用法

```
/merge              # 合并 main 到当前分支
/merge main         # 合并 main 到当前分支
/merge develop      # 合并 develop 到当前分支
```
