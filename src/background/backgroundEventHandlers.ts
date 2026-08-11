import { NO_TAB_GROUP_ID } from "../shared/defaults";
import { normalizeChromeTabGroup } from "../shared/domain/normalizeGroup";
import { normalizeChromeTab } from "../shared/domain/normalizeTab";
import type { TabRecord } from "../shared/types";
import type { BackgroundRuntimeDependencies } from "./backgroundHandlers";

export type BackgroundEventHandlerDependencies = Pick<
  BackgroundRuntimeDependencies,
  | "traceBackgroundEvent"
  | "windowSyncCoordinator"
  | "detachedTabWindowIds"
  | "ensureInitialized"
  | "store"
  | "queryNormalizedGroup"
  | "queryNormalizedTabsInGroup"
  | "syncGroupSnapshot"
> & {
  windowIdNone: number;
  enqueueStoreTask: <T>(task: () => Promise<T>) => Promise<T>;
  syncGroupFromChrome: (groupId: number, providedGroup?: chrome.tabGroups.TabGroup) => Promise<void>;
  syncWindowFromChrome: (windowId: number, traceContext?: Record<string, unknown>) => Promise<void>;
  handlePatch: (patch: ReturnType<BackgroundRuntimeDependencies["store"]["removeWindow"]>) => void;
  handleActivated: (activeInfo: chrome.tabs.TabActiveInfo) => Promise<void>;
};

