# UI 设计规范

## 设计风格

高端 SaaS Dashboard 风格，支持深色/浅色双主题。参考：Linear、concierge.ai、Hoppscotch。

## 主题系统

- `useThemeStore` 管理 `dark`/`light`/`system` 三种模式
- `<html>` 上添加 `.dark`/`.light` 类切换
- CSS 结构：`@theme {}` 浅色默认 → `.dark {}` 覆盖 → `:root:not(.dark) {}` 浅色特定

## overlay 色（核心概念）

`--color-overlay`：深色=白色，浅色=黑色。**所有半透明叠加必须用 `overlay`，禁止硬编码 `white`/`black`。**

```
bg-overlay/[0.03] 输入框背景 | /[0.04] hover | /[0.06] 分割线/badge | /[0.08] active/selected
border-overlay/[0.06] 静态 | /[0.08] 输入框 | /[0.10] hover | /[0.12] 焦点 | /[0.15] 最强
```

浅色模式 overlay 补偿已在 `index.css` 中自动处理，组件无需额外适配。

## 语义化颜色

**必须使用语义变量，禁止硬编码颜色（`text-emerald-500` 等）**

- 状态：`text-success`/`text-warning`/`text-error`/`text-info` + 对应 `bg-*`
- HTTP 方法：`text-method-get`/`post`/`put`/`delete`/`patch`
- 变量高亮：`text-variable`
- 色彩空间 OKLch，禁止纯灰（色度 0），具体值见 `index.css`

## 效果类（自动适配双主题）

- `glass-card` — 毛玻璃卡片
- `btn-gradient` — 渐变主色按钮（已内置到 Button 组件）
- `glow-ring` — 选中态微光
- `text-gradient` — 渐变文字
- `divider-glow` — 面板分隔线

## 交互态 / 边框 / 圆角 / 间距 / 过渡

```
交互:  hover → bg-overlay/[0.04]  active/selected → bg-overlay/[0.08] + glow-ring
边框:  静态 border-overlay/[0.06]  输入框 /[0.08]  hover /[0.10]  焦点 border-primary/50 + ring-2 ring-primary/20
圆角:  badge rounded-lg  按钮/输入 rounded-xl  卡片/弹窗 rounded-2xl
间距:  卡片 p-5  卡片间 space-y-4  按钮高 h-9  页面容器统一 px-6 py-6
过渡:  快速 duration-150  标准 duration-200  慢速 duration-300
```

## 禁止写法速查

| 禁止 | 替代 |
|------|------|
| `text-emerald/red/amber/blue-500` | `text-success/error/warning/info` |
| `bg-white` / `bg-white/[0.0x]` / `border-white/[0.0x]` | `bg-background`（toggle 圆点等需要实体背景时）或 `bg-overlay/[0.0x]` |
| `bg-muted` / `bg-accent` / `border-border` | `bg-overlay/[0.04]` / `bg-overlay/[0.08]` / `border-overlay/[0.06]` |
| `ring-1 ring-foreground/10` | `border border-overlay/[0.06]` 或 `glass-card` |
| `focus:ring-1` | `focus-visible:ring-2 focus-visible:ring-primary/20` |
| `shadow-md/xl/lg`（浮层） | `shadow-2xl` |
| `hover:bg-accent` | `hover:bg-overlay/[0.06]` |
| 原生 `<select>` | `@/components/ui/select.tsx` |
| `tauriConfirm` / `alert()` / `confirm()` | `useConfirmStore` (`confirm-dialog.tsx`) |
| 魔法数字 `max-h-[120px]` | Tailwind 标准尺寸或 CSS 变量 |
| 单色阶 `text-sky-400` | `text-sky-600 dark:text-sky-400` |

## 浮层菜单

```
容器: rounded-xl glass-card p-1.5 shadow-2xl
菜单项: px-3 py-2 rounded-lg text-xs hover:bg-overlay/[0.06] transition-colors
分割线: h-px bg-overlay/[0.06] my-1    危险项: text-destructive hover:bg-destructive/10
```

使用 `src/lib/styles.ts` 中的 `MENU_CONTAINER_CLASS`/`MENU_ITEM_CLASS` 等常量。

## 遮罩层

统一 `bg-black/50 backdrop-blur-sm`。`bg-black` 是唯一允许硬编码的颜色（遮罩不需要主题适配）。

## 侧边栏间距

Logo 区 `px-4`，其余 `px-2.5`。禁止 `px-1.5`/`px-2`/`px-3`。

## macOS 标题栏

侧边栏顶部 `pt-9` + `data-tauri-drag-region`，主内容区顶部 `h-8` + `data-tauri-drag-region`。

## 语法高亮

浅色 `-600` 色阶，深色 `-400`。定义在 `src/lib/syntax.ts`，禁止重复定义。

## Body 类型

5 种：none / form-data / urlencoded / json / raw。`form-data`/`urlencoded` 的 body_content 存储为 `JSON.stringify([{key, value, enabled}])`。

## 布局防跳动

- 条件内容不能改变容器尺寸（固定 minHeight）
- 条件按钮用 `invisible` 占位或 `absolute` 浮动

## UX 交互

- 删除必须弹确认（`useConfirmStore` + `t('common.confirm_delete', { name })`）
- 编辑弹窗关闭前对比快照检测变更
- 空状态统一用 `<EmptyState>` 组件
- 按钮只用 `sm`(h-8) 和 `default`(h-9) 两档
- Split Button 下拉区域必须是按钮内部子元素
- 表格 ≤ 6 列，数值列 `tabular-nums`
- i18n：所有文本走 `t()` 调用，禁止硬编码中文

## 组件检查清单

- [ ] 半透明用 `overlay`，状态色用语义变量，方法色用 `text-method-*`
- [ ] 卡片 `glass-card`，浮层 `rounded-xl glass-card shadow-2xl`
- [ ] 焦点态 `focus-visible:ring-2`，过渡 `duration-200`
- [ ] 圆角层级：badge=lg, 按钮=xl, 卡片=2xl
- [ ] 条件内容不改变容器尺寸
- [ ] 深色/浅色模式都测试过
- [ ] 空状态用 `<EmptyState>`，右键菜单用 `<ContextMenu>`
- [ ] 弹窗关闭检查未保存变更
- [ ] i18n 完整，禁用态 opacity ≥ 50 + `cursor-not-allowed`
