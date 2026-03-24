---
description: Kill 端口占用进程
allowed-tools: Bash(lsof:*, kill:*)
argument-hint: <port>
---

# Kill 端口占用进程

## 执行步骤

```bash
lsof -ti:${ARGUMENTS:-5173} | xargs kill -9 2>/dev/null && echo "已 kill 端口 ${ARGUMENTS:-5173} 的进程" || echo "端口 ${ARGUMENTS:-5173} 无占用"
```

## 用法

```
/kill-port 5173    # Kill 占用 5173 端口的进程
/kill-port 1420    # Kill 占用 1420 端口的进程
```
