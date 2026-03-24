# 安全规范

## 敏感信息

- Claude API Key 存储在 SQLite settings 表中，不写入文件或环境变量
- 禁止在代码中硬编码 API Key、Token、密码
- `.env` 文件不提交 git

## 前端安全

- 所有 HTTP 请求在 Rust 端执行（reqwest），前端 WebView 不直接发请求
- 避免使用 `v-html` 渲染用户输入（XSS 风险）
- Tauri CSP 设置为 null（开发期），生产环境需收紧

## Rust 端安全

- 用户输入通过 Tauri command 参数传入，已有类型校验
- SQL 查询使用 `params![]` 参数化，禁止字符串拼接 SQL
- HTTP 请求设置超时（30s），避免无限等待

## 安全检查清单

- [ ] 无硬编码凭证
- [ ] SQL 全部参数化
- [ ] 无 `v-html` 渲染不可信内容
- [ ] HTTP 请求有超时设置
- [ ] 日志中不输出敏感信息
