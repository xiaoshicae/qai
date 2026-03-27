# QAI UI 设计规范 — 高端深色 SaaS 风格

> 本文档总结了 QAI 界面从"功能可用"升级到"高端质感"的设计方法论和具体实现，供后续 AI 或设计师参考。

## 一、设计目标

对标 concierge.ai、Linear、Hoppscotch 等产品的深色主题，实现：
- 深沉但不死板的暗色基调
- 毛玻璃/磨砂质感的卡片效果
- 渐变色点缀取代纯色块
- 充足的呼吸感（间距、圆角）
- 微妙的光影层次感

## 二、核心设计原则

### 1. 三级灰度层次（最关键）

深色主题最常见的问题是"所有东西糊在一起"。解决方案是建立清晰的 3 级表面层次：

```
背景层（最深）  →  卡片层（中间）  →  交互层（最浅）
#1a1a2e            #252540            #2d2d4a
```

具体实现（使用 OKLch 色彩空间）：

```css
--color-background: oklch(0.145 0.004 260);   /* 最深 - 页面底色 */
--color-card: oklch(0.185 0.005 260);          /* 中间 - 卡片/面板 */
--color-surface: oklch(0.21 0.006 260);        /* 最浅 - 悬浮/弹窗 */
```

**关键点**：不要用纯灰（色度 0），给每个灰度加一点点蓝/紫色调（色度 0.004~0.006，色相 260），视觉上更高级。

### 2. 微透明边框系统（取代实色 border）

不要用 `border-gray-700` 这种实色边框，改用白色半透明：

```css
/* 静态边框 */
border: 1px solid rgba(255, 255, 255, 0.06);   /* border-white/[0.06] */

/* Hover 边框 */
border: 1px solid rgba(255, 255, 255, 0.10);   /* border-white/[0.10] */

/* 选中/焦点边框 */
border: 1px solid rgba(255, 255, 255, 0.12);   /* border-white/[0.12] */
```

**为什么**：半透明白色边框能自动适应任何底色，不会出现"边框太突兀"或"边框看不见"的问题。

### 3. 毛玻璃卡片效果（glass-card）

这是质感提升最大的单一技巧：

```css
.glass-card {
  background: oklch(0.185 0.005 260 / 0.8);     /* 半透明背景 */
  border: 1px solid oklch(1 0 0 / 0.06);         /* 微光白色边框 */
  box-shadow:
    0 0 0 1px oklch(0 0 0 / 0.3),                /* 外层阴影轮廓 */
    0 2px 8px oklch(0 0 0 / 0.2),                 /* 投影 */
    inset 0 1px 0 oklch(1 0 0 / 0.03);           /* 顶部内光（关键！） */
  backdrop-filter: blur(12px);                     /* 背景模糊 */
}
```

**关键点**：`inset 0 1px 0 rgba(255,255,255,0.03)` 这个顶部内光效果是区分"普通卡片"和"高级卡片"的关键。

### 4. 渐变取代纯色（用于强调元素）

主按钮、选中态等不要用单一纯色，改用微妙渐变：

```css
.btn-gradient {
  background: linear-gradient(135deg, oklch(0.6 0.18 240), oklch(0.55 0.2 280));
  box-shadow:
    0 1px 2px oklch(0 0 0 / 0.3),                /* 基础投影 */
    0 0 12px oklch(0.6 0.18 240 / 0.15);         /* 品牌色光晕 */
}
```

渐变方向统一为 `135deg`（左上到右下），颜色从青蓝（hue 240）过渡到紫蓝（hue 280）。

### 5. 选中态微光效果（glow-ring）

替代 `ring-2 ring-primary`，用更柔和的光晕：

```css
.glow-ring {
  box-shadow:
    0 0 0 1px oklch(0.65 0.18 240 / 0.3),        /* 1px 色环 */
    0 0 8px oklch(0.65 0.18 240 / 0.1);           /* 外扩光晕 */
}
```

## 三、间距与圆角规范

### 圆角

```
小元素（badge、标签）   →  rounded-lg  (6px)
中等元素（按钮、输入框）→  rounded-xl  (12px)
大容器（卡片、面板）    →  rounded-2xl (16px)
```

基础值从 `0.375rem` 提升到 `0.5rem`，整体更柔和。

### 间距

```
卡片内 padding:  p-5  (20px)     ← 原来 p-4
卡片间 gap:      space-y-4       ← 原来 space-y-3
按钮高度:        h-9  (36px)     ← 原来 h-8
输入框高度:      h-9  (36px)     ← 原来 h-8
页面 padding:    px-8 py-8       ← 原来 px-6 py-6
```

