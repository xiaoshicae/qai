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

### 4. Rust 编译检查

```bash
cd src-tauri && cargo check
```

失败则终止，输出错误。

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

推送 tag 后 GitHub Actions 会自动触发 `.github/workflows/release.yml` 构建多平台安装包。

## 阶段六：输出报告

```
==> 发版报告
    版本: v{旧版本} → v{新版本}
    类型: {patch/minor/major}
    质量检查: ✓ Rust 编译 | ✓ 单元测试 | ✓ 类型检查
    本地构建: ✓ 成功（DMG: xx MB）
    Git: ✓ commit + tag + push
    CI: GitHub Actions 正在构建多平台安装包...
    Release: https://github.com/{owner}/{repo}/releases/tag/v{新版本}
```

提示用户去 GitHub Releases 页面查看构建进度，构建完成后 Publish draft release。

## 用法

```
/publish           # patch 版本升级（0.1.0 → 0.1.1）
/publish minor     # minor 版本升级（0.1.0 → 0.2.0）
/publish major     # major 版本升级（0.1.0 → 1.0.0）
```