# Headed E2E 固定验证流程 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在宿主机上建立一套可复用的 headed Playwright 验证流程，覆盖 smoke / targeted / full 三层入口，并固化环境约定与产物回收规则。

**Architecture:** 不改动现有测试内容，只新增一个 headed Playwright 配置文件、几个 npm scripts 作为固定入口、以及一份操作说明文档。headed 配置复用现有 fixtures，仅调整 `headless: false` 和 `--output` 路径。scripts 提供 `e2e:headed:smoke` / `e2e:headed:targeted` / `e2e:headed:full` 三个层级。

**Tech Stack:** Playwright 1.59.1, Node.js, npm scripts, TypeScript (仅配置文件)

---

## Task 1: 新增 headed Playwright 配置文件

**Files:**
- Create: `playwright.headed.config.ts`

新增一个专用于宿主机 headed 模式的 Playwright 配置文件，复用现有 `playwright.config.ts` 的基础设置，仅覆盖 headless、outputDir、retries 等差异点。

- [ ] **Step 1: 创建 headed 配置文件**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    headless: false,
  },
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || "/tmp/tabm-e2e/latest",
  reporter: [
    ["html", { outputFolder: process.env.PLAYWRIGHT_HTML_REPORT_DIR || "/tmp/tabm-e2e/latest/report" }],
    ["list"],
  ],
  globalSetup: "./tests/e2e/global-setup.ts",
});
```

- [ ] **Step 2: 验证配置文件语法**

Run:
```bash
npx playwright test --config=playwright.headed.config.ts --list
```

Expected: 列出 42 条用例，无报错。

- [ ] **Step 3: Commit**

```bash
git add playwright.headed.config.ts
git commit -m "feat: add headed playwright config for local validation flow

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>"
```

---

## Task 2: 在 package.json 中添加 headed E2E 脚本入口

**Files:**
- Modify: `package.json`

添加三层 headed 验证入口：smoke（1 个关键用例）、targeted（按 grep 指定）、full（全量 42 条）。

- [ ] **Step 1: 在 scripts 中添加三个入口**

在 `package.json` 的 `scripts` 块中，紧接着 `"e2e:install"` 之后插入：

```json
"e2e:headed:smoke": "VITE_E2E_TEST=true npm run build && npx playwright test --config=playwright.headed.config.ts -g \"sidepanel 加载后显示标签\"",
"e2e:headed:targeted": "VITE_E2E_TEST=true npm run build && npx playwright test --config=playwright.headed.config.ts",
"e2e:headed:full": "VITE_E2E_TEST=true npm run build && npx playwright test --config=playwright.headed.config.ts"
```

> **说明：** `e2e:headed:targeted` 和 `e2e:headed:full` 命令本体相同，区别在于 targeted 需要用户手动追加 `-g` 参数。实际使用方式见 Task 4 的操作文档。

实际效果：
```bash
# smoke — 只跑 1 个
npm run e2e:headed:smoke

# targeted — 指定关键字的用例
npm run e2e:headed:targeted -- -g "Ctrl"

# full — 全量 42 条
npm run e2e:headed:full
```

- [ ] **Step 2: 验证 smoke 脚本可用**

Run:
```bash
npm run e2e:headed:smoke
```

Expected: 构建成功，跑 1 个用例，通过。

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add headed e2e npm scripts for smoke/targeted/full

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>"
```

---

## Task 3: 修复 test-results 权限问题

**Files:**
- Modify: `.gitignore`（已忽略，仅确认）
- Create: `scripts/ensure-e2e-output-dir.sh`

之前的 Docker 运行在仓库里留下了 root 拥有的 `test-results/` 目录，导致本地 playwright 写 `.last-run.json` 时报 `EACCES`。本 task 做两件事：清理旧权限残留，并在 headed 流程里强制用外部输出目录。

- [ ] **Step 1: 清理旧的 test-results 目录**

Run:
```bash
sudo rm -rf test-results playwright-report
```

Expected: 目录被删除，不再阻塞 playwright 运行。

- [ ] **Step 2: 创建输出目录预检脚本**

```bash
#!/usr/bin/env bash
# scripts/ensure-e2e-output-dir.sh
# 确保 headed E2E 输出目录存在且当前用户可写

set -euo pipefail

OUTPUT_DIR="${PLAYWRIGHT_OUTPUT_DIR:-/tmp/tabm-e2e/latest}"
mkdir -p "$OUTPUT_DIR"

echo "e2e output dir: $OUTPUT_DIR"
echo "writable: $(test -w "$OUTPUT_DIR" && echo yes || echo NO — will fail)"
```

给脚本加执行权限：
```bash
chmod +x scripts/ensure-e2e-output-dir.sh
```

- [ ] **Step 3: 在 smoke 脚本中集成预检**

修改 `package.json` 中刚加的 smoke 脚本，在前面加预检步骤：

```json
"e2e:headed:smoke": "bash scripts/ensure-e2e-output-dir.sh && VITE_E2E_TEST=true npm run build && npx playwright test --config=playwright.headed.config.ts -g \"sidepanel 加载后显示标签\"",
```

- [ ] **Step 4: 验证预检和 smoke 串联**

Run:
```bash
npm run e2e:headed:smoke
```

Expected: 预检输出 writable=yes，然后构建+测试正常。

- [ ] **Step 5: Commit**

```bash
git add scripts/ensure-e2e-output-dir.sh package.json
git commit -m "fix: clean stale test-results and enforce writable e2e output dir

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>"
```

---

## Task 4: 编写本地 headed E2E 操作文档

**Files:**
- Create: `docs/测试文档/测试指南/本地headed-E2E操作说明.md`

把三层验证流程、命令、输出位置、常见问题写成一份操作说明。

- [ ] **Step 1: 写操作文档**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add -f docs/测试文档/测试指南/本地headed-E2E操作说明.md
git commit -m "docs: add local headed e2e operation guide

Generated with [Claude Code](https://claude.ai/code)
via [Happy](https://happy.engineering)

Co-Authored-By: Claude <noreply@anthropic.com>
Co-Authored-By: Happy <yesreply@happy.engineering>"
```

---

## Task 5: 端到端验证流程

**Files:**
- 无新建/修改文件（纯运行验证）

用刚才建好的固定流程跑一遍，确认三层都能正常工作。

- [ ] **Step 1: 运行 smoke**

```bash
npm run e2e:headed:smoke
```

Expected: 1 passed.

- [ ] **Step 2: 运行 targeted（选择模式用例）**

```bash
npm run e2e:headed:targeted -- -g "Ctrl"
```

Expected: 1 passed.

- [ ] **Step 3: 运行 targeted（shift 范围选择）**

```bash
npm run e2e:headed:targeted -- -g "Shift"
```

Expected: 1 passed.

- [ ] **Step 4: 运行 full（全量回归）**

```bash
npm run e2e:headed:full
```

Expected: 记录通过/失败数量。如有失败，检查是否环境型并保留产物。

- [ ] **Step 5: 总结运行结果**

把 smoke / targeted / full 的结果汇总，如有未通过的用例，按环境型/业务型分类记录。
