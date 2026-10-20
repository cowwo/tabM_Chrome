import { expect, type Locator, type Page } from "@playwright/test";
import type { TabStoreSnapshot } from "../../../src/shared";

// 与 src/shared/defaults.ts 的 NO_TAB_GROUP_ID 保持一致（-1）。
// 这里用本地常量而不是运行时 import 产品 TS 模块：当前 e2e 对 src 只用 type-only import，
// 避免 Playwright loader 解析无扩展名产品模块带来的额外风险。
const NO_TAB_GROUP_ID = -1;

/**
 * 虚拟滚动的 E2E 辅助函数。
 *
 * 背景：列表改为「只渲染可见区 + overscan」后，DOM 里的 .tab-row 数量不再等于
 * snapshot 里的标签数，按标题/序号定位行也不再稳定。本文件的思路：
 * 1) 数据层判断优先：用 window.__playwrightApi.getSnapshot() 算目标行的逻辑位置；
 * 2) 交互层必须先确保目标行已被渲染（scrollIntoView/估算滚动 + 逐步修正），
 *    拿到 Locator 后再断言/点击/拖拽；
 * 3) 行高缓存与滚动位置可能异步修正，取 boundingBox 前先等布局稳定。
 *
 * 兼容降级：如果产品侧后续在 window.__playwrightApi 上补了 getListState() /
 * scrollToRow({ rowKey })，这里会自动优先使用；没有时退回「估算偏移 + 步进修正」。
 */

/** 面板滚动容器（App.tsx 的 .panel-scroll）。 */
export function getScrollContainer(page: Page): Locator {
  return page.locator(".panel-scroll");
}

/**
 * 已渲染的行包裹层（RowShell => .stack-list__item）。
 * 注意：上下 spacer 不应使用该 class，否则渲染行数断言会失真。
 */
export function getRenderedRows(page: Page): Locator {
  return page.locator(".stack-list__item");
}

/** 当前 DOM 中真实渲染的行数（虚拟滚动下应远小于逻辑行数）。 */
export async function getRenderedRowCount(page: Page): Promise<number> {
  return getRenderedRows(page).count();
}

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export async function getScrollMetrics(page: Page): Promise<ScrollMetrics> {
  return getScrollContainer(page).evaluate((element) => {
    const container = element as HTMLElement;
    return {
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight
    };
  });
}

/** 产品侧可选的测试 API 形状（虚拟滚动落地后由 App.tsx 注入；当前可能不存在）。 */
export interface ListState {
  totalRowCount: number;
  renderedRowCount: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  collapsedWindowIds?: readonly number[];
}

type BrowserPlaywrightApi = {
  getSnapshot?: () => Promise<TabStoreSnapshot>;
  getListState?: () => ListState | Promise<ListState>;
  scrollToRow?: (options: { rowKey: string }) => void | Promise<void>;
};

/** 读取面板快照；sidepanel 未就绪时抛出可读错误。 */
export async function readSnapshot(page: Page): Promise<TabStoreSnapshot> {
  const snapshot = await page.evaluate(() => {
    const api = (window as unknown as { __playwrightApi?: BrowserPlaywrightApi }).__playwrightApi;
    if (!api?.getSnapshot) {
      throw new Error("window.__playwrightApi.getSnapshot 不存在：sidepanel 尚未就绪");
    }
    return api.getSnapshot();
  });
  return snapshot;
}

/** 可选：产品侧补了 getListState() 时读取之，否则返回 null。 */
export async function getListState(page: Page): Promise<ListState | null> {
  return page.evaluate(async () => {
    const api = (window as unknown as { __playwrightApi?: BrowserPlaywrightApi }).__playwrightApi;
    if (!api?.getListState) {
      return null;
    }
    return api.getListState();
  });
}

async function tryScrollToRowKey(page: Page, rowKey: string): Promise<boolean> {
  return page.evaluate(async (key) => {
    const api = (window as unknown as { __playwrightApi?: BrowserPlaywrightApi }).__playwrightApi;
    if (!api?.scrollToRow) {
      return false;
    }
    await api.scrollToRow({ rowKey: key });
    return true;
  }, rowKey);
}

export type RowTarget = { rowTitle: string } | { tabId: number };
export type WindowTarget = { windowIndex: number } | { windowId: number };
export type ScrollListTarget = "top" | "bottom" | RowTarget;

