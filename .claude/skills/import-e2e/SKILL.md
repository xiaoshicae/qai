---
description: 从 e2e 目录导入真实测试用例到 QAI
allowed-tools: Bash, Read, Grep, Glob
---

# 导入 E2E 测试用例

从 `/Users/zs/Workspace/eigenai/llm-trainer-gateway/e2e/cases` 目录导入 YAML 测试用例到 QAI 数据库。

## 前置条件

- QAI 开发服务器正在运行（`cargo tauri dev`）
- e2e 目录存在：`/Users/zs/Workspace/eigenai/llm-trainer-gateway/e2e/cases`

## 执行步骤

### 1. 验证 e2e 目录

```bash
ls /Users/zs/Workspace/eigenai/llm-trainer-gateway/e2e/cases/
```

确认目录存在且包含 text/audio/image/video 子目录。

### 2. 统计用例数量

```bash
find /Users/zs/Workspace/eigenai/llm-trainer-gateway/e2e/cases -name "*.yml" | wc -l
```

### 3. 触发导入

通过 QAI 前端侧边栏的上传按钮（搜索框右侧）触发导入，选择目录：
`/Users/zs/Workspace/eigenai/llm-trainer-gateway/e2e/cases`

或者，如果开发服务器运行中，可以通过 Tauri 的 invoke 接口直接调用：

提示用户在 QAI 应用中点击侧边栏的上传图标，选择 e2e/cases 目录，确认清空后导入。

### 4. 验证导入结果

导入完成后检查：
- 侧边栏应显示所有模型集合（按 TEXT/AUDIO/IMAGE/VIDEO 分组）
- 每个集合应包含对应的测试场景

## YAML 格式说明

每个 `.yml` 文件对应一个模型（QAI 集合），格式：

```yaml
model: model-id           # 模型 ID
name: 显示名称             # 集合名称
category: text            # 分类：text/audio/image/video
endpoint: /api/v1/...     # API 端点

scenarios:                # 场景列表
  - id: scenario-name     # 场景名 → 请求名
    description: 描述
    payload:              # JSON 请求体
      key: value
    form_data:            # 或 form-data 请求体
      key: value
    expect:
      status: 200         # 期望 HTTP 状态码
```

## 注意事项

- 导入会清空所有现有集合和用例
- 每个 YAML 文件的 `name` 字段作为集合名称
- 每个 scenario 自动创建 status_code 断言
- Headers 中自动添加 Content-Type
- Authorization header 需通过 QAI 环境变量配置