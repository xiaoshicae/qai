---
description: 前端代码质量审查与修复（类型安全/Hook/性能/架构）
allowed-tools: Bash(npx:*, npm:*), Read, Glob, Grep, Edit, Write, Agent
argument-hint: [--fix | --report | file/directory]
---

# 前端代码质量审查

$ARGUMENTS

---

参数说明：
- 无参数：扫描全部前端代码，生成报告
- `--fix`：扫描并自动修复
- `--report`：仅生成报告，不做修改
- 文件/目录：指定扫描范围

> 本 skill 关注**代码正确性和工程质量**（类型安全、Hook 规范、性能、架构一致性）。  
> UI 规范层面（颜色、样式、i18n）请用 `/ui-review`。  
> 交互体验层面（反馈、可发现性）请用 `/ux-review`。

## 1. 静态分析

```bash
npx tsc --noEmit 2>&1; echo "EXIT:$?"
```

TypeScript 编译必须 0 错误后再进入人工审查。

## 2. 逐维度扫描

### 2.1 类型安全（P0）

```bash
# catch (e: any) — 应改为 catch (e: unknown)
grep -rn "catch (e: any)" src/ --include="*.{ts,tsx}"

# as any — 绕过类型检查
grep -rn "as any" src/ --include="*.{ts,tsx}"

# 非 unknown 的 catch 参数
grep -rn "catch (e:" src/ --include="*.{ts,tsx}" | grep -v "unknown"
```

修复模式：
```typescript
// 错误提取的标准写法
catch (e: unknown) {
  // 需要 string 消息 → invokeErrorMessage(e) 或 String(e)
  // 需要 Error.message → e instanceof Error ? e.message : String(e)
  // 需要完整错误展示 → toast.error(invokeErrorMessage(e))
}
```

### 2.2 Hook 规范（P0）

```bash
# eslint-disable react-hooks — 每个都要验证是否合理
grep -rn "eslint-disable.*react-hooks" src/ --include="*.{ts,tsx}"
```

逐个检查：
- [ ] 被压制的依赖是否真的稳定（Zustand store 方法、useCallback 返回值）？
- [ ] 是否存在闭包捕获旧值的风险？
- [ ] 能否通过加入依赖或 ref 模式消除压制？

### 2.3 内存泄漏（P0）

```bash
# setTimeout/setInterval 未清理
grep -rn "setTimeout\|setInterval" src/ --include="*.{ts,tsx}"

# addEventListener 未清理
grep -rn "addEventListener" src/ --include="*.{ts,tsx}" | grep -v "removeEventListener"

# listen() 未 unlisten
grep -rn "listen(" src/ --include="*.{ts,tsx}" | grep -v "unlisten\|cleanup\|return"
```

检查每个匹配项：
- [ ] setTimeout/setInterval 是否在 useEffect cleanup 或 useRef 中清理？
- [ ] addEventListener 是否有对应的 removeEventListener？
- [ ] Tauri listen() 的返回值是否在 cleanup 中调用？

### 2.4 错误处理（P0）

```bash
# Store 层 invoke() 无 try/catch
grep -rn "await invoke" src/stores/ --include="*.ts"

# 组件层 invoke() 无 try/catch
grep -rn "await invoke" src/components/ src/views/ --include="*.tsx"

# 空 catch 块
grep -rn "catch.*{.*}" src/ --include="*.{ts,tsx}" | grep -v "invokeErrorMessage\|toast\|console\|return\|set"
```

规则：
- Store 层每个 `invoke()` 必须 try/catch + `toast.error(invokeErrorMessage(e))`
- 组件层同理，或由调用方的 Store 方法处理
- 空 catch 块如果是故意的（JSON parse fallback），应有注释说明意图

### 2.5 性能（P1）

```bash
# render 中内联对象/数组传给子组件
grep -rn "options={\[" src/ --include="*.tsx"
grep -rn '\.map.*=>.*({.*value.*label' src/ --include="*.tsx"

# index 作 key
grep -rn "key={i}" src/ --include="*.tsx"
grep -rn "key={index}" src/ --include="*.tsx"

# 大文件
wc -l src/**/*.tsx 2>/dev/null | sort -rn | head -10
```

修复优先级：
1. **内联 options 数组** → 提取为模块级常量（不需要 useMemo，因为是静态数据）
2. **index 作 key** → 有唯一 ID 则用 ID；无 ID 则用 `${index}-${稳定字段}` 组合
3. **大文件 > 500 行** → 标记，建议后续用 `/refactor extract` 拆分

### 2.6 三面板一致性（P1）

> 规则：`request-panel.tsx`、`collection-overview-edit-parts.tsx`、`quick-test-dialog.tsx` 必须同步。

检查项：
- [ ] METHOD_COLORS 是否都从 `@/lib/styles` 导入并应用？
- [ ] URL 输入是否都使用 `VarInput` 组件？
- [ ] ⌘+Enter 发送快捷键是否都支持？
- [ ] Body 类型处理是否一致（5 种类型）？
- [ ] 错误处理是否都用 `toast.error(invokeErrorMessage(e))`？

### 2.7 架构合规（P2）

```bash
# 组件直接调用 invoke()（设置页除外）
grep -rn "invoke(" src/components/ --include="*.tsx" | grep -v "settings\|test\|import"

# Store 是否导入了 components（禁止反向依赖）
grep -rn "from.*components" src/stores/ --include="*.ts"
```

## 3. 生成报告

以表格形式输出，按优先级分类：

| 优先级 | 范围 |
|--------|------|
| P0 | `catch (e: any)`、Hook 依赖压制、裸 invoke、内存泄漏 |
| P1 | 内联对象/index key、三面板不一致、大文件 |
| P2 | 组件直接 invoke、架构违规、空 catch 无注释 |

每项列出：文件路径、行号、问题描述、建议修复方案。

## 4. 自动修复（仅 --fix 模式）

按 P0 → P1 → P2 顺序逐项修复。

典型修复模式：
- `catch (e: any)` → `catch (e: unknown)` + 类型安全提取
- 裸 invoke → 包裹 try/catch + toast.error
- eslint-disable → 补齐依赖或改用 ref 模式
- 内联 options → 提取模块级 `const XXX_OPTIONS = [...]`
- index key → `key={item.id}` 或 `key={\`${i}-${item.name}\`}`
- 三面板缺失 → 补齐 METHOD_COLORS / VarInput / ⌘+Enter

修复后验证：
```bash
npx tsc --noEmit 2>&1; echo "EXIT:$?"
npm run build 2>&1 | tail -5; echo "EXIT:$?"
```

## 5. 输出最终摘要

列出修改文件清单和变更内容，方便 review。

## 6. 经验沉淀

修复完成后，回顾本次发现的问题，判断是否有**可泛化的规律性教训**应写入 `.claude/rules/`：

- 对照 `react-patterns.md`、`architecture.md`、`ux-patterns.md` 现有规则
- 如果某类问题反复出现但 rules 中未覆盖 → 新增规则条目
- 如果某条现有规则表述不够具体导致遗漏 → 补充细化
- 输出一张"现有 rules 覆盖 vs 缺失"对照表，标注需要新增/强化的条目
- 确认后更新对应 rules 文件