interface UnitHeights {
  tab: number;
  windowHeader: number;
  groupHeader: number;
}

/** 估算行高（与虚拟列表的估算分档对齐：大 40 / 中 38 / 小 30；窗口/组头另估）。 */
const DEFAULT_UNIT_HEIGHTS: UnitHeights = {
  tab: 38,
  windowHeader: 40,
  groupHeader: 34
};

const LAYOUT_STABLE_TIMEOUT_MS = 3_000;
const SCROLL_CORRECTION_ATTEMPTS = 12;
const RENDERED_ROW_BUDGET_DEFAULT = 80;

async function waitForAnimationFrames(page: Page, frameCount = 2): Promise<void> {
  await page.evaluate(async (count) => {
    for (let index = 0; index < count; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }, frameCount);
}

async function readLayoutSignature(page: Page): Promise<string> {
  return page.evaluate(() => {
    const container = document.querySelector<HTMLElement>(".panel-scroll");
    const firstRow = document.querySelector<HTMLElement>(".stack-list__item");
    const firstRowRect = firstRow?.getBoundingClientRect();
    return [
      container?.scrollTop ?? -1,
      container?.scrollHeight ?? -1,
      firstRowRect ? Math.round(firstRowRect.top * 10) / 10 : -1
    ].join("|");
  });
}

/**
 * 等待列表布局稳定（连续两帧 scrollTop / scrollHeight / 首行 top 都不变）。
 * 虚拟滚动首次渲染用估算高度、随后用实测高度修正，取 boundingBox / 做拖拽前必须等它稳定。
 */
export async function waitForListLayoutStable(
  page: Page,
  options: { timeoutMs?: number } = {}
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? LAYOUT_STABLE_TIMEOUT_MS;
  const startedAt = Date.now();
  let previousSignature = await readLayoutSignature(page);

  while (Date.now() - startedAt < timeoutMs) {
    await waitForAnimationFrames(page);
    const nextSignature = await readLayoutSignature(page);
    if (nextSignature === previousSignature) {
      return;
    }
    previousSignature = nextSignature;
  }

  throw new Error(
    `[virtualList] 列表布局在 ${timeoutMs}ms 内未稳定（最后一次签名：${previousSignature}）`
  );
}

async function setScrollTop(page: Page, scrollTop: number): Promise<void> {
  await getScrollContainer(page).evaluate((element, top) => {
    (element as HTMLElement).scrollTop = top;
  }, scrollTop);
}

async function measureUnitHeights(page: Page): Promise<UnitHeights> {
  const measured = await page.evaluate(() => {
    const measureRowHeight = (selector: string): number | null => {
      const row = document.querySelector<HTMLElement>(selector);
      if (!row) {
        return null;
      }
      const wrapper = row.closest<HTMLElement>(".stack-list__item") ?? row;
      const height = wrapper.getBoundingClientRect().height;
      return height > 0 ? height : null;
    };
    const groupBlock = document.querySelector<HTMLElement>(".group-block");
    const groupHeaderRow =
      groupBlock?.querySelector<HTMLElement>(".stack-list__item") ?? null;
    const groupHeaderRect = groupHeaderRow?.getBoundingClientRect();

    return {
      tab: measureRowHeight(".tab-row"),
      windowHeader: measureRowHeight("button.window-row"),
      groupHeader: groupHeaderRect && groupHeaderRect.height > 0 ? groupHeaderRect.height : null
    };
  });

  return {
    tab: measured.tab ?? DEFAULT_UNIT_HEIGHTS.tab,
    windowHeader: measured.windowHeader ?? DEFAULT_UNIT_HEIGHTS.windowHeader,
    groupHeader: measured.groupHeader ?? DEFAULT_UNIT_HEIGHTS.groupHeader
  };
}

function getVisibleWindowIds(snapshot: TabStoreSnapshot): number[] {
  return snapshot.windowOrder.filter(
    (windowId) => (snapshot.windowTabIds[windowId] ?? []).length > 0
  );
}

type EstimateTarget =
  | { kind: "tab"; tabId: number }
  | { kind: "window"; windowId: number };

/**
 * 按 snapshot 的逻辑结构估算目标行的纵向偏移（px）。
 * 组头数量按「该窗口内出现过的不同 groupId」估算；折叠组/折叠窗口会让实际偏移偏小，
 * 因此后续还有逐步修正循环兜底。
 */
async function estimateRowOffsetPx(
  page: Page,
  target: EstimateTarget
): Promise<number | null> {
  const [snapshot, heights] = await Promise.all([readSnapshot(page), measureUnitHeights(page)]);
  const windowIds = getVisibleWindowIds(snapshot);
  let offset = 0;

  for (const windowId of windowIds) {
    const windowTop = offset;
    offset += heights.windowHeader;

    if (target.kind === "window" && target.windowId === windowId) {
      return windowTop + heights.windowHeader / 2;
    }

    const seenGroupIds = new Set<number>();
    for (const tabId of snapshot.windowTabIds[windowId] ?? []) {
      const tab = snapshot.tabsById[tabId];
      if (!tab) {
        continue;
      }
      if (tab.groupId !== NO_TAB_GROUP_ID && !seenGroupIds.has(tab.groupId)) {
        seenGroupIds.add(tab.groupId);
        offset += heights.groupHeader;
      }
      if (target.kind === "tab" && target.tabId === tabId) {
        return offset + heights.tab / 2;
      }
      offset += heights.tab;
    }
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 标签行定位：.tab-row 内 .tab-row__title 的精确文案匹配（避免前缀误命中）。 */
function getTabRowLocator(page: Page, title: string): Locator {
  const exactTitle = new RegExp(`^${escapeRegExp(title)}$`);
  return page
    .locator(".tab-row", {
      has: page.locator(".tab-row__title", { hasText: exactTitle })
    })
    .first();
}

/** 窗口头定位：按可见窗口序号匹配「窗口 N / Window N」。 */
function getWindowRowLocator(page: Page, visibleWindowIndex: number): Locator {
  const ordinal = visibleWindowIndex + 1;
  const titlePattern = new RegExp(`^(?:窗口|Window)\\s+${ordinal}(?:\\s*-.*)?$`);
  return page
    .locator("button.window-row")
    .filter({ has: page.locator(".window-row__title", { hasText: titlePattern }) })
    .first();
}

async function getRenderedRowTitles(page: Page): Promise<string[]> {
  return page.locator(".stack-list__item .tab-row__title").allInnerTexts();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 先滚到目标估算位置，再以「半屏步进 + 目标是否已渲染」逐步修正，直到目标行出现。
 * 这是没有 scrollToRow 测试 API 时的兜底路径。
 */
async function scrollUntilLocatorRendered(
  page: Page,
  locator: Locator,
  estimatedOffsetPx: number | null,
  describeTarget: string
): Promise<Locator> {
  const metrics = await getScrollMetrics(page);
  if (estimatedOffsetPx != null) {
    const maxScrollTop = Math.max(metrics.scrollHeight - metrics.clientHeight, 0);
    const initialScrollTop = clamp(
      Math.round(estimatedOffsetPx - metrics.clientHeight * 0.35),
      0,
      maxScrollTop
    );
    await setScrollTop(page, initialScrollTop);
    await waitForAnimationFrames(page);
  } else {
    // 没有逻辑位置可估算（例如标题重复/缺失）时从顶部向下扫描，保证能命中"首个同名行"。
    await setScrollTop(page, 0);
    await waitForAnimationFrames(page);
  }

  for (let attempt = 0; attempt < SCROLL_CORRECTION_ATTEMPTS; attempt += 1) {
    if ((await locator.count()) > 0) {
      await locator.scrollIntoViewIfNeeded();
      await waitForListLayoutStable(page);
      return locator;
    }

    const currentMetrics = await getScrollMetrics(page);
    const viewportCenter = currentMetrics.scrollTop + currentMetrics.clientHeight / 2;
    const estimatedCenter = estimatedOffsetPx ?? viewportCenter;
    const step = Math.max(Math.round(currentMetrics.clientHeight * 0.8), 200);
    const direction = estimatedCenter >= viewportCenter ? 1 : -1;
    const maxScrollTop = Math.max(
      currentMetrics.scrollHeight - currentMetrics.clientHeight,
      0
    );
    const nextScrollTop = clamp(
      currentMetrics.scrollTop + direction * step,
      0,
      maxScrollTop
    );

    if (nextScrollTop === currentMetrics.scrollTop) {
      break;
    }

    await setScrollTop(page, nextScrollTop);
    await waitForAnimationFrames(page);
  }

  if ((await locator.count()) > 0) {
    await locator.scrollIntoViewIfNeeded();
    await waitForListLayoutStable(page);
    return locator;
  }

  const [metricsAfter, renderedTitles] = await Promise.all([
    getScrollMetrics(page),
    getRenderedRowTitles(page)
  ]);
  throw new Error(
    `[virtualList] 滚动后仍未渲染目标行：${describeTarget}；` +
      `scrollTop=${metricsAfter.scrollTop}/${metricsAfter.scrollHeight}，` +
      `已渲染标签行标题=${JSON.stringify(renderedTitles)}`
  );
}

function resolveTabRowTarget(
  snapshot: TabStoreSnapshot,
  target: RowTarget
): { title: string; tabId: number | null } {
  if ("tabId" in target) {
    const tab = snapshot.tabsById[target.tabId];
    if (!tab) {
      throw new Error(`[virtualList] snapshot 中不存在 tabId=${target.tabId}`);
    }
    return { title: tab.title, tabId: target.tabId };
  }

  const matchedTabIds = Object.values(snapshot.tabsById)
    .filter((tab) => tab.title === target.rowTitle)
    .map((tab) => tab.id);
  return {
    title: target.rowTitle,
    tabId: matchedTabIds.length === 1 ? matchedTabIds[0] : null
  };
}

/**
 * 确保某个标签行已被渲染，返回 .tab-row 的 Locator（点击请用 .tab-row__main）。
 * 优先使用产品侧 scrollToRow({ rowKey })（若有），否则用 snapshot 估算 + 步进修正。
 * 注意：标题重复（幽灵行场景）时退回「DOM 中首个同名行」，精确场景请传 tabId。
 */
export async function ensureRowRendered(page: Page, target: RowTarget): Promise<Locator> {
  const snapshot = await readSnapshot(page);
  const resolved = resolveTabRowTarget(snapshot, target);
  const describeTarget = "tabId" in target
    ? `tabId=${target.tabId}（title=${resolved.title}）`
    : `title=${target.rowTitle}`;

  if (resolved.tabId != null) {
    const scrolledByApi = await tryScrollToRowKey(page, `tab-${resolved.tabId}`);
    if (scrolledByApi) {
      await waitForListLayoutStable(page);
      const byApiLocator = getTabRowLocator(page, resolved.title);
      if ((await byApiLocator.count()) > 0) {
        await byApiLocator.scrollIntoViewIfNeeded();
        return byApiLocator;
      }
    }
  }

  const locator = getTabRowLocator(page, resolved.title);
  if ((await locator.count()) > 0) {
    await locator.scrollIntoViewIfNeeded();
    await waitForListLayoutStable(page);
    return locator;
  }

  const estimatedOffsetPx =
    resolved.tabId == null
      ? null
      : await estimateRowOffsetPx(page, { kind: "tab", tabId: resolved.tabId });

  return scrollUntilLocatorRendered(page, locator, estimatedOffsetPx, describeTarget);
}

/**
 * 确保某个窗口头已被渲染，返回 button.window-row 的 Locator。
 * windowIndex 指「可见窗口顺序」（snapshot.windowOrder 过滤掉空窗口后的下标）。
 */
export async function ensureWindowRowRendered(
  page: Page,
  target: WindowTarget
): Promise<Locator> {
  const snapshot = await readSnapshot(page);
  const visibleWindowIds = getVisibleWindowIds(snapshot);
  const windowId =
    "windowId" in target ? target.windowId : visibleWindowIds[target.windowIndex];
  const visibleWindowIndex = windowId == null ? -1 : visibleWindowIds.indexOf(windowId);

  if (windowId == null || visibleWindowIndex < 0) {
    throw new Error(
      `[virtualList] 无法定位窗口：${JSON.stringify(target)}；` +
        `当前可见窗口 id=${JSON.stringify(visibleWindowIds)}`
    );
  }

  if (await tryScrollToRowKey(page, `window-${windowId}`)) {
    await waitForListLayoutStable(page);
    const byApiLocator = getWindowRowLocator(page, visibleWindowIndex);
    if ((await byApiLocator.count()) > 0) {
      await byApiLocator.scrollIntoViewIfNeeded();
      return byApiLocator;
    }
  }

  const locator = getWindowRowLocator(page, visibleWindowIndex);
  if ((await locator.count()) > 0) {
    await locator.scrollIntoViewIfNeeded();
    await waitForListLayoutStable(page);
    return locator;
  }

  const estimatedOffsetPx = await estimateRowOffsetPx(page, { kind: "window", windowId });
  return scrollUntilLocatorRendered(
    page,
    locator,
    estimatedOffsetPx,
    `windowId=${windowId}（可见序号 ${visibleWindowIndex + 1}）`
  );
}

/**
 * 滚动列表："top" / "bottom" / 目标标签行（先确保渲染）。
 * 滚到底会做两次（虚拟列表实测行高修正后 scrollHeight 可能变化）。
 */
export async function scrollListTo(page: Page, target: ScrollListTarget): Promise<void> {
  if (target === "top") {
    await setScrollTop(page, 0);
    await waitForAnimationFrames(page);
    await waitForListLayoutStable(page);
    return;
  }

  if (target === "bottom") {
    // 虚拟列表的行高是"估算 -> 实测"逐步修正的，scrollHeight 会变化：
    // 因此重复"贴底 -> 等稳定 -> 再贴底"，直到 scrollTop 真的落在底部。
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const metrics = await getScrollMetrics(page);
      const bottomScrollTop = Math.max(metrics.scrollHeight - metrics.clientHeight, 0);
      if (Math.abs(metrics.scrollTop - bottomScrollTop) < 2 && attempt > 0) {
        return;
      }
      await setScrollTop(page, bottomScrollTop);
      await waitForAnimationFrames(page);
      await waitForListLayoutStable(page);
    }
    return;
  }

  await ensureRowRendered(page, target);
}

export interface DragRowOptions {
  sourceTitle: string;
  targetTitle: string;
  /** 落点相对目标行高度的比例：0=顶部, 0.5=中间, 1=底部；默认 0.5。 */
  targetRatio?: number;
}

/** 按标题把 source 行拖到 target 行（两行必须先同时渲染；相邻行场景）。 */
export async function dragRowToRow(page: Page, options: DragRowOptions): Promise<void> {
  const sourceRow = await ensureRowRendered(page, { rowTitle: options.sourceTitle });
  const targetRow = await ensureRowRendered(page, { rowTitle: options.targetTitle });
  await waitForListLayoutStable(page);

  if ((await sourceRow.count()) === 0 || (await targetRow.count()) === 0) {
    throw new Error(
      `[virtualList] 拖拽前源/目标行未同时渲染（source=${options.sourceTitle}, target=${options.targetTitle}）；` +
        "跨屏拖拽请先用 ensureRowRendered 分别定位或改用自动滚动用例"
    );
  }

  const [sourceBox, targetBox] = await Promise.all([
    sourceRow.boundingBox(),
    targetRow.boundingBox()
  ]);
  if (!sourceBox || !targetBox) {
    throw new Error("[virtualList] 拖拽前无法获取源/目标行的 boundingBox");
  }

  const ratio = clamp(options.targetRatio ?? 0.5, 0, 1);
  const sourceX = sourceBox.x + Math.min(24, sourceBox.width / 2);
  const sourceY = sourceBox.y + sourceBox.height / 2;
  const targetX = targetBox.x + Math.min(24, targetBox.width / 2);
  const targetY = targetBox.y + targetBox.height * ratio;

  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();
  // 先越过 6px 拖拽阈值，避免被当成点击
  await page.mouse.move(sourceX, sourceY + 8, { steps: 2 });
  await page.mouse.move(targetX, targetY, { steps: 8 });
  await page.mouse.up();
}

/** 虚拟滚动回归断言：DOM 中渲染的行数不应超过预算（1000 行时默认 <= 80）。 */
export async function expectRenderedRowBudget(
  page: Page,
  maxRows: number = RENDERED_ROW_BUDGET_DEFAULT
): Promise<void> {
  await expect
    .poll(async () => getRenderedRowCount(page), {
      timeout: 5_000,
      message: `虚拟滚动后渲染行数应 <= ${maxRows}`
    })
    .toBeLessThanOrEqual(maxRows);
}
