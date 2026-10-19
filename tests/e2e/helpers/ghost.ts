import type { BrowserContext, Page } from "@playwright/test";
import type { TabStoreSnapshot } from "../../../src/shared";
import type { SidepanelApi } from "./sidepanel";

export type LiveTab = {
  id: number;
  title: string;
  url: string;
  windowId: number;
};

export type PanelState = {
  snapshot: TabStoreSnapshot;
  liveTabs: LiveTab[];
};

type CdpTargetInfo = {
  targetId: string;
  type: string;
  url: string;
};

/**
 * 通过 CDP 强杀扩展的 Service Worker（等价于 Chrome 回收/扩展更新时的后台重启）。
 * 返回被杀掉的 Service Worker target 数量，0 或抛错说明没有杀到，测试应失败。
 */
export async function killExtensionServiceWorker(context: BrowserContext): Promise<number> {
  const browser = context.browser();
  if (!browser) {
    throw new Error("无法获取 Browser 实例（持久化上下文返回 null），无法强杀 Service Worker");
  }

  const cdp = await browser.newBrowserCDPSession();
  try {
    const response = (await cdp.send("Target.getTargets")) as { targetInfos?: CdpTargetInfo[] };
    const serviceWorkers = (response.targetInfos ?? []).filter(
      (target) => target.type === "service_worker" && target.url.startsWith("chrome-extension://")
    );

    if (serviceWorkers.length === 0) {
      throw new Error("未找到扩展 Service Worker target（后台可能已不在运行），无法强杀");
    }

    for (const target of serviceWorkers) {
      await cdp.send("Target.closeTarget", { targetId: target.targetId });
    }

    return serviceWorkers.length;
  } finally {
    await cdp.detach();
  }
}

export async function openTitledTab(context: BrowserContext, title: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`data:text/html,<title>${title}</title><body>${title}</body>`);
  return page;
}

export async function getLiveTabs(page: Page): Promise<LiveTab[]> {
  return await page.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.map((tab) => ({
      id: tab.id ?? -1,
      title: tab.title ?? "",
      url: tab.url ?? "",
      windowId: tab.windowId ?? -1
    }));
  });
}

/** 面板逻辑行数：windowTabIds 里所有窗口的 tabId 总数（一行一个 tabId）。 */
export function getSnapshotTabRowCount(snapshot: TabStoreSnapshot): number {
  return Object.values(snapshot.windowTabIds).reduce((total, tabIds) => total + tabIds.length, 0);
}

/** 面板 TabRecord 数：tabsById 记录数，应与行数一致。 */
export function getSnapshotRecordCount(snapshot: TabStoreSnapshot): number {
  return Object.keys(snapshot.tabsById).length;
}

export function getSnapshotTabTitles(snapshot: TabStoreSnapshot): string[] {
  return Object.values(snapshot.tabsById).map((tab) => tab.title);
}

export function sortedCopy(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

/** 返回出现次数 > 1 的重复值（幽灵行会让同一 title 出现多次）。 */
export function duplicateValues(values: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value);
}

export async function readPanelState(sidepanelApi: SidepanelApi, page: Page): Promise<PanelState> {
  const [snapshot, liveTabs] = await Promise.all([sidepanelApi.getSnapshot(), getLiveTabs(page)]);
  return { snapshot, liveTabs };
}

export async function waitForCondition<T>(options: {
  read: () => Promise<T>;
  isReady: (value: T) => boolean;
  message: string;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const intervalMs = options.intervalMs ?? 100;
  const timeoutAt = Date.now() + timeoutMs;
  let lastValue: T | undefined;
  let lastReadError: unknown;

  while (Date.now() < timeoutAt) {
    try {
      lastValue = await options.read();
      if (options.isReady(lastValue)) {
        return lastValue;
      }
    } catch (error) {
      lastReadError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `${options.message}\n最后一次实际值: ${formatValue(lastValue)}` +
      (lastReadError == null ? "" : `\n最后一次读取失败: ${String(lastReadError)}`)
  );
}

function formatValue(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
