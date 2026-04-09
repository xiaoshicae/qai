---
description: UI 规范审查与修复
allowed-tools: Bash(npx:*, npm:*), Read, Glob, Grep, Edit, Write, Agent
argument-hint: [--fix | --report | file/directory]
---

# UI 规范审查

$ARGUMENTS

---

参数说明：
- 无参数：扫描全部前端代码，生成报告
- `--fix`：扫描并自动修复所有发现的问题
- `--report`：仅生成报告，不做修改
- 文件/目录：指定扫描范围

## 1. 扫描范围确定

默认扫描 `src/` 下所有 `.tsx`、`.ts` 文件。如指定文件/目录则缩小范围。

## 2. 逐项检查

按以下检查项依次扫描，使用 Grep/Glob 搜索违规模式。

### 2.1 颜色规范（对照 `.claude/rules/ui-design.md`）

```bash
# 禁止的硬编码颜色（应使用语义变量）
grep -rn "text-emerald|text-red-|text-amber-|text-blue-|text-green-|text-sky-(?!600)" src/ --include="*.tsx"
grep -rn "text-emerald-500" src/ --include="*.tsx"  # → text-success
grep -rn "bg-emerald" src/ --include="*.tsx"         # → bg-success
grep -rn "bg-white" src/ --include="*.tsx"            # → bg-overlay 或 bg-background
grep -rn "border-white" src/ --include="*.tsx"        # → border-overlay
grep -rn "bg-muted|bg-accent|border-border" src/ --include="*.tsx"  # → overlay 系
grep -rn "hover:bg-accent" src/ --include="*.tsx"     # → hover:bg-overlay/[0.06]
grep -rn "shadow-md|shadow-xl|shadow-lg" src/ --include="*.tsx"  # 浮层应用 shadow-2xl
```

替换规则：
| 违规 | 替代 |
|------|------|
| `text-emerald-500` | `text-success` |
| `bg-emerald-500/10` | `bg-success/10` |
| `bg-white` | `bg-background`（toggle 圆点等）|
| `border-white` | `border-overlay/[0.06]` |
| `hover:bg-accent` | `hover:bg-overlay/[0.06]` |

### 2.2 i18n 完整性

```bash
# 搜索硬编码中文（应走 t() 调用）
grep -rn '[\u4e00-\u9fff]' src/ --include="*.tsx" | grep -v "import\|//\|console\|\.test\."
```

对每个发现的硬编码中文：
1. 确认是否属于用户可见文本（排除注释、console）
2. 在 `src/locales/zh.json` 和 `src/locales/en.json` 中添加对应 key
3. 替换为 `t('namespace.key')` 调用
4. **两个语言文件的 key 必须同步**

### 2.3 重复定义

```bash
# 搜索常量/类型/工具函数的重复定义
grep -rn "METHOD_COLORS" src/ --include="*.{ts,tsx}"
grep -rn "const STATUS_" src/ --include="*.{ts,tsx}"
```

- 已在 `src/lib/styles.ts` 定义的常量，其他文件应 `import` 而非重复定义
- 已在 `src/lib/formatters.ts`、`src/lib/utils.ts` 定义的工具函数同理

### 2.4 无障碍（a11y）

```bash
# 检查图标按钮是否有 aria-label
grep -rn "aria-label" src/ --include="*.tsx" | wc -l
```

重点检查：
- 纯图标按钮（无文本子元素）必须有 `aria-label`
- Dialog 必须有 `role="dialog"` + `aria-modal` + `aria-labelledby`
- 交互元素支持 Tab 导航

### 2.5 console.log 残留

```bash
grep -rn "console\.log\|console\.warn\|console\.error" src/ --include="*.{ts,tsx}" | grep -v "import.meta.env.DEV"
```

- 生产代码中的 `console.log` 必须有 `import.meta.env.DEV` 守卫
- `console.error` 在 catch 块中可接受，但建议用 DEV 守卫

### 2.6 布局一致性

检查各视图页面的容器宽度和间距是否统一：
```bash
grep -rn "max-w-\|px-[0-9]" src/views/ --include="*.tsx"
```

- 同类页面应使用一致的 `max-w-*` 和 `px-*`
- 设置类页面：`max-w-xl px-6`
- 内容类页面：`max-w-3xl ~ max-w-5xl px-6`

### 2.7 组件样式一致性（对照 ui-design.md）

- 卡片容器：应使用 `glass-card rounded-2xl`，而非 `bg-card border`
- 浮层菜单：`rounded-xl glass-card p-1.5 shadow-2xl`
- 焦点态：`focus-visible:ring-2 focus-visible:ring-primary/20`
- 过渡动画：统一 `duration-200`
- 按钮只用 `sm`(h-8) 和 `default`(h-9) 两档

## 3. 生成报告

以表格形式输出，按优先级分类：

| 优先级 | 类别 | 说明 |
|--------|------|------|
| P0 | 必修 | 违反设计规范的硬编码颜色、硬编码中文、安全问题 |
| P1 | 建议 | 重复定义、主题适配问题、console 残留 |
| P2 | 改善 | 无障碍、布局不一致、样式不统一 |
| P3 | 锦上添花 | 动效、间距微调、骨架屏优化 |

## 4. 自动修复（仅 --fix 模式）

按优先级从 P0 到 P3 依次修复。每修复一项后标记完成。

修复完成后执行验证：
```bash
npx tsc --noEmit 2>&1; echo "EXIT:$?"
npm run build 2>&1 | tail -5; echo "EXIT:$?"
```

## 5. 输出最终摘要

列出所有修改的文件和具体变更内容，方便用户 review。

## 6. 经验沉淀

修复完成后，回顾本次发现的问题，判断是否有**可泛化的规律性教训**应写入 `.claude/rules/`：

- 对照 `ui-design.md`、`react-patterns.md`、`ux-patterns.md` 现有规则
- 如果某类问题反复出现但 rules 中未覆盖 → 新增规则条目
- 如果某条现有规则表述不够具体导致遗漏 → 补充细化
- 输出一张"现有 rules 覆盖 vs 缺失"对照表，标注需要新增/强化的条目
- 确认后更新对应 rules 文件
