# 数据库设计规范

## 层级关系

```
Group（侧边栏分组，可嵌套）→ Collection（测试集）→ CollectionItem（统一节点）
  type: folder（文件夹）/ chain（链式请求组）/ request（单个请求）
```

另有：assertions（断言，挂 item）、executions（执行记录）、environments + env_variables、settings（KV）

## 核心设计原则

1. **统一树结构** — folder/chain/request 同表 `collection_items`，`type` 区分，`parent_id` 自引用嵌套
2. **Groups 独立** — 纯 UI 组织，删除 group 不影响数据（`ON DELETE SET NULL`）
3. **Executions 精简** — 不存冗余请求快照，存 `collection_id` 方便查询
4. **ID** — `uuid::Uuid::new_v4().to_string()`，Rust 端生成
5. **时间** — `datetime('now', 'localtime')`，Rust 用 `Local::now()`（禁止 `Utc::now()`）

详细字段定义见 `src-tauri/src/db/init.rs`。

## 禁止事项

- 在 collections 上加业务特定字段
- 用多张表表示同层级节点
- `datetime('now')`（必须加 `'localtime'`）
- 字符串拼接 SQL（用 `params![]`）
