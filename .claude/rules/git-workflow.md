# Git 工作流规范

## 分支策略

| 分支 | 用途 | 生命周期 |
|------|------|---------|
| `main` | 稳定版本 | 永久 |
| `feat/<desc>` | 新功能 | 合并后删除 |
| `fix/<desc>` | Bug 修复 | 合并后删除 |
| `refactor/<desc>` | 重构 | 合并后删除 |

## 提交信息规范

格式: `@<类型>: <描述>`

| 类型 | 用途 |
|------|------|
| feat | 新功能 |
| fix | Bug 修复 |
| refactor | 重构 |
| perf | 性能优化 |
| docs | 文档 |
| test | 测试 |
| chore | 构建/工具 |

示例:
```
@feat: 添加 Postman 导入功能
@fix: 修复 JSON Path 断言空值崩溃
@refactor: 提取 HTTP 客户端为独立模块
```

## 提交前检查

1. `cargo check` — Rust 编译无错误
2. `cargo test` — 测试全部通过
3. `npm run build` — 前端构建成功
4. 无敏感信息泄露

## 禁止操作

- `git push --force` 到 main
- `git reset --hard` 到 main
- 提交 `node_modules/` 或 `target/`
- 提交 `.env` 或含密钥的文件