export function createTabEventHandlers(deps: Pick<
  BackgroundEventHandlerDependencies,
  | "traceBackgroundEvent"
  | "windowSyncCoordinator"
  | "detachedTabWindowIds"
  | "enqueueStoreTask"
  | "handleActivated"
  | "ensureInitialized"
  | "store"
  | "handlePatch"
  | "syncGroupFromChrome"
>): {
  onCreated: (tab: chrome.tabs.Tab) => void;
  onUpdated: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void;
  onMoved: (tabId: number, moveInfo: chrome.tabs.TabMoveInfo) => void;
  onAttached: (tabId: number, attachInfo: chrome.tabs.TabAttachInfo) => void;
  onDetached: (tabId: number, detachInfo: chrome.tabs.TabDetachInfo) => void;
  onRemoved: (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo) => void;
  onActivated: (activeInfo: chrome.tabs.TabActiveInfo) => void;
} {
  const scheduleAutoWindowSync = (params: {
    windowId: number;
    cause: string;
    reason: string;
    tabId?: number | null;
    groupId?: number | null;
    previousWindowId?: number | null;
    previousIndex?: number | null;
    nextIndex?: number | null;
  }): void => {
    deps.traceBackgroundEvent("autocorrect/window-resync", {
      windowId: params.windowId,
      cause: params.cause,
      reason: params.reason,
      tabId: params.tabId ?? null,
      groupId: params.groupId ?? null,
      previousWindowId: params.previousWindowId ?? null,
      previousIndex: params.previousIndex ?? null,
      nextIndex: params.nextIndex ?? null
    });
    void deps.windowSyncCoordinator.scheduleWindowSync({
      windowId: params.windowId,
      cause: `autocorrect/${params.cause}`
    });
  };

  const ensureKnownGroup = async (tab: TabRecord, cause: string): Promise<void> => {
    if (tab.groupId === NO_TAB_GROUP_ID || deps.store.getGroup(tab.groupId)) {
      return;
    }

    deps.traceBackgroundEvent("autocorrect/group-missing", {
      cause,
      tabId: tab.id,
      groupId: tab.groupId,
      windowId: tab.windowId
    });
    await deps.syncGroupFromChrome(tab.groupId);

    if (!deps.store.getGroup(tab.groupId)) {
      scheduleAutoWindowSync({
        windowId: tab.windowId,
        cause,
        reason: "group-missing",
        tabId: tab.id,
        groupId: tab.groupId
      });
    }
  };

  const applyPatchFirstTabUpsert = async (tab: chrome.tabs.Tab, cause: "tabs/onCreated" | "tabs/onUpdated"): Promise<void> => {
    await deps.ensureInitialized();

    const normalizedTab = normalizeChromeTab(tab);
    if (!normalizedTab) {
      scheduleAutoWindowSync({
        windowId: tab.windowId,
        cause,
        reason: "normalize-failed",
        tabId: tab.id ?? null,
        groupId: tab.groupId ?? null
      });
      return;
    }

    deps.handlePatch(deps.store.upsertTab(normalizedTab));
    deps.traceBackgroundEvent(cause === "tabs/onCreated" ? "patch/tab-created" : "patch/tab-updated", {
      tabId: normalizedTab.id,
      windowId: normalizedTab.windowId,
      groupId: normalizedTab.groupId,
      index: normalizedTab.index
    });
    await ensureKnownGroup(normalizedTab, cause);
  };

  const applyPatchFirstTabRemove = async (tabId: number, removeInfo: chrome.tabs.TabRemoveInfo): Promise<void> => {
    deps.detachedTabWindowIds.delete(tabId);
    await deps.ensureInitialized();

    if (!deps.store.hasTab(tabId)) {
      scheduleAutoWindowSync({
        windowId: removeInfo.windowId,
        cause: "tabs/onRemoved",
        reason: "missing-tab",
        tabId
      });
      return;
    }

    deps.handlePatch(deps.store.removeTab(tabId, removeInfo.windowId));
    deps.traceBackgroundEvent("patch/tab-removed", {
      tabId,
      windowId: removeInfo.windowId,
      isWindowClosing: removeInfo.isWindowClosing
    });
  };

  const isStatusOnlyUpdate = (changeInfo: chrome.tabs.TabChangeInfo): boolean => {
    const changeKeys = Object.keys(changeInfo);
    return changeKeys.length === 1 && changeInfo.status != null;
  };

  const hasPresentationImpact = (changeInfo: chrome.tabs.TabChangeInfo): boolean => (
    changeInfo.title != null
    || changeInfo.url != null
    || changeInfo.favIconUrl != null
    || changeInfo.pinned != null
    || changeInfo.audible != null
    || changeInfo.discarded != null
    || changeInfo.groupId != null
  );

  return {
    onCreated: (tab) => {
      deps.traceBackgroundEvent("tabs/onCreated", {
        tabId: tab.id,
        windowId: tab.windowId,
        index: tab.index,
        pendingUrl: tab.pendingUrl,
        url: tab.url
      });
      void deps.enqueueStoreTask(() => applyPatchFirstTabUpsert(tab, "tabs/onCreated"));
    },
    onUpdated: (tabId, changeInfo, tab) => {
      deps.traceBackgroundEvent("tabs/onUpdated", {
        tabId,
        windowId: tab.windowId,
        status: changeInfo.status,
        title: changeInfo.title,
        url: changeInfo.url,
        groupId: tab.groupId
      });

      if (isStatusOnlyUpdate(changeInfo)) {
        deps.traceBackgroundEvent("patch/tab-update-skipped", {
          tabId,
          windowId: tab.windowId,
          reason: "status-only"
        });
        return;
      }

      if (!hasPresentationImpact(changeInfo)) {
        deps.traceBackgroundEvent("patch/tab-update-skipped", {
          tabId,
          windowId: tab.windowId,
          reason: "non-visual-change"
        });
        return;
      }

      void deps.enqueueStoreTask(() => applyPatchFirstTabUpsert(tab, "tabs/onUpdated"));
    },
    onMoved: (tabId, moveInfo) => {
      deps.traceBackgroundEvent("tabs/onMoved", {
        tabId,
        windowId: moveInfo.windowId,
        fromIndex: moveInfo.fromIndex,
        toIndex: moveInfo.toIndex
      });
      void deps.enqueueStoreTask(async () => {
        await deps.ensureInitialized();
        const existingTab = deps.store.getTab(tabId);
        if (existingTab) {
          deps.handlePatch(deps.store.upsertTab({
            ...existingTab,
            windowId: moveInfo.windowId,
            index: moveInfo.toIndex
          }));
        } else {
          void deps.windowSyncCoordinator.scheduleWindowSync({
            windowId: moveInfo.windowId,
            cause: "tabs/onMoved"
          });
        }
      });
    },
    onAttached: (tabId, attachInfo) => {
      deps.traceBackgroundEvent("tabs/onAttached", {
        tabId,
        newWindowId: attachInfo.newWindowId,
        newPosition: attachInfo.newPosition,
        previousWindowId: deps.detachedTabWindowIds.get(tabId) ?? null
      });
      const previousWindowId = deps.detachedTabWindowIds.get(tabId) ?? null;
      deps.detachedTabWindowIds.delete(tabId);

      void deps.enqueueStoreTask(async () => {
        await deps.ensureInitialized();
        const existingTab = deps.store.getTab(tabId);
        if (existingTab) {
          deps.handlePatch(deps.store.upsertTab({
            ...existingTab,
            windowId: attachInfo.newWindowId,
            index: attachInfo.newPosition
          }));
        } else {
          void deps.windowSyncCoordinator.scheduleCrossWindowSync({
            sourceWindowId: previousWindowId,
            targetWindowId: attachInfo.newWindowId,
            cause: "tabs/onAttached"
          });
        }
      });
    },
    onDetached: (tabId, detachInfo) => {
      deps.traceBackgroundEvent("tabs/onDetached", {
        tabId,
        oldWindowId: detachInfo.oldWindowId,
        oldPosition: detachInfo.oldPosition
      });
      deps.detachedTabWindowIds.set(tabId, detachInfo.oldWindowId);
    },
    onRemoved: (tabId, removeInfo) => {
      deps.traceBackgroundEvent("tabs/onRemoved", {
        tabId,
        windowId: removeInfo.windowId,
        isWindowClosing: removeInfo.isWindowClosing
      });
      void deps.enqueueStoreTask(() => applyPatchFirstTabRemove(tabId, removeInfo));
    },
    onActivated: (activeInfo) => {
      deps.enqueueStoreTask(() => deps.handleActivated(activeInfo));
    }
  };
}

