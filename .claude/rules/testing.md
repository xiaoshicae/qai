# 测试规范

## 测试策略

| 层级 | 工具 | 覆盖范围 |
|------|------|---------|
| Rust 单元测试 | `cargo test` | 断言引擎、AI 解析器、JSON Path |
| Rust 集成测试 | `cargo test` + wiremock | HTTP 客户端、批量执行 |
| 前端组件测试 | Vitest + @vue/test-utils | 组件渲染和交互 |
| 手动验收 | httpbin.org | 端到端流程 |

## Rust 测试

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_descriptive_name() {
        // Arrange
        let input = ...;
        // Act
        let result = function_under_test(input);
        // Assert
        assert_eq!(result, expected);
    }
}
```

- 测试放在同文件的 `#[cfg(test)]` 模块中
- 数据库测试使用 `Connection::open_in_memory()`
- HTTP 测试使用 `wiremock` mock server
- 测试命名描述行为：`test_json_path_array_index`

## 测试命令

```bash
cd src-tauri && cargo test              # 运行全部 Rust 测试
cd src-tauri && cargo test assertion    # 运行断言相关测试
cd src-tauri && cargo test -- --nocapture  # 显示 println 输出
```

## 手动验收清单

- [ ] 创建集合 → 添加请求 → 发送到 httpbin.org → 响应正确
- [ ] 添加断言（status_code eq 200）→ 发送 → 断言通过
- [ ] 批量执行 → 进度实时更新 → 报告导出 HTML
- [ ] AI 生成（需配置 API Key）→ 用例导入集合
