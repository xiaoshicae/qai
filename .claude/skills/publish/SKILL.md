---
description: 一键发版（版本升级 → 质量校验 → 构建验证 → 打 tag → 推送触发 CI 发布）
allowed-tools: Bash(git:*, cargo:*, npm:*, npx:*, cat:*, grep:*), Read, Edit, Grep, Glob, AskUserQuestion
argument-hint: "[patch|minor|major]"
---

# 一键发版

版本升级类型: ${ARGUMENTS:-patch}

## 阶段一：预检查

### 1. 环境检查

```bash
git status
git branch --show-current
```

**门禁条件**（任一不满足则终止）：
- 当前分支必须是 `main`（不在 main 上则提示切换）
- 工作区必须干净（有未提交变更则提示先 `/commit`）
- 远程同步（`git fetch origin && git diff HEAD origin/main --stat`，有差异则提示先 pull）

### 2. 读取当前版本

从以下三个文件读取当前版本号：
- `package.json` → `"version": "x.y.z"`
- `src-tauri/tauri.conf.json` → `"version": "x.y.z"`
- `src-tauri/Cargo.toml` → `version = "x.y.z"`

**校验**：三处版本必须一致，不一致则报错终止。

### 3. 计算新版本

根据参数计算新版本号（遵循 SemVer）：

| 参数 | 当前 0.1.0 → | 说明 |
|------|-------------|------|
| `patch` | 0.1.1 | Bug 修复 |
| `minor` | 0.2.0 | 新功能 |
| `major` | 1.0.0 | 破坏性变更 |

使用 AskUserQuestion 确认：
```
即将发版：v{当前版本} → v{新版本}（{patch/minor/major}）
确认继续？
```

## 阶段二：质量校验

### 4. Rust 编译检查 + Clippy + 格式化

```bash
cd src-tauri && cargo check
cd src-tauri && cargo clippy -- -D warnings
cd src-tauri && cargo fmt --check
```

任一失败则终止。如果 `cargo fmt --check` 失败，自动运行 `cargo fmt` 修复并提交。

### 5. Rust 单元测试

```bash
cd src-tauri && cargo test
```

失败则终止，输出失败的测试。

### 6. 前端类型检查

```bash
npx tsc --noEmit
```

失败则终止，输出类型错误。

### 7. 安全扫描

检查 `src/` 和 `src-tauri/src/` 下是否有硬编码凭证：

| 模式 | 说明 |
|------|------|
| `api[_-]?key\s*[:=]\s*["'][^"']{8,}` | 硬编码 API Key |
| `sk-[a-zA-Z0-9]{20,}` | OpenAI/Anthropic 风格密钥 |

发现则警告（不阻断，但输出提示）。

## 阶段三：构建验证

### 8. 完整构建

```bash
cargo tauri build
```

**必须构建成功**，失败则终止。

### 9. 构建产物检查

```bash
ls -lh src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null
ls -lh src-tauri/target/release/bundle/macos/*.app 2>/dev/null
```

输出产物大小，确认有产出。

## 阶段四：版本升级

### 10. 修改版本号

使用 Edit 工具同时更新三个文件的版本号：

1. `package.json` → `"version": "{新版本}"`
2. `src-tauri/tauri.conf.json` → `"version": "{新版本}"`
3. `src-tauri/Cargo.toml` → `version = "{新版本}"`

### 11. 更新 Cargo.lock

```bash
cd src-tauri && cargo check
```

确保 `Cargo.lock` 同步更新。

## 阶段五：提交与发布

### 12. 提交版本变更

```bash
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "$(cat <<'EOF'
@chore: release v{新版本}

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

### 13. 打 tag

```bash
git tag v{新版本}
```

### 14. 推送

```bash
git push origin main
git push origin v{新版本}
```

**重要：如果推送后 CI 失败需要修复，禁止删除/重建同名 tag。必须升新版本号（如 0.1.6 → 0.1.7）重新走发版流程。** 原因：同名 tag 重建会触发多个 Release workflow，后完成的旧构建会覆盖新构建的产物。

推送 tag 后 GitHub Actions 会自动触发 `.github/workflows/release.yml` 构建多平台安装包。

## 阶段六：监控 CI

### 15. 持续观察 CI 结果

推送后，使用 `gh run list` 轮询 CI 状态，直到所有 workflow 完成：

```bash
# 每 30 秒检查一次，直到 Release workflow 完成
gh run list -R {owner}/{repo} --limit 4
```

轮询策略：
1. 推送后等待 15 秒让 CI 触发
2. 使用 `gh run list` 查看最新运行状态
3. 如果有 `in_progress` 状态，等待 30 秒后重新检查
4. 直到 Release workflow 显示 `completed`

### 16. 处理 CI 结果

**如果 CI 成功**（`completed` + `success`）：
```
==> CI 构建成功！
    所有平台构建通过，Release draft 已生成。
    请前往 GitHub Releases 页面 Publish：
    https://github.com/{owner}/{repo}/releases/tag/v{新版本}
```

**如果 CI 失败**（`completed` + `failure`）：
1. 使用 `gh run view {run_id} --log-failed` 获取失败日志
2. 分析错误原因并输出给用户
3. 如果是代码问题，提示修复后重新发版
4. 如果是 CI 环境问题（如 secrets 配置），提示用户检查 GitHub Settings

## 阶段七：输出报告

```
==> 发版报告
    版本: v{旧版本} → v{新版本}
    类型: {patch/minor/major}
    质量检查: ✓ Rust 编译 | ✓ 单元测试 | ✓ 类型检查
    本地构建: ✓ 成功（DMG: xx MB）
    Git: ✓ commit + tag + push
    CI: ✓ 全平台构建成功 / ✗ 构建失败（附原因）
    Release: https://github.com/{owner}/{repo}/releases/tag/v{新版本}
```

CI 成功时提示用户去 GitHub Releases 页面 Publish draft release。

## 用法

```
/publish           # patch 版本升级（0.1.0 → 0.1.1）
/publish minor     # minor 版本升级（0.1.0 → 0.2.0）
/publish major     # major 版本升级（0.1.0 → 1.0.0）
```