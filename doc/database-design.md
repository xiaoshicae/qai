# QAI 数据库设计

## 概览

QAI 使用 SQLite (WAL 模式) 作为本地数据库，存储在 Tauri app data 目录下的 `qai.db` 文件。

数据库路径: `~/Library/Application Support/com.qai.app/qai.db`

## ER 关系

```
groups (1) ←── (N) collections (1) ←── (N) collection_items (1) ←── (N) assertions
   │                                          │
   └── groups (self-ref, parent_id)           ├── collection_items (self-ref, parent_id)
                                              │
                                              └──── (N) executions
```

## 层级结构

```
Group（侧边栏分组）
├── Group（子分组，通过 parent_id 嵌套）
└── Collection（测试集）
      └── CollectionItem
            ├── type='folder'   — 普通文件夹
            ├── type='chain'    — 链式请求组
            └── type='request'  — 单个请求
```

## 表定义

### groups — 侧边栏分组

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | UUID v4 |
| name | TEXT | NOT NULL | 显示名称 |
| parent_id | TEXT | FK→groups, CASCADE | 父分组 ID，NULL=顶级 |
| sort_order | INTEGER | DEFAULT 0 | 同级排序 |

### collections — 测试集

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | UUID v4 |
| name | TEXT | NOT NULL | 测试集名称 |
| description | TEXT | DEFAULT '' | 描述 |
| group_id | TEXT | FK→groups, SET NULL | 归属分组 |
| sort_order | INTEGER | DEFAULT 0 | 同组内排序 |
| created_at | TEXT | localtime | 创建时间 |
| updated_at | TEXT | localtime | 更新时间 |

### collection_items — 统一节点

集合内的所有内容（文件夹、链式组、请求）统一存储在这张表中。

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | UUID v4 |
| collection_id | TEXT | FK→collections, CASCADE | 所属集合 |
| parent_id | TEXT | FK→self, CASCADE | 父节点，NULL=集合根级 |
| type | TEXT | CHECK('folder','chain','request') | 节点类型 |
| name | TEXT | NOT NULL | 名称 |
| sort_order | INTEGER | DEFAULT 0 | 同级排序 |
| method | TEXT | DEFAULT 'GET' | HTTP 方法 |
| url | TEXT | DEFAULT '' | 请求 URL |
| headers | TEXT | DEFAULT '[]' | JSON: [{key, value, enabled}] |
| query_params | TEXT | DEFAULT '[]' | JSON: [{key, value, enabled}] |
| body_type | TEXT | DEFAULT 'none' | none/json/raw/urlencoded/form-data |
| body_content | TEXT | DEFAULT '' | 请求体 |
| extract_rules | TEXT | DEFAULT '[]' | JSON: [{var_name, source, expression}] |
| description | TEXT | DEFAULT '' | 场景描述 |
| expect_status | INTEGER | DEFAULT 200 | 期望 HTTP 状态码 |
| poll_config | TEXT | DEFAULT '' | JSON: 轮询配置 |
| created_at | TEXT | localtime | 创建时间 |
| updated_at | TEXT | localtime | 更新时间 |

**注意**: folder/chain 类型不使用 method~poll_config 字段，保持默认值。

### assertions — 断言

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | UUID v4 |
| item_id | TEXT | FK→collection_items, CASCADE | 所属 item |
| type | TEXT | NOT NULL | 断言类型 |
| expression | TEXT | DEFAULT '' | 表达式 |
| operator | TEXT | DEFAULT 'eq' | 操作符 |
| expected | TEXT | DEFAULT '' | 期望值 |
| enabled | INTEGER | DEFAULT 1 | 是否启用 |
| sort_order | INTEGER | DEFAULT 0 | 排序 |
| created_at | TEXT | localtime | 创建时间 |

断言类型: `status_code`, `json_path`, `body_contains`, `response_time`, `header_contains`
操作符: `eq`, `neq`, `gt`, `lt`, `gte`, `lte`, `contains`, `not_contains`, `exists`, `matches`

### executions — 执行记录

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | TEXT | PK | UUID v4 |
| item_id | TEXT | FK→collection_items, CASCADE | 执行的 item |
| collection_id | TEXT | | 冗余字段，方便按集合查询 |
| batch_id | TEXT | | 批量执行 ID |
| status | TEXT | NOT NULL | success/failed/error |
| request_url | TEXT | NOT NULL | 实际请求 URL |
| request_method | TEXT | NOT NULL | 实际 HTTP 方法 |
| response_status | INTEGER | | HTTP 响应状态码 |
| response_headers | TEXT | DEFAULT '{}' | 响应头 JSON |
| response_body | TEXT | | 响应体 |
| response_time_ms | INTEGER | DEFAULT 0 | 耗时(ms) |
| response_size | INTEGER | DEFAULT 0 | 响应大小(bytes) |
| assertion_results | TEXT | DEFAULT '[]' | 断言结果 JSON |
| error_message | TEXT | | 错误信息 |
| executed_at | TEXT | localtime | 执行时间 |

### environments — 环境

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| name | TEXT | 环境名称 |
| is_active | INTEGER | 是否激活（全局唯一） |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### env_variables — 环境变量

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| environment_id | TEXT FK | 所属环境 |
| key | TEXT | 变量名 |
| value | TEXT | 变量值 |
| enabled | INTEGER | 是否启用 |
| sort_order | INTEGER | 排序 |

约束: `UNIQUE(environment_id, key)`

### settings — 配置

| 字段 | 类型 | 说明 |
|------|------|------|
| key | TEXT PK | 配置键 |
| value | TEXT | 配置值 |
| updated_at | TEXT | 更新时间 |

## 索引

| 索引 | 表 | 字段 |
|------|-----|------|
| idx_groups_parent | groups | parent_id |
| idx_collections_group | collections | group_id |
| idx_items_collection | collection_items | collection_id |
| idx_items_parent | collection_items | parent_id |
| idx_assertions_item | assertions | item_id |
| idx_executions_item | executions | item_id |
| idx_executions_batch | executions | batch_id |
| idx_executions_collection | executions | collection_id |
| idx_env_variables_env | env_variables | environment_id |

## 数据迁移

启动时自动检测旧表结构并迁移：
- `folders` + `requests` → `collection_items`
- `collections.category` → `groups` 表
- `assertions.request_id` → `item_id`
- `executions.request_id` → `item_id`

迁移逻辑在 `src-tauri/src/db/init.rs` 的 `migrate_if_needed()` 函数中。
