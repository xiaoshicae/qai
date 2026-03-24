---
description: 构建 Tauri 应用并检查错误
allowed-tools: Bash(cargo:*, npm:*, npx:*, du:*), Read
argument-hint: ""
---

# 构建 Tauri 应用

## 执行步骤

### 1. Rust 编译检查

```bash
cd src-tauri && cargo check
```

失败则输出错误，提供修复建议。

### 2. Rust 测试

```bash
cd src-tauri && cargo test
```

### 3. 前端类型检查

```bash
npx vue-tsc --noEmit
```

### 4. 执行完整构建

```bash
cargo tauri build
```

### 5. 分析构建产物

```bash
ls -lh src-tauri/target/release/bundle/dmg/*.dmg
du -sh src-tauri/target/release/bundle/macos/*.app
```

### 6. 输出报告

```
==> 构建结果
    状态: 成功 / 失败
    DMG 大小: xxx MB
    App 大小: xxx MB
    Rust 测试: x passed
```

## 用法

```
/build
```
