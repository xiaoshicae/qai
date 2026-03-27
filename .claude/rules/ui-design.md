# UI 设计规范

## 设计风格

高端 SaaS Dashboard 风格，支持深色/浅色双主题。参考：Linear、concierge.ai、Hoppscotch。

## 主题系统

### 切换机制

- 通过 `useThemeStore`（`src/stores/theme-store.ts`）管理，支持 `dark` / `light` / `system` 三种模式
- 在 `<html>` 上添加 `.dark` 或 `.light` 类来切换
- 持久化到 SQLite settings 表（key: `theme_mode`）
- `system` 模式监听 `prefers-color-scheme` 媒体查询

### CSS 变量结构

```
index.css:
  @theme { ... }        ← 浅色主题为默认值
  .dark { ... }         ← 深色主题覆盖
  :root:not(.dark) { }  ← 浅色特定样式
```

## overlay 色（核心概念）

**`--color-overlay`** 是双主题系统的关键：
- 深色模式 = 白色 `oklch(1 0 0)` → 叠加在深底上产生"微亮"效果
- 浅色模式 = 黑色 `oklch(0 0 0)` → 叠加在浅底上产生"微暗"效果

**所有半透明叠加层必须使用 `overlay`，禁止硬编码 `white` 或 `black`。**

```
bg-overlay/[0.03]   ← 输入框/textarea 背景
bg-overlay/[0.04]   ← hover 态
bg-overlay/[0.06]   ← 分割线、badge 背景
bg-overlay/[0.08]   ← active/selected 态
border-overlay/[0.06] ← 静态边框
border-overlay/[0.08] ← 输入框边框
border-overlay/[0.10] ← hover 边框
border-overlay/[0.12] ← 焦点/强调边框
border-overlay/[0.15] ← 最强边框（radio 等）
```

## 色彩系统

所有颜色使用 OKLch 色彩空间，**禁止纯灰**（色度 0），每个灰度加微量蓝紫色调（色度 0.002~0.006，色相 260）。

### 深色色板

| 用途 | 值 | Tailwind |
|------|-----|---------|
| 背景 | `oklch(0.145 0.004 260)` | `bg-background` |
| 卡片 | `oklch(0.185 0.005 260)` | `bg-card` |
| 侧边栏 | `oklch(0.125 0.004 260)` | `bg-sidebar` |
| 前景文字 | `oklch(0.93 0.005 260)` | `text-foreground` |
| 次要文字 | `oklch(0.55 0.01 260)` | `text-muted-foreground` |
| 品牌色 | `oklch(0.65 0.18 240)` | `text-primary` |

### 浅色色板

| 用途 | 值 | Tailwind |
|------|-----|---------|
| 背景 | `oklch(0.965 0.002 260)` | `bg-background` |
| 卡片 | `oklch(1 0 0)` | `bg-card` |
| 侧边栏 | `oklch(0.975 0.002 260)` | `bg-sidebar` |
| 前景文字 | `oklch(0.14 0.005 260)` | `text-foreground` |
| 次要文字 | `oklch(0.45 0.01 260)` | `text-muted-foreground` |
| 品牌色 | `oklch(0.55 0.2 250)` | `text-primary` |

## 效果类（自动适配双主题）

### glass-card

深色：半透明深灰底 + 白色微光边框 + 强阴影 + 顶部内光
浅色：半透明白底 + 黑色微光边框 + 柔和阴影

```html
<div className="glass-card rounded-2xl p-5">...</div>
```

### btn-gradient

深色：亮青蓝→紫蓝渐变 + 品牌色光晕
浅色：深青蓝→紫蓝渐变 + 更强投影

```html
<button className="btn-gradient text-primary-foreground">...</button>
```

### glow-ring

选中态微光，深浅色自动调整亮度。

### text-gradient

渐变文字，深色更亮，浅色更暗以保证对比度。

### divider-glow

面板间分隔线，深浅色自动调整透明度。

## 交互态

```
默认:     bg-transparent
Hover:    bg-overlay/[0.04]
Active:   bg-overlay/[0.08]
Selected: bg-overlay/[0.08] + glow-ring
```

## 边框

```
静态:     border-overlay/[0.06]
输入框:   border-overlay/[0.08]
Hover:    border-overlay/[0.10] 或 hover:border-overlay/[0.12]
焦点:     border-primary/50 + ring-2 ring-primary/20
分割线:   border-overlay/[0.06] 或 border-overlay/[0.04]
```

## 圆角

```
小元素（badge）     →  rounded-lg  (6px)
中等（按钮/输入框）→  rounded-xl  (12px)
大容器（卡片/弹窗）→  rounded-2xl (16px)
```

## 间距

```
卡片内 padding:    p-5
卡片间 gap:        space-y-4
按钮/输入框高度:   h-9
页面 padding:      px-8 py-8
```

## 过渡

所有交互元素：`transition-all duration-200`

## 禁止的写法

