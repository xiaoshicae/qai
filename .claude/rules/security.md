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
- 禁止不安全的 HTML 渲染（XSS 风险），HTML 预览用 `<iframe srcDoc sandbox="">` 最严格沙箱

### CSP 策略

`tauri.conf.json` 中已配置 CSP，关键决策：

| 指令 | 值 | 原因 |
|------|---|------|
| `script-src` | `'unsafe-inline' 'unsafe-eval'` | Monaco Editor 需要 eval，Tailwind/Vite 注入内联脚本 |
| `connect-src` | `'self' tauri: asset: https: wss:` | 前端只连自身和 Tauri，HTTP 请求走 Rust |
| `style-src` | `'unsafe-inline'` | Tailwind 4 内联样式注入 |

**禁止** `connect-src *`（曾经有，已收紧）。如需扩展 CSP，必须注明原因。

## Rust 端安全

- 用户输入通过 Tauri command 参数传入，已有类型校验
- SQL 查询使用 `params![]` 参数化，禁止字符串拼接 SQL
- HTTP Client 配置：`timeout(30s)` + `connect_timeout(10s)` + `redirect(Policy::limited(10))`

## 安全检查清单

- [ ] 无硬编码凭证
- [ ] SQL 全部参数化
- [ ] 无 `v-html` 渲染不可信内容
- [ ] HTTP 请求有超时设置
- [ ] 日志中不输出敏感信息
