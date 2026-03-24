---
description: 对代码进行安全审查，检查 OWASP Top 10 和常见漏洞
allowed-tools: Bash(npm audit:*, cargo audit:*, npx:*), Read, Grep, Glob
argument-hint: [directory]
---

# 安全审查

对 Tauri 全栈代码进行安全审查。

## 执行步骤

### 1. 依赖漏洞扫描

```bash
npm audit
cd src-tauri && cargo audit 2>/dev/null || echo "提示：可安装 cargo-audit"
```

### 2. 硬编码凭证扫描

用 grep 检查 `src/` 和 `src-tauri/src/` 下的代码文件（排除测试）：

| 模式 | 说明 |
|------|------|
| `password\s*[:=]\s*["'][^"']{8,}` | 硬编码密码 |
| `secret\s*[:=]\s*["'][^"']{8,}` | 硬编码密钥 |
| `api[_-]?key\s*[:=]\s*["'][^"']{8,}` | 硬编码 API Key |
| `sk-[a-zA-Z0-9]{20,}` | Claude/OpenAI 风格密钥 |

### 3. Rust 端安全检查

- SQL 查询是否全部参数化（`params![]`），禁止字符串拼接
- HTTP 请求是否设置超时
- `unwrap()` 是否可能导致 panic
- `unsafe` 代码使用情况
- 用户输入是否经过验证

### 4. 前端安全检查

- 是否有不安全的 HTML 注入（XSS 风险）
- 是否有动态代码执行
- 是否有 DOM 直接操作注入用户内容
- API Key 是否仅存储在 SQLite settings 中（不在前端代码中）

### 5. Tauri 安全检查

- CSP 配置是否合理
- Tauri allowlist 是否最小化
- IPC 通信是否有不安全的命令暴露

### 6. 代码规范审查

读取 `.claude/rules/security.md` 中的完整检查清单，逐条验证。

## 风险等级

- 高风险：需要立即修复（硬编码凭证、SQL 注入、XSS 漏洞）
- 中风险：计划修复（不安全的依赖、缺少输入验证）
- 低风险：建议改进（console.log 残留、过宽的 CSP）

## 用法

```
/security-review              # 审查整个项目
/security-review src-tauri    # 审查 Rust 后端
/security-review src          # 审查前端代码
```
