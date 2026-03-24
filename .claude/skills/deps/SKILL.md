---
description: 依赖安全审计与更新检查（npm + cargo）
allowed-tools: Bash(npm:*, npx:*, cargo:*), Read, AskUserQuestion
argument-hint: [audit | outdated | update]
---

# 依赖管理

参数: ${ARGUMENTS:-audit}

## 执行逻辑

### audit（默认）— 安全审计

```bash
npm audit
cd src-tauri && cargo audit 2>/dev/null || echo "提示：可安装 cargo-audit (cargo install cargo-audit)"
```

- 无漏洞：输出 `无已知安全漏洞`
- 有漏洞：列出漏洞详情，建议修复方案

### outdated — 检查过期依赖

```bash
npm outdated
cd src-tauri && cargo outdated 2>/dev/null || echo "提示：可安装 cargo-outdated (cargo install cargo-outdated)"
```

以表格展示过期依赖，分类建议：
- **Patch/Minor 更新**：通常安全，建议更新
- **Major 更新**：可能有 breaking changes，需评估

### update — 执行更新

询问用户确认后执行：

```bash
npm update                    # 更新 npm minor/patch
cd src-tauri && cargo update  # 更新 cargo 依赖
```

更新后自动验证：
```bash
npx tsc --noEmit
cd src-tauri && cargo check
```

## 用法

```
/deps              # 安全审计（默认）
/deps audit        # 安全审计
/deps outdated     # 检查过期依赖
/deps update       # 执行更新
```