export function createTabGroupEventHandlers(deps: Pick<
  BackgroundEventHandlerDependencies,
  | "enqueueStoreTask"
  | "syncGroupFromChrome"
  | "ensureInitialized"
  | "store"
  | "handlePatch"
  | "syncWindowFromChrome"
  | "traceBackgroundEvent"
>): {
  onCreated: (group: chrome.tabGroups.TabGroup) => void;
  onUpdated: (group: chrome.tabGroups.TabGroup) => void;
  onRemoved: (group: chrome.tabGroups.TabGroup) => void;
} {
  return {
    onCreated: (group) => {
      deps.enqueueStoreTask(() => deps.syncGroupFromChrome(group.id, group));
    },
    onUpdated: (group) => {
      deps.enqueueStoreTask(async () => {
        await deps.ensureInitialized();
        const normalizedGroup = normalizeChromeTabGroup(group);
        const existingGroup = deps.store.getGroup(normalizedGroup.id);
        deps.handlePatch(deps.store.upsertGroup(normalizedGroup));
        deps.traceBackgroundEvent("patch/group-updated", {
          groupId: normalizedGroup.id,
          windowId: normalizedGroup.windowId,
          color: normalizedGroup.color,
          collapsed: normalizedGroup.collapsed,
          title: normalizedGroup.title
        });

        if (!existingGroup || existingGroup.windowId !== normalizedGroup.windowId) {
          deps.traceBackgroundEvent("autocorrect/group-resync", {
            cause: "tabGroups/onUpdated",
            reason: existingGroup ? "window-changed" : "missing-group",
            groupId: normalizedGroup.id,
            windowId: normalizedGroup.windowId
          });
          await deps.syncGroupFromChrome(group.id, group);
        }
      });
    },
    onRemoved: (group) => {
      deps.enqueueStoreTask(async () => {
        await deps.ensureInitialized();
        deps.handlePatch(deps.store.removeGroup(group.id));
        await deps.syncWindowFromChrome(group.windowId);
      });
    }
  };
}

export function createWindowEventHandlers(deps: Pick<
  BackgroundEventHandlerDependencies,
  | "enqueueStoreTask"
  | "ensureInitialized"
  | "store"
  | "handlePatch"
  | "windowSyncCoordinator"
  | "windowIdNone"
>): {
  onRemoved: (windowId: number) => void;
  onFocusChanged: (windowId: number) => void;
} {
  return {
    onRemoved: (windowId) => {
      deps.enqueueStoreTask(async () => {
        await deps.ensureInitialized();
        deps.handlePatch(deps.store.removeWindow(windowId));
      });
    },
    onFocusChanged: (windowId) => {
      if (windowId === deps.windowIdNone) {
        return;
      }

      void deps.windowSyncCoordinator.runAfterCurrentCycle({
        cause: "windows/onFocusChanged",
        task: async () => {
          await deps.ensureInitialized();
          deps.handlePatch(deps.store.focusWindow(windowId));
        }
      });
    }
  };
}
