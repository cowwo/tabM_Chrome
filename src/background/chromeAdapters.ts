import {
  getLastFocusedWindowId,
  queryAllTabGroupsForTabs,
  queryGroups,
  queryNormalizedGroup,
  queryNormalizedTabsInGroup,
  queryNormalizedTabsInWindow
} from "./chromeQueries";
import type { TabGroupRecord, TabRecord } from "../shared/types";

export interface ChromeApi {
  tabs: Pick<typeof chrome.tabs, "query">;
  windows: Pick<typeof chrome.windows, "getLastFocused">;
  tabGroups: Pick<typeof chrome.tabGroups, "get">;
}

export interface ChromeQueryHelpers {
  queryTabs: () => Promise<chrome.tabs.Tab[]>;
  queryFocusedWindowId: () => Promise<number | null>;
  queryAllTabGroupsForTabs: (tabs: readonly chrome.tabs.Tab[]) => Promise<TabGroupRecord[]>;
  queryGroups: (groupIds: readonly number[]) => Promise<TabGroupRecord[]>;
  queryNormalizedGroup: (
    groupId: number,
    providedGroup?: chrome.tabGroups.TabGroup
  ) => Promise<TabGroupRecord>;
  queryNormalizedTabsInWindow: (windowId: number) => Promise<TabRecord[]>;
  queryNormalizedTabsInGroup: (groupId: number) => Promise<TabRecord[]>;
}

export interface ActionBadgeAdapter {
  configureActionBadge(): void;
  scheduleActionBadgeUpdate(): void;
}

export interface SidePanelRuntimeAlarmAdapter {
  configureSidePanel(): Promise<void>;
  registerListeners(): void;
}

export function createChromeQueryHelpers(chromeApi: ChromeApi = chrome): ChromeQueryHelpers {
  return {
    queryTabs: () => chromeApi.tabs.query({}),
    queryFocusedWindowId: () => getLastFocusedWindowId(chromeApi),
    queryAllTabGroupsForTabs: (tabs) => queryAllTabGroupsForTabs(tabs, chromeApi),
    queryGroups: (groupIds) => queryGroups(groupIds, chromeApi),
    queryNormalizedGroup: (groupId, providedGroup) => queryNormalizedGroup(groupId, providedGroup, chromeApi),
    queryNormalizedTabsInWindow: (windowId) => queryNormalizedTabsInWindow(windowId, chromeApi),
    queryNormalizedTabsInGroup: (groupId) => queryNormalizedTabsInGroup(groupId, chromeApi)
  };
}

export function createActionBadgeAdapter(params: {
  action: Pick<typeof chrome.action, "setBadgeBackgroundColor" | "setBadgeText">;
  getTabCount: () => number;
  isBadgeEnabled: () => boolean;
  badgeBackgroundColor: string;
  queueMicrotaskFn?: (task: VoidFunction) => void;
}): ActionBadgeAdapter {
  const queueMicrotaskFn = params.queueMicrotaskFn ?? queueMicrotask;
  let badgeUpdateQueued = false;
  let lastBadgeText: string | null = null;

  const updateActionBadge = (): void => {
    if (!params.isBadgeEnabled()) {
      if (lastBadgeText === "") {
        return;
      }

      lastBadgeText = "";
      params.action.setBadgeText({
        text: ""
      });
      return;
    }

    const nextText = String(params.getTabCount());
    if (nextText === lastBadgeText) {
      return;
    }

    lastBadgeText = nextText;
    params.action.setBadgeText({
      text: nextText
    });
  };

  return {
    configureActionBadge(): void {
      params.action.setBadgeBackgroundColor({
        color: params.badgeBackgroundColor
      });
    },
    scheduleActionBadgeUpdate(): void {
      if (badgeUpdateQueued) {
        return;
      }

      badgeUpdateQueued = true;
      queueMicrotaskFn(() => {
        badgeUpdateQueued = false;
        updateActionBadge();
      });
    }
  };
}

export function createSidePanelRuntimeAlarmAdapter(params: {
  runtime: Pick<typeof chrome.runtime, "onInstalled" | "onStartup">;
  alarms: Pick<typeof chrome.alarms, "create" | "onAlarm">;
  sidePanel: Pick<typeof chrome.sidePanel, "setPanelBehavior">;
  ensureInitialized: () => Promise<void>;
  scheduleActionBadgeUpdate: () => void;
  keepaliveAlarmName: string;
  keepaliveIntervalMinutes: number;
}): SidePanelRuntimeAlarmAdapter {
  const configureSidePanel = async (): Promise<void> => {
    await params.sidePanel.setPanelBehavior({
      openPanelOnActionClick: true
    });
  };

  const onKeepaliveAlarm = (alarm: chrome.alarms.Alarm): void => {
    if (alarm.name !== params.keepaliveAlarmName) {
      return;
    }

    params.scheduleActionBadgeUpdate();
  };

  return {
    configureSidePanel,
    registerListeners(): void {
      params.alarms.create(params.keepaliveAlarmName, {
        periodInMinutes: params.keepaliveIntervalMinutes
      });
      params.runtime.onInstalled.addListener(() => {
        void configureSidePanel();
      });
      params.runtime.onStartup.addListener(() => {
        void params.ensureInitialized();
        void configureSidePanel();
      });
      params.alarms.onAlarm.addListener(onKeepaliveAlarm);
    }
  };
}
