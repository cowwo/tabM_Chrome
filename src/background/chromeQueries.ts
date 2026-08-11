import { NO_TAB_GROUP_ID } from "../shared/defaults";
import { normalizeChromeTabGroup } from "../shared/domain/normalizeGroup";
import { normalizeChromeTab } from "../shared/domain/normalizeTab";
import type { TabGroupRecord, TabRecord } from "../shared/types";

export interface ChromeQueriesApi {
  windows: {
    getLastFocused(): Promise<{
      id?: number;
    }>;
    getAll(): Promise<Array<{ id?: number }>>;
  };
  tabs: {
    query(queryInfo: {
      windowId?: number;
      groupId?: number;
    }): Promise<chrome.tabs.Tab[]>;
  };
  tabGroups: {
    get(groupId: number): Promise<chrome.tabGroups.TabGroup>;
  };
}

export async function getLastFocusedWindowId(
  chromeApi: Pick<ChromeQueriesApi, "windows"> = chrome
): Promise<number | null> {
  try {
    const window = await chromeApi.windows.getLastFocused();
    return window.id ?? null;
  } catch {
    return null;
  }
}

export async function queryAllWindowIds(
  chromeApi: Pick<ChromeQueriesApi, "windows"> = chrome
): Promise<number[]> {
  try {
    const windows = await chromeApi.windows.getAll();
    return windows.map((w) => w.id).filter((id): id is number => id != null);
  } catch {
    return [];
  }
}

export async function queryAllTabGroupsForTabs(
  tabs: readonly chrome.tabs.Tab[],
  chromeApi: Pick<ChromeQueriesApi, "tabGroups"> = chrome
): Promise<TabGroupRecord[]> {
  return await queryGroups(collectTabGroupIds(tabs), chromeApi);
}

export async function queryGroups(
  groupIds: readonly number[],
  chromeApi: Pick<ChromeQueriesApi, "tabGroups"> = chrome
): Promise<TabGroupRecord[]> {
  const groups = await Promise.all(
    groupIds.map(async (groupId) => {
      try {
        return await queryNormalizedGroup(groupId, undefined, chromeApi);
      } catch {
        return null;
      }
    })
  );

  return groups.filter(isPresent);
}

export async function queryNormalizedGroup(
  groupId: number,
  providedGroup?: chrome.tabGroups.TabGroup,
  chromeApi: Pick<ChromeQueriesApi, "tabGroups"> = chrome
): Promise<TabGroupRecord> {
  return normalizeChromeTabGroup(providedGroup ?? (await chromeApi.tabGroups.get(groupId)));
}

export async function queryNormalizedTabsInWindow(
  windowId: number,
  chromeApi: Pick<ChromeQueriesApi, "tabs"> = chrome
): Promise<TabRecord[]> {
  return await queryNormalizedTabs({ windowId }, chromeApi);
}

export async function queryNormalizedTabsInGroup(
  groupId: number,
  chromeApi: Pick<ChromeQueriesApi, "tabs"> = chrome
): Promise<TabRecord[]> {
  return await queryNormalizedTabs({ groupId }, chromeApi);
}

function collectTabGroupIds(tabs: readonly chrome.tabs.Tab[]): number[] {
  return Array.from(
    new Set(
      tabs
        .map((tab) => tab.groupId ?? NO_TAB_GROUP_ID)
        .filter((groupId) => groupId !== NO_TAB_GROUP_ID)
    )
  );
}

async function queryNormalizedTabs(
  queryInfo: {
    windowId?: number;
    groupId?: number;
  },
  chromeApi: Pick<ChromeQueriesApi, "tabs">
): Promise<TabRecord[]> {
  return normalizeQueriedTabs(await chromeApi.tabs.query(queryInfo));
}

function normalizeQueriedTabs(tabs: readonly chrome.tabs.Tab[]): TabRecord[] {
  return tabs.map((tab) => normalizeChromeTab(tab)).filter(isPresent);
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value != null;
}
