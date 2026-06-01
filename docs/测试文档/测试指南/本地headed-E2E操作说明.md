# 本地 Headed Playwright E2E 操作说明

**适用环境：** 宿主机（有显示器），Ubuntu / macOS  
**前置条件：** Node.js, npm, Playwright Chromium 已安装

## 快速开始

### 1. 确认浏览器可用

```bash
ls -la /home/ff/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome
```

如果路径不同，设置环境变量：

```bash
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/your/path/to/chrome
```

### 2. 三层验证流程

```
Smoke → Targeted → Full
  |        |         |
  └失败就停 └失败就停  └失败就保留证据
```

### Smoke（1 个关键用例，~10 秒）

验证浏览器、扩展、sidepanel、调试接口都正常。

```bash
npm run e2e:headed:smoke
```

**通过标准：** 1 passed, 0 failed

**失败时：** 先检查浏览器是否可启动、扩展是否加载、输出目录是否可写。

### Targeted（指定用例，按需）

验证某个具体交互或 bug 修复。

```bash
# 按关键字跑
npm run e2e:headed:targeted -- -g "Ctrl"

# 跑整个 spec 文件
npm run e2e:headed:targeted -- sidepanel.spec.ts

# 跑单个 test
npm run e2e:headed:targeted -- -g "选择模式：Ctrl+点击切换标签选中状态"
```

### Full（全量 42 条，~5-8 分钟）

```bash
npm run e2e:headed:full
```

**只在 Smoke 通过后再跑。**

## 输出文件

所有产物写入 `/tmp/tabm-e2e/latest/`：
- `report/` — HTML 报告
- 截图 / trace / error context — 失败时自动保留

可直接打开报告：

```bash
npx playwright show-report /tmp/tabm-e2e/latest/report
```

## 常见问题

| 现象 | 可能原因 | 处理 |
|---|---|---|
| `EACCES` 写 test-results | 旧 Docker 运行留下了 root 文件 | `sudo rm -rf test-results` |
| `serviceworker` 超时 | 扩展未正确加载 | 确认 `VITE_E2E_TEST=true npm run build` 已执行 |
| 浏览器启动即退出 | Chromium 路径不对 | 检查 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` |
| `toHaveCount(0)` 超时 | 元素未消失 | 先确认是否 headless 时序差异，再排查业务逻辑 |

## 环境型失败 vs 业务型失败

**环境型（先修运行环境）：**
- `browserContext.waitForEvent("serviceworker")` 超时
- `Target page, context or browser has been closed`
- `EACCES` 权限错误
- 浏览器进程启动后立刻退出

**业务型（排查代码）：**
- 断言不成立
- UI 元素状态不符合预期
- 选择/搜索/折叠/关闭/拖拽结果不对
