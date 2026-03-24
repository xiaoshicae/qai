---
description: 运行 Rust 测试
allowed-tools: Bash(cargo:*)
argument-hint: [test-filter]
---

# 运行 Rust 测试

## 执行步骤

### 1. 运行测试

```bash
cd src-tauri && cargo test ${ARGUMENTS}
```

### 2. 输出结果

报告通过/失败数量。

## 用法

```
/check              # 运行全部测试
/check assertion    # 仅运行断言相关测试
/check parser       # 仅运行 AI 解析器测试
```
