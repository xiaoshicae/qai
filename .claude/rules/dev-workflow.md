# 开发服务器启动规范

## 启动前必须检查

1. **关闭正式版 APP** — `cargo tauri dev` 与已安装的 QAI.app 共用 bundle identifier，同时运行会导致 dev 进程立即退出
2. **检查端口占用** — Vite 开发服务器使用 5173 端口

## 启动流程

```bash
# 1. 关闭所有 QAI 进程（正式版 + 残留 dev 进程）
pkill -f "QAI" 2>/dev/null; pkill -f "qai" 2>/dev/null

# 2. 检查端口
lsof -ti:5173 2>/dev/null && kill $(lsof -ti:5173)

# 3. 启动（后台运行，避免阻塞对话）
cargo tauri dev
```

## 注意事项

- 首次启动需编译全部 Rust 依赖，耗时 1-3 分钟
- 前端修改自动热重载，Rust 修改触发增量编译
- dev 版本窗口标题不会显示版本号，可以此区分正式版