**原则**：宁可留白多一点，也不要挤在一起。高端感 = 呼吸感。

## 四、交互态规范

### 统一的 hover/active 系统

```
默认态:    bg-transparent
Hover:     bg-white/[0.04]    ← 极其微弱的白色叠加
Active:    bg-white/[0.08]    ← 稍强的白色叠加
Selected:  bg-white/[0.08] + glow-ring
```

**不要用** `bg-muted/50`、`bg-accent/30` 这种变量叠加，直接用 `bg-white/[0.0x]` 更一致且易于理解。

### 过渡动画

所有交互元素加 `transition-all duration-200`（200ms 全属性过渡），避免视觉跳变。

## 五、macOS 标题栏集成

### 问题
Tauri 默认标题栏是白色，与深色主题严重不协调。

### 解决方案

`tauri.conf.json`:
```json
{
  "titleBarStyle": "Overlay",
  "hiddenTitle": true
}
```

前端布局：
```tsx
{/* 顶部拖拽区域，给红绿灯按钮留空间 */}
<div className="h-8 shrink-0" data-tauri-drag-region="" />
```

- 侧边栏顶部：`pt-8` + `data-tauri-drag-region`（红绿灯所在区域）
- 主内容区/AI 面板顶部：同样加 `h-8` 拖拽区域
- 拖拽区域上的子元素会阻断拖拽，确保 logo、标题等不可点击区域也带 `data-tauri-drag-region`

## 六、分割线处理

### 不要用实色分割线

```css
/* 避免 */
border-top: 1px solid var(--color-border);

/* 推荐：极淡的半透明白色 */
border-top: 1px solid rgba(255, 255, 255, 0.06);
```

### 面板间分割线用渐变

```css
.divider-glow {
  background: linear-gradient(
    to bottom,
    transparent,
    oklch(0.65 0.18 240 / 0.15) 50%,
    transparent
  );
}
```

上下渐隐的品牌色分割线，比实色线精致得多。

## 七、配色速查表

| 用途 | 颜色值 | Tailwind 写法 |
|------|--------|---------------|
| 页面背景 | `oklch(0.145 0.004 260)` | `bg-background` |
| 卡片背景 | `oklch(0.185 0.005 260)` | `bg-card` / `glass-card` |
| 侧边栏 | `oklch(0.125 0.004 260)` | `bg-sidebar` |
| 主文字 | `oklch(0.93 0.005 260)` | `text-foreground` |
| 次要文字 | `oklch(0.55 0.01 260)` | `text-muted-foreground` |
| 品牌色 | `oklch(0.65 0.18 240)` | `text-primary` / `bg-primary` |
| 静态边框 | `rgba(255,255,255,0.06)` | `border-white/[0.06]` |
| Hover 背景 | `rgba(255,255,255,0.04)` | `bg-white/[0.04]` |
| 选中背景 | `rgba(255,255,255,0.08)` | `bg-white/[0.08]` |
| 成功色 | emerald-400 | `text-emerald-400` |
| 错误色 | `oklch(0.637 0.208 25)` | `text-destructive` |

## 八、避坑清单

1. **不要用纯黑 `#000`** — 太死板，用 `oklch(0.145 ...)` 带一点色调
2. **不要用纯灰 `oklch(x 0 0)`** — 加一点色度（0.004~0.006），色相 260（蓝紫）
3. **不要用 `ring-1 ring-foreground/10`** — 改用 `glass-card` 或 `border-white/[0.06]`
4. **不要用 `dark:bg-input/30` hack** — 统一用半透明白色 `bg-white/[0.03]`
5. **不要用 `bg-muted/50` 做 hover** — 统一用 `bg-white/[0.04]`
6. **不要 mix 不同的边框系统** — 要么全用 `border-white/[0.0x]`，要么全用 CSS 变量
7. **按钮禁用态** — 用 `opacity-40`（不是 50），更优雅的灰度
8. **圆角要统一** — 同一层级的元素圆角必须一致，嵌套元素内层圆角比外层小 4px

## 九、设计参考站点

| 站点 | 用途 |
|------|------|
| [Layers.to](https://layers.to) | 设计师作品集，搜 "dark dashboard" |
| [Dark Design](https://dark.design) | 专门收录深色模式设计 |
| [Godly](https://godly.website) | 精选高质量网页设计 |
| [Magic UI](https://magicui.design) | 带光感/渐变的 React 组件 |
| [Aceternity UI](https://ui.aceternity.com) | 暗色主题炫酷组件库 |
| [Hoppscotch](https://hoppscotch.io) | 同类 API 工具参考 |
| [Linear](https://linear.app) | 深色主题标杆产品 |
