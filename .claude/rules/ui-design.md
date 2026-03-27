# UI 设计规范

## 设计风格

高端深色 SaaS Dashboard 风格。参考：Linear、concierge.ai、Hoppscotch。

## 色彩系统

所有颜色使用 OKLch 色彩空间，**禁止纯灰**（色度 0），每个灰度加微量蓝紫色调（色度 0.004~0.006，色相 260）。

### 三级灰度层次

```
背景层（最深）   oklch(0.145 0.004 260)  →  bg-background / bg-sidebar
卡片层（中间）   oklch(0.185 0.005 260)  →  bg-card / glass-card
表面层（最浅）   oklch(0.21  0.006 260)  →  bg-surface
```

### 交互态统一系统

```
默认:     bg-transparent
Hover:    bg-white/[0.04]
Active:   bg-white/[0.08]
Selected: bg-white/[0.08] + glow-ring
```

## 边框系统

**使用半透明白色边框，禁止实色 border 变量。**

```
静态:   border-white/[0.06]
Hover:  border-white/[0.08] 或 border-white/[0.1]
焦点:   border-primary/50 + ring-2 ring-primary/20
分割线: border-white/[0.04] 或 border-white/[0.06]
```

### 禁止的旧写法

| 禁止 | 替代 |
|------|------|
| `ring-1 ring-foreground/10` | `border border-white/[0.06]` 或 `glass-card` |
| `dark:bg-input/30` | 已内置到 Input/Textarea 组件 |
| `bg-muted/30` | `bg-white/[0.03]` |
| `bg-muted/50` | `bg-white/[0.04]` |
| `border-border` (JSX 中) | `border-white/[0.06]` |
| `border-foreground/5` | `border-white/[0.04]` |
| `bg-surface-1` | `bg-white/[0.03]` |
| `bg-sidebar-accent` | `bg-white/[0.08]` |

## 卡片与容器

### glass-card（毛玻璃卡片）

用于所有独立卡片、弹窗、右键菜单：

```css
.glass-card {
  background: oklch(0.185 0.005 260 / 0.8);
  border: 1px solid oklch(1 0 0 / 0.06);
  box-shadow: 0 0 0 1px oklch(0 0 0 / 0.3), 0 2px 8px oklch(0 0 0 / 0.2), inset 0 1px 0 oklch(1 0 0 / 0.03);
  backdrop-filter: blur(12px);
}
```

关键点：`inset 0 1px 0 rgba(255,255,255,0.03)` 顶部内光是高级感的核心。

### glow-ring（选中态微光）

用于选中的列表项、活跃的导航标签：

```css
.glow-ring {
  box-shadow: 0 0 0 1px oklch(0.65 0.18 240 / 0.3), 0 0 8px oklch(0.65 0.18 240 / 0.1);
}
```

## 按钮

### 主按钮：渐变 + 光晕

```css
.btn-gradient {
  background: linear-gradient(135deg, oklch(0.6 0.18 240), oklch(0.55 0.2 280));
  box-shadow: 0 1px 2px oklch(0 0 0 / 0.3), 0 0 12px oklch(0.6 0.18 240 / 0.15);
}
```

渐变方向统一 135deg，青蓝（hue 240）→ 紫蓝（hue 280）。

### 按钮禁用态

`disabled:opacity-40`（不是 50）。

## 圆角

```
小元素（badge、标签）   →  rounded-lg  (6px)
中等元素（按钮、输入框）→  rounded-xl  (12px)
大容器（卡片、弹窗）    →  rounded-2xl (16px)
```

同一层级圆角一致，嵌套元素内层比外层小。

## 间距

```
卡片内 padding:  p-5  (20px)
卡片间 gap:      space-y-4
按钮高度:        h-9  (36px)
输入框高度:      h-9  (36px)
页面 padding:    px-8 py-8
```

原则：宁可留白多，也不要挤。

## 分割线

```
面板内分割线:   border-t border-white/[0.06]
面板间分隔:     divider-glow (渐变发光)
```

禁止使用 `border-t border-border` 这种实色分割线。

## 过渡动画

所有交互元素：`transition-all duration-200`。

## 原生控件替代

### 禁止使用原生 `<select>`

macOS WebView 的原生 select 下拉菜单为白色系统样式，与深色主题冲突。

必须使用 `@/components/ui/select.tsx`（自定义 Select 组件）。

### 禁止使用原生系统弹窗

`tauri-plugin-dialog` 的 `confirm()` 弹出白色系统弹窗。

必须使用 `@/components/ui/confirm-dialog.tsx`（useConfirmStore）。

```tsx
// 禁止
import { confirm } from '@tauri-apps/plugin-dialog'

// 正确
import { useConfirmStore } from '@/components/ui/confirm-dialog'
const confirm = useConfirmStore((s) => s.confirm)
const ok = await confirm('确定删除？', { title: '删除', kind: 'warning' })
```

## macOS 标题栏

- `tauri.conf.json` 中配置 `titleBarStyle: "Overlay"` + `hiddenTitle: true`
- 侧边栏顶部 `pt-9` + `data-tauri-drag-region`
- 主内容区/AI 面板顶部 `h-8` + `data-tauri-drag-region`
- 红绿灯所在区域内子元素也需要 `data-tauri-drag-region` 属性

## 新建组件检查清单

新增或修改任何 UI 组件时：

- [ ] 不使用纯灰色 `oklch(x 0 0)`
- [ ] 不使用实色 border 变量（`border-border`）
- [ ] 不使用 `ring-1 ring-foreground/10`
- [ ] 不使用原生 `<select>` 或 `tauriConfirm`
- [ ] 不使用 `dark:bg-input/30`
- [ ] 卡片用 `glass-card` 或 `border border-white/[0.06]`
- [ ] 交互态用 `bg-white/[0.04]`（hover）和 `bg-white/[0.08]`（active）
- [ ] 圆角层级正确（xl → 2xl → lg 由内到外）
- [ ] 有 `transition-all duration-200`
