---
description: 代码审查（全栈）
allowed-tools: Bash(git:*, cargo:*, npm:*, npx:*), Read, Glob, Grep
argument-hint: [HEAD~N | file | directory]
---

# 全栈代码审查

$ARGUMENTS

---

## 1. 确定审查范围

根据参数确定要审查的代码：
- 无参数：`git diff` 当前分支相对 main 的变更
- `HEAD~N`：最近 N 次提交的变更
- 文件/目录路径：指定范围

## 2. 执行静态分析

```bash
npx tsc --noEmit
cd src-tauri && cargo check
```

## 3. 逐文件审查（借鉴 Bugbot 策略）

> 核心方法论见 `.claude/rules/code-review-strategy.md`

对每个变更的函数/代码块，先做**边界情况扫描**：

```
[ ] 输入为空/null/undefined 时行为是否正确？
[ ] 错误路径是否会阻止后续执行（而非静默继续）？
[ ] 返回值的所有可能形态是否都被消费方处理？
[ ] 外部调用失败时是否有正确的错误传播？
[ ] 并发/重复执行时是否安全？
[ ] 状态变更是否会影响其他依赖方？
```

然后按优先级分类：

### 正确性（P0）

**Rust 端**:
- 逻辑错误、边界情况（空值、零值、空数组）
- `unwrap()` panic 风险
- SQL 参数化（禁止字符串拼接）
- Mutex 锁持有时间（禁止跨 await）
- Tauri 命令是否在 lib.rs 中注册

**React 端**:
- TypeScript 类型安全（是否有 `any`、类型断言）
- React Hook 使用规则（条件调用、依赖数组）
- Tauri Event 监听是否在 cleanup 中取消
- 安全漏洞（硬编码凭证、XSS）

### 性能（P1）

- Rust: 不必要的 `clone()`、大数据复制
- React: 组件内定义对象/数组导致子组件重渲染
- 数据库：缺少索引、N+1 查询
- `useEffect` 依赖是否正确

### 代码质量（P2）

- 文件是否超过 400 行
- 命名是否清晰
- 是否符合架构（依赖方向）
- 是否有重复代码可以提取

## 4. 生成审查报告

以表格形式输出发现的问题和建议，按优先级排列：
- P0：必须修复
- P1：建议修复
- P2：可选优化

## 5. 经验沉淀

问题修复后，回顾本次发现的问题，判断是否有**可泛化的规律性教训**应写入 `.claude/rules/`：

- 对照 `architecture.md`、`rust-patterns.md`、`react-patterns.md`、`security.md` 等现有规则
- 如果某类问题反复出现但 rules 中未覆盖 → 新增规则条目
- 如果某条现有规则表述不够具体导致遗漏 → 补充细化
- 输出一张"现有 rules 覆盖 vs 缺失"对照表，标注需要新增/强化的条目
- 确认后更新对应 rules 文件
