---
description: 从 e2e 目录导入真实测试用例到 QAI（清空后重建）
allowed-tools: Bash, Read, Grep, Glob
---

# 导入 E2E 测试用例

从 `/Users/zs/Workspace/eigenai/llm-trainer-gateway/e2e/cases` 目录读取 YAML 测试用例，清空 QAI 数据库后重新导入。

## 数据库位置

`/Users/zs/Library/Application Support/com.qai.app/qai.db`

## 执行步骤

### 1. 验证 e2e 目录

确认 `/Users/zs/Workspace/eigenai/llm-trainer-gateway/e2e/cases` 存在且包含 YAML 文件。

### 2. 清空数据库

```bash
sqlite3 "/Users/zs/Library/Application Support/com.qai.app/qai.db" "
DELETE FROM executions;
DELETE FROM assertions;
DELETE FROM requests;
DELETE FROM folders;
DELETE FROM collections;
"
```

### 3. 解析 YAML 并导入

用 Python 脚本解析所有 `.yml` 文件，生成 SQL INSERT 语句：

- 每个 YAML 文件 → 一个 collection（name = YAML 的 `name` 字段，category/endpoint 等对应字段）
- 每个 scenario → 一个 request（name = scenario `id`，method = POST，url = collection endpoint）
  - `payload` → body_type = json, body_content = JSON 字符串
  - `form_data` → body_type = urlencoded, body_content = `[{key, value, enabled}]` 数组
  - `multipart_fields` → body_type = form-data, body_content = `[{key, value, enabled}]` 数组
  - `expect.status` → expect_status
- 每个 request 自动创建一个 status_code 断言（eq expect_status）
- Headers 自动添加 Content-Type

### 4. 验证

```bash
sqlite3 "/Users/zs/Library/Application Support/com.qai.app/qai.db" "
SELECT category, count(*) FROM collections GROUP BY category;
SELECT count(*) FROM requests;
SELECT count(*) FROM assertions;
"
```

## YAML 格式

```yaml
model: model-id
name: 显示名称
category: text
endpoint: /api/v1/chat/completions
scenarios:
  - id: scenario-name
    description: 描述
    payload: { ... }        # 或 form_data / multipart_fields
    expect:
      status: 200
```

## 注意事项

- 导入前会清空所有现有数据（collections、requests、assertions、executions、folders）
- 如果 QAI 应用正在运行，导入后需要刷新页面或重启应用才能看到新数据
- environments 和 settings 不受影响
