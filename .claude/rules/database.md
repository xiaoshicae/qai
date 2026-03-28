# 数据库设计规范

## 表结构总览

```
groups              — 侧边栏分组（树形，支持嵌套）
collections         — 测试集（归属某个 group）
collection_items    — 统一节点（folder / chain / request）
assertions          — 断言（挂在 item 上）
executions          — 执行记录（挂在 item 上）
environments        — 环境
env_variables       — 环境变量
settings            — KV 配置
```

## 层级关系

```
Group（侧边栏分组，可嵌套）
  └── Collection（测试集）
        └── CollectionItem（统一节点）
              ├── type = 'folder'   — 普通文件夹（可嵌套）
              ├── type = 'chain'    — 链式请求组（子项按序执行）
              └── type = 'request'  — 单个请求/用例
```

## 核心设计原则

### 1. 统一树结构 (`collection_items`)

folder / chain / request 在同一张表，通过 `type` 字段区分，`parent_id` 指向自身表实现嵌套。

**好处**：同层级统一排序、一次查询构建树、无跨表 JOIN。

**约束**：
- folder/chain 的 request 专属字段（method, url, headers 等）为默认值，不使用
- request 的 parent_id 可以为 NULL（集合根级）或指向 folder/chain

### 2. Groups 独立于 Collections

Groups 是纯 UI 组织结构，删除 group 不影响测试数据（`ON DELETE SET NULL`）。

### 3. Executions 精简

- 不存冗余的 request_headers / request_body（从 item 读取）
- 存 `collection_id` 方便按集合查询
- 存 `response_body` 但应定期清理旧记录

### 4. ID 生成

所有表使用 `uuid::Uuid::new_v4().to_string()` 在 Rust 端生成，不依赖数据库自增。

### 5. 时间字段

统一使用 `datetime('now', 'localtime')` 存储本地时间，Rust 端用 `chrono::Local::now()`。

## 表详细定义

### groups
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| name | TEXT NOT NULL | 分组名称 |
| parent_id | TEXT FK→groups | 父分组（NULL=顶级） |
| sort_order | INTEGER | 排序 |

### collections
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| name | TEXT NOT NULL | 测试集名称 |
| description | TEXT | 描述 |
| group_id | TEXT FK→groups | 归属分组（NULL=未分组） |
| sort_order | INTEGER | 排序 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### collection_items
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| collection_id | TEXT FK→collections | 所属集合 |
| parent_id | TEXT FK→self | 父节点（NULL=集合根级） |
| type | TEXT CHECK | 'folder' / 'chain' / 'request' |
| name | TEXT NOT NULL | 名称 |
| sort_order | INTEGER | 排序 |
| method | TEXT | HTTP 方法（request 用） |
| url | TEXT | 请求 URL |
| headers | TEXT | JSON: `[{key, value, enabled}]` |
| query_params | TEXT | JSON: `[{key, value, enabled}]` |
| body_type | TEXT | none/json/raw/urlencoded/form-data |
| body_content | TEXT | 请求体内容 |
| extract_rules | TEXT | JSON: `[{var_name, source, expression}]` |
| description | TEXT | 描述 |
| expect_status | INTEGER | 期望 HTTP 状态码 |
| poll_config | TEXT | JSON: 轮询配置 |
| protocol | TEXT | 'http' / 'websocket'（默认 'http'） |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### assertions
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| item_id | TEXT FK→collection_items | 所属 item |
| type | TEXT | status_code/json_path/body_contains/response_time/header_contains |
| expression | TEXT | 表达式 |
| operator | TEXT | eq/neq/gt/lt/contains/matches 等 |
| expected | TEXT | 期望值 |
| enabled | INTEGER | 是否启用 |
| sort_order | INTEGER | 排序 |

### executions
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| item_id | TEXT FK→collection_items | 执行的 item |
| collection_id | TEXT | 冗余，方便按集合查询 |
| batch_id | TEXT | 批量执行 ID |
| status | TEXT | success/failed/error |
| request_url | TEXT | 实际请求 URL |
| request_method | TEXT | 实际 HTTP 方法 |
| response_status | INTEGER | 响应状态码 |
| response_headers | TEXT | JSON |
| response_body | TEXT | 响应体 |
| response_time_ms | INTEGER | 响应耗时 |
| response_size | INTEGER | 响应大小 |
| assertion_results | TEXT | JSON: `[{passed, actual, message}]` |
| error_message | TEXT | 错误信息 |
| executed_at | TEXT | 执行时间 |

## 禁止事项

- 禁止在 collections 上加业务特定字段（如 category/endpoint/subcategory）
- 禁止使用多张表表示同层级节点（旧的 folders + requests 设计已废弃）
- 禁止在 executions 中存冗余请求快照（request_headers/request_body）
- 禁止用 `datetime('now')` — 必须用 `datetime('now', 'localtime')`
- 禁止用 `Utc::now()` — 必须用 `Local::now()`
- 禁止字符串拼接 SQL — 使用 `params![]` 参数化
