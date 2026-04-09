---
description: UX 交互体验审查与修复
allowed-tools: Bash(npx:*, npm:*), Read, Glob, Grep, Edit, Write, Agent
argument-hint: [--fix | --report | file/directory]
---

# UX 交互体验审查

$ARGUMENTS

---

参数说明：
- 无参数：全量审查，生成报告
- `--fix`：审查并自动修复
- `--report`：仅报告不修改
- 文件/目录：指定范围

> 本 skill 关注**用户体验层面**（交互流程、反馈、可发现性）。代码规范层面（颜色、i18n、样式一致性）请用 `/ui-review`。

## 1. 确定审查范围

默认扫描：
- `src/views/` — 页面级视图
- `src/components/` — 交互组件
- `src/stores/` — 状态管理（错误处理、竞态）
- `src/hooks/` — 全局行为（快捷键、运行器）

## 2. 逐维度检查

### 2.1 操作反馈完整性（P0）

**原则**：每个用户操作必须有明确的结果反馈（成功/失败/进行中）。

检查 Store 层所有 `invoke()` 调用：
```
grep -rn "await invoke" src/stores/ --include="*.ts"
```

逐个验证：
- [ ] 是否有 `try/catch`？
- [ ] catch 中是否 `toast.error(invokeErrorMessage(e))`？
- [ ] 长操作是否有 loading 态？（spinner、disabled 按钮）
- [ ] 成功后是否有视觉反馈？（toast、状态图标、UI 更新）

常见问题：
| 问题 | 修复 |
|------|------|
| `await invoke(...)` 无 try/catch | 包裹 try/catch + toast.error |
| debounce 保存无状态指示 | 添加 Cloud 图标 (saving/saved) |
| 批量操作无进度 | 添加 Progress 组件 |

### 2.2 危险操作防护（P0）

**原则**：不可逆操作必须有确认步骤，数据变更前必须告知用户影响。

```
grep -rn "delete\|remove\|clear\|reset" src/components/ --include="*.tsx" | grep -v "//\|import\|className"
```

检查清单：
- [ ] 删除操作是否调用 `useConfirmStore` 的 `confirm()` ？
- [ ] 协议/类型切换是否可能丢失数据？如果是，是否有确认弹窗？
- [ ] 重置/清空按钮是否区分了"清空结果"和"全部重置"？
- [ ] 编辑弹窗关闭时是否检查未保存变更？

### 2.3 表单校验及时性（P0）

**原则**：校验反馈应在用户离开字段时触发，而非提交时才报错。

```
grep -rn "error\|Error\|invalid\|touched" src/components/ --include="*.tsx"
```

- [ ] 必填字段是否有 `onBlur` 触发的校验？
- [ ] 校验错误是否在字段旁显示（而非只在 toast）？
- [ ] 非法输入（如 JSON 格式错误）是否有内联提示？

### 2.4 可发现性（P1）

**原则**：用户不应需要"猜"才能找到功能。

检查项：
- [ ] 快捷键是否在 UI 中有提示？（placeholder、tooltip、按钮标签）
- [ ] 隐藏在 hover 中的操作（如 `...` 菜单、编辑/删除按钮）是否有替代发现路径？
- [ ] 搜索/筛选无结果时是否有空状态提示？
- [ ] 首次使用流程中，关键操作是否有引导？

### 2.5 键盘可达性（P1）

**原则**：所有核心操作路径必须可通过键盘完成。

```
grep -rn "aria-label\|role=\|onKeyDown\|tabIndex" src/components/ --include="*.tsx" | wc -l
```

重点检查：
- [ ] 图标按钮是否有 `aria-label`？
- [ ] Tooltip 是否支持 `onFocus`/`onBlur` 触发？
- [ ] Dialog 是否有 Tab 焦点循环？
- [ ] 上下文菜单是否支持方向键导航？

### 2.6 状态管理与竞态（P1）

**原则**：并发操作不应导致 UI 状态不一致。

```
grep -rn "useEffect.*invoke\|async.*invoke" src/stores/ --include="*.ts"
```

- [ ] 多个 `loadTree()` 调用是否可能交错返回？
- [ ] 用户能否在批量执行期间修改/删除正在运行的项目？
- [ ] localStorage 中缓存的 ID 是否可能指向已删除实体？

### 2.7 空状态与边界情况（P2）

**原则**：每个可能为空的列表/区域都应有友好的空状态。

```
grep -rn "EmptyState\|empty\|length === 0" src/views/ src/components/ --include="*.tsx"
```

- [ ] 列表为空时是否显示 `<EmptyState>` 组件？
- [ ] 加载中是否显示骨架屏或 spinner？
- [ ] 搜索/筛选无结果是否与"真的没数据"有不同的提示？

### 2.8 错误恢复（P2）

- [ ] ErrorBoundary 是否提供重试按钮？
- [ ] 错误信息是否走 i18n（不硬编码中文）？
- [ ] 网络错误是否有区别于业务错误的提示？

## 3. 生成报告

按优先级分类输出：

| 优先级 | 范围 |
|--------|------|
| P0 | 操作静默失败、危险操作无确认、数据丢失风险 |
| P1 | 可发现性不足、键盘不可达、状态竞态 |
| P2 | 空状态缺失、错误恢复不完善、体验细节 |

每项列出：文件路径、行号、问题描述、建议修复方案。

## 4. 自动修复（仅 --fix 模式）

按 P0 → P1 → P2 顺序逐项修复。修复内容包括但不限于：
- Store 层添加 try/catch + toast
- 危险操作接入 `useConfirmStore`
- 表单添加 onBlur 校验
- 空状态添加 `<EmptyState>` 组件
- ErrorBoundary 文本走 i18n
- Tooltip 添加 onFocus/onBlur + aria
- 搜索框 placeholder 显示快捷键

修复后执行验证：
```bash
npx tsc --noEmit 2>&1; echo "EXIT:$?"
npm run build 2>&1 | tail -5; echo "EXIT:$?"
```

## 5. 输出最终摘要

列出修改文件清单和变更内容，方便 review。同步更新的 i18n key 必须中英文一起列出。

## 6. 经验沉淀

修复完成后，回顾本次发现的问题，判断是否有**可泛化的规律性教训**应写入 `.claude/rules/`：

- 对照 `ux-patterns.md`、`react-patterns.md`、`ui-design.md` 现有规则
- 如果某类问题反复出现但 rules 中未覆盖 → 新增规则条目
- 如果某条现有规则表述不够具体导致遗漏 → 补充细化
- 输出一张"现有 rules 覆盖 vs 缺失"对照表，标注需要新增/强化的条目
- 确认后更新对应 rules 文件
