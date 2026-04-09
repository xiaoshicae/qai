<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="128" height="128" alt="QAI Logo">

# QAI

**AI 驱动的 API 测试工具**

带脑子的 Postman 替代品。QAI 通过 AI 分析你的代码和文档，自动生成测试用例 — 告别手写样板，专注发布。

[![Release](https://img.shields.io/github/v/release/xiaoshicae/qai?style=flat-square&color=blue)](https://github.com/xiaoshicae/qai/releases)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=flat-square)]()
[![Rust](https://img.shields.io/badge/rust-1.77+-orange?style=flat-square&logo=rust)](https://www.rust-lang.org)
[![Tauri](https://img.shields.io/badge/tauri-2.0-blue?style=flat-square&logo=tauri)](https://tauri.app)

[下载](#下载) · [功能](#功能) · [快速上手](#快速上手) · [开发](#开发) · [English](README.md)

</div>

---

<p align="center"><img src="public/screenshot.png" width="960" alt="QAI 截图"></p>

## 为什么选 QAI？

| | Postman | QAI |
|---|---|---|
| AI 生成用例 | 有限（付费） | 内置，自带 API Key 即可 |
| 桌面性能 | Electron（重） | Tauri + Rust（原生，约 13MB） |
| 隐私 | 云同步 | 100% 本地，数据不离开你的电脑 |
| 价格 | 免费增值 | 免费开源 |

## 功能

### 核心能力

- **HTTP 客户端** — 支持 GET、POST、PUT、DELETE、PATCH，完整的请求头、查询参数、请求体控制
- **集合与文件夹** — 拖拽排序的嵌套树结构，灵活组织请求
- **环境变量** — `{{variable}}` 语法，支持多环境切换
- **断言系统** — 状态码、JSON Path、响应体包含、响应时间、响应头检查
- **链式执行** — 按序执行请求，步骤间自动提取变量传递
- **批量执行** — 并行执行整个集合，实时进度反馈

### AI 驱动

- **自动生成用例** — 将 AI 指向你的 API 文档或代码，获取完整测试套件
- **智能断言** — AI 根据响应结构建议有意义的断言
- **AI 对话** — 询问 API 问题、调试失败、获取建议

### 开发体验

- **WebSocket 支持** — 连接、发送消息、监控实时流
- **cURL 导入/导出** — 粘贴 cURL 命令，即可运行
- **HTML 报告** — 导出精美的测试执行报告
- **内置终端** — 应用内直接使用的 PTY 终端
- **MCP 服务器** — 将测试集暴露为 MCP 工具，供 AI Agent 调用
- **深色/浅色主题** — 精致 UI，自动跟随系统主题
- **国际化** — 开箱即用的中英文支持

## 下载

<table>
<tr>
<td align="center"><b>macOS</b></td>
<td align="center"><b>Windows</b></td>
<td align="center"><b>Linux</b></td>
</tr>
<tr>
<td align="center">
<a href="https://github.com/xiaoshicae/qai/releases/latest">
Apple Silicon (.dmg)<br>
Intel (.dmg)
</a>
</td>
<td align="center">
<a href="https://github.com/xiaoshicae/qai/releases/latest">
64-bit (.msi)<br>
64-bit (.exe)
</a>
</td>
<td align="center">
<a href="https://github.com/xiaoshicae/qai/releases/latest">
.deb<br>
.AppImage
</a>
</td>
</tr>
</table>

> **macOS 提示**：应用未经代码签名。首次打开时，请右键点击应用选择「打开」并确认，仅需操作一次。或在终端执行 `xattr -cr /Applications/QAI.app`。

## 快速上手

1. **下载安装** — 前往[最新版本](https://github.com/xiaoshicae/qai/releases/latest)下载对应平台安装包
2. **创建集合** — 点击侧边栏的「+」新建测试集
3. **添加请求** — 设置请求方法、URL、请求头、请求体
4. **运行与断言** — 点击发送，添加断言，验证 API 行为
5. **（可选）配置 AI** — 进入设置页面，填入你的 AI API Key，即可使用 AI 生成用例

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | **Rust** — Tauri 2.0, reqwest, rusqlite, tokio |
| 前端 | **React 19** — TypeScript, Vite, Tailwind CSS 4, Zustand |
| 数据库 | **SQLite** — WAL 模式，完全本地存储 |
| AI | **Claude / OpenAI 兼容** — 自带 API Key 即可使用 |

## 开发

```bash
# 前置条件：Rust 1.77+, Node.js 22+, npm

# 克隆项目
git clone https://github.com/xiaoshicae/qai.git
cd qai

# 安装前端依赖
npm install

# 开发模式（热重载）
cargo tauri dev

# 运行测试
cd src-tauri && cargo test

# 生产构建
cargo tauri build
```

## 贡献

欢迎贡献代码！

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feat/amazing-feature`)
3. 提交更改 (`git commit -m '@feat: add amazing feature'`)
4. 推送分支 (`git push origin feat/amazing-feature`)
5. 创建 Pull Request

## 许可证

[MIT](LICENSE) — 随便用。

---

<div align="center">

**如果 QAI 帮到了你，给个 Star 吧！**

</div>
