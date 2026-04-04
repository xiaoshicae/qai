# 安全规范

## 敏感信息

### API 密钥存储策略

**当前决策：明文存储在 SQLite 数据库**

原因分析：
1. **桌面应用场景** - 攻击者需要先获取设备访问权限才能访问数据库
2. **数据库文件受 OS 保护** - 位于用户目录，已受操作系统权限保护
3. **主流工具做法** - Postman、Insomnia 等 API 测试工具也是本地存储
4. **跨平台兼容性** - OS keychain 在不同平台实现差异大，可能带来迁移问题

为什么不使用 OS keychain：
- 迁移风险：现有用户数据库已有明文密钥，迁移可能丢失配置
- 无头环境：CI/CD 或服务器环境可能不支持 keychain
- 复杂度收益比：对于本地桌面应用，收益有限

### Gemini API Key 在 URL 中

Gemini API 要求 key 在 URL 参数中传递，这是 Google API 的设计要求，无法避免。
代码中已正确实现，无需修改。

### 其他敏感信息

- Claude API Key 存储在 SQLite settings 表中，不写入代码文件或环境变量
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
