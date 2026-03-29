---
globs:
  - "src/**/*.{ts,tsx}"
  - "vite.config.*"
alwaysApply: false
---

# 前端性能规范

## 渲染性能

### 避免不必要的重渲染

```tsx
// 在渲染中创建新对象/数组 — 每次渲染都产生新引用
<ChildComponent style={{ color: "red" }} />
<ChildComponent items={data.filter(x => x.active)} />

// 提取为常量或 useMemo
const activeStyle = { color: "red" };  // 组件外
const activeItems = useMemo(() => data.filter(x => x.active), [data]);

<ChildComponent style={activeStyle} />
<ChildComponent items={activeItems} />
```

### 组件拆分粒度

```tsx
// 将频繁更新的部分隔离为子组件，避免大组件因局部状态变化整体重渲染
const SearchBar = () => {
  const [search, setSearch] = useState("");
  return <input value={search} onChange={e => setSearch(e.target.value)} />;
};

const BigPage = () => (
  <>
    <SearchBar />
    <HeavyTable />  {/* 不会因 search 变化而重渲染 */}
    <HeavyChart />
  </>
);
```

### 列表渲染优化

```tsx
// 列表项使用稳定 key（禁止用 index）
{items.map(item => <Card key={item.id} data={item} />)}

// 大列表考虑虚拟滚动（如 react-virtualized 或 tanstack-virtual）
```

## 代码分割

### 路由级懒加载

```tsx
import { lazy, Suspense } from "react";

const RunnerView = lazy(() => import("./views/RunnerView"));
const SettingsView = lazy(() => import("./views/SettingsView"));

// 在路由中使用 Suspense
<Suspense fallback={<Loading />}>
  <RunnerView />
</Suspense>
```

### 何时使用懒加载

| 场景 | 是否懒加载 | 原因 |
|------|-----------|------|
| 路由页面组件 | 是 | 首屏只需加载当前路由 |
| 大型弹窗/抽屉内容 | 是 | 用户可能不打开 |
| 通用 UI 组件 | 否 | 体积小，懒加载开销反而更大 |
| 首屏必需组件 | 否 | 懒加载会增加首屏延迟 |

## 网络优化

### Tauri invoke 调用

- 避免短时间内重复调用同一 `invoke()`，用 Zustand store 缓存数据
- 搜索/筛选添加 debounce（300ms）
- 批量操作优先用单次 invoke 传数组，而非循环多次调用

```tsx
// 搜索输入防抖
const [search, setSearch] = useState("");
const debouncedSearch = useDebounce(search, 300);
// 用 debouncedSearch 触发 invoke，而非 search
```

## 构建优化

### Vite 配置建议

```typescript
// vite.config.ts — 分包策略
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
        },
      },
    },
  },
});
```

### Bundle 分析

```bash
npx vite-bundle-visualizer
```

## Rust 后端性能

### 静态资源缓存

- 正则表达式用 `OnceLock` / `LazyLock` 全局缓存，禁止热路径中 `Regex::new()`
- 链式执行中每个请求的变量替换会调用 4+ 次 replace_vars，Regex 编译开销会被放大

### 树形数据构建

- 递归构建树时，先按 `parent_id` 分组为 `HashMap<Option<String>, Vec<&Item>>`
- 禁止对每个父节点遍历全部 items（O(N²) → O(N)）

### 并行执行计时

- 并行任务总耗时用 `Instant::now().elapsed()`（wall-clock）
- 禁止累加各任务的网络耗时（会严重夸大并行执行时间）

### 数据库访问

- 批量查询优先于 N+1 循环查询（`list_by_items` 而非 for 循环 `get`）
- 异步 command 中先查数据释放 Mutex 锁，再做网络请求
- 批量写入考虑事务包装，减少锁竞争

## 性能检查清单

### 前端
- [ ] 首屏无不必要的大依赖加载
- [ ] 列表页有分页或虚拟滚动
- [ ] 搜索/筛选有防抖处理
- [ ] 无组件内创建对象/数组导致子组件重渲染
- [ ] `useEffect` 依赖数组正确且有清理函数
- [ ] 路由页面按需加载
- [ ] Tauri invoke 调用有适当缓存，避免重复请求

### 后端
- [ ] 无热路径中的 `Regex::new()` 重复编译
- [ ] 树形构建使用 HashMap 预分组
- [ ] 并行任务计时使用 wall-clock
- [ ] 无 N+1 循环查询
- [ ] 异步命令中不长时间持有 Mutex 锁