| 禁止 | 替代 | 原因 |
|------|------|------|
| `bg-white/[0.0x]` | `bg-overlay/[0.0x]` | 浅色模式下白底叠白色不可见 |
| `border-white/[0.0x]` | `border-overlay/[0.0x]` | 同上 |
| `ring-1 ring-foreground/10` | `border border-overlay/[0.06]` 或 `glass-card` | 旧写法，不统一 |
| `dark:bg-input/30` | 已内置到 Input/Textarea 组件 | 使用 overlay 系统 |
| `bg-muted/30` | `bg-overlay/[0.03]` | 统一用 overlay |
| `border-border` (JSX 中) | `border-overlay/[0.06]` | 统一用 overlay |
| `bg-surface-1` | `bg-overlay/[0.03]` | 不存在的变量 |
| 原生 `<select>` | `@/components/ui/select.tsx` | 原生下拉白色系统样式 |
| `tauriConfirm` / `tauri-plugin-dialog` 的 `confirm` | `useConfirmStore` (`@/components/ui/confirm-dialog.tsx`) | 原生弹窗白色系统样式 |

## 原生控件替代

### 自定义 Select

```tsx
import { Select } from '@/components/ui/select'
<Select value={v} onChange={setV} options={[{ value: 'a', label: 'A' }]} />
```

### 自定义确认弹窗

```tsx
import { useConfirmStore } from '@/components/ui/confirm-dialog'
const confirm = useConfirmStore((s) => s.confirm)
const ok = await confirm('确定删除？', { title: '删除', kind: 'warning' })
```

## macOS 标题栏

- `tauri.conf.json`: `titleBarStyle: "Overlay"` + `hiddenTitle: true`
- 侧边栏顶部 `pt-9` + `data-tauri-drag-region`
- 主内容区/AI 面板顶部 `h-8` + `data-tauri-drag-region`

## 浅色模式 overlay 补偿

浅色模式下 `overlay/[0.06]` (6% 黑色在白底) 几乎不可见。
`index.css` 中通过 CSS 选择器覆盖，将浅色模式的 overlay 透明度统一提升约 2 倍：

```css
:root:not(.dark) .border-overlay\/\[0\.06\] { border-color: oklch(0 0 0 / 0.12); }
:root:not(.dark) .bg-overlay\/\[0\.04\] { background-color: oklch(0 0 0 / 0.06); }
/* ... 等 */
```

**不需要在组件中写额外的浅色模式适配代码**，CSS 层自动处理。

## 布局防跳动规范

### 条件内容不能改变容器尺寸

弹窗内切换显示/隐藏内容时，必须保持容器高度不变：

```tsx
// 错误：条件渲染导致弹窗尺寸跳动
{bodyType !== 'none' && <textarea rows={8} />}

// 正确：固定容器高度，所有状态共用
<div style={{ minHeight: '218px' }}>
  {bodyType === 'none' ? (
    <div className="h-full ...">无请求体</div>
  ) : (
    <textarea className="h-full ..." />
  )}
</div>
```

### 工具按钮不能影响布局

条件出现的按钮（如 Format）不应该在标签栏内导致其他按钮位移：

```tsx
// 错误：条件渲染导致标签组宽度变化
{bodyType === 'json' && <button>Format</button>}

// 正确方案 A：invisible 占位
<button className={bodyType === 'json' ? '' : 'invisible'}>Format</button>

// 正确方案 B：浮动在内容区内
<div className="relative">
  <textarea />
  {bodyType === 'json' && (
    <button className="absolute top-2 right-2 ...">Format</button>
  )}
</div>
```

## Body 类型规范

支持 5 种 body 类型：

| 类型 | body_type | 编辑器 | Content-Type |
|------|-----------|--------|-------------|
| None | `none` | 占位框 | (不发送) |
| Form Data | `form-data` | KeyValueTable | multipart/form-data |
| URL Encoded | `urlencoded` | KeyValueTable | x-www-form-urlencoded |
| JSON | `json` | textarea + Format | application/json |
| Raw | `raw` | textarea | (手动设置) |

- `form-data` 和 `urlencoded` 的 body_content 存储格式：`JSON.stringify([{key, value, enabled}])`
- Rust 端 `form-data` 用 `reqwest::multipart::Form`，`urlencoded` 用 `builder.form()`
- 旧的 `form` 类型等同于 `urlencoded`，Rust 端做了兼容

## 新建/修改组件检查清单

- [ ] 半透明叠加用 `overlay`，不用 `white` 或 `black`
- [ ] 不使用 `ring-1 ring-foreground/10`
- [ ] 不使用原生 `<select>` 或 `tauriConfirm`
- [ ] 卡片用 `glass-card` 或 `border border-overlay/[0.06]`
- [ ] 交互态用 `bg-overlay/[0.04]`（hover）、`bg-overlay/[0.08]`（active）
- [ ] 圆角层级正确
- [ ] 有 `transition-all duration-200`
- [ ] 条件内容不改变容器尺寸（防跳动）
- [ ] 在深色和浅色模式下都测试过
