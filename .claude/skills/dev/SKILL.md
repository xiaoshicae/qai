---
description: 启动 Tauri 开发模式
allowed-tools: Bash, Read, Grep
---

# 启动开发服务器

## 执行步骤

### 1. 检查端口占用

```bash
lsof -ti:5173 2>/dev/null
```

如果端口被占用，提示用户是否 kill。

### 2. 检查依赖

```bash
ls node_modules/.package-lock.json 2>/dev/null || npm install
```

### 3. 启动 Tauri 开发模式

```bash
cargo tauri dev
```

### 4. 输出状态

```
==> 开发服务器启动
    前端: http://localhost:5173
    Tauri: 桌面窗口已打开
    热重载: 已启用
```

## 注意事项

- 前端修改自动热重载
- Rust 修改会触发重新编译（较慢）
- 首次启动需编译 Rust 依赖，耗时较长
