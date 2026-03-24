---
description: Rust 编译检查 + TypeScript 类型检查
allowed-tools: Bash(cargo:*, npm:*, npx:*)
argument-hint: ""
---

# Rust + TypeScript 质量检查

## 执行步骤

### 1. Rust 编译检查

```bash
cd src-tauri && cargo check 2>&1
```

### 2. Rust Clippy（如果已安装）

```bash
cd src-tauri && cargo clippy 2>&1 || true
```

### 3. TypeScript 类型检查

```bash
npx vue-tsc --noEmit
```

### 4. 结果汇总

- 所有检查通过：输出 `✅ Rust + TypeScript 检查通过`
- 有错误：列出错误详情，提供修复建议

## 用法

```
/lint
```
