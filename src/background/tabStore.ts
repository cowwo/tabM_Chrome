import { createSnapshot, createStateFromTabs, createEmptyState, applyPatch, purgeStaleWindows } from "../shared/domain/tabState";
import type { StorePatch, TabGroupRecord, TabRecord, TabStoreSnapshot, TabStoreState } from "../shared/types";

export interface BackgroundTabStore {
  initialize(tabs: TabRecord[], focusedWindowId: number | null, groups?: TabGroupRecord[]): void;
  getSnapshot(): TabStoreSnapshot;
  hasTab(tabId: number): boolean;
  getTab(tabId: number): TabRecord | undefined;
  getWindowTabIds(windowId: number): number[];
  getGroup(groupId: number): TabGroupRecord | undefined;
  upsertTab(tab: TabRecord): StorePatch | null;
  removeTab(tabId: number, windowId: number): StorePatch | null;
  upsertGroup(group: TabGroupRecord): StorePatch | null;
  removeGroup(groupId: number): StorePatch | null;
  focusWindow(windowId: number | null): StorePatch | null;
  removeWindow(windowId: number): StorePatch | null;
  setActiveTab(windowId: number, tabId: number): StorePatch[];
  purgeStaleWindows(liveWindowIds: ReadonlySet<number>): StorePatch[];
}

export function createBackgroundTabStore(): BackgroundTabStore {
  let state: TabStoreState = createEmptyState();
  let version = 0;

  function commitPatch(patch: StorePatch): StorePatch | null {
    const nextState = applyPatch(state, patch);
    if (nextState === state) {
      return null;
    }

    state = nextState;
    version += 1;
    return patch;
  }

  return {
    initialize(tabs, focusedWindowId, groups = []) {
      state = createStateFromTabs(tabs, focusedWindowId, groups);
      version += 1;
    },

    getSnapshot() {
      return createSnapshot(state, version);
    },

    hasTab(tabId) {
      return Boolean(state.tabsById[tabId]);
    },

    getTab(tabId) {
      return state.tabsById[tabId];
    },

    getWindowTabIds(windowId) {
      return [...(state.windowTabIds[windowId] ?? [])];
    },

    getGroup(groupId) {
      return state.groupsById[groupId];
    },

    upsertTab(tab) {
      return commitPatch({
        type: "tab/upsert",
        tab
      });
    },

    removeTab(tabId, windowId) {
      return commitPatch({
        type: "tab/remove",
        tabId,
        windowId
      });
    },

    upsertGroup(group) {
      return commitPatch({
        type: "group/upsert",
        group
      });
    },

    removeGroup(groupId) {
      return commitPatch({
        type: "group/remove",
        groupId
      });
    },

    focusWindow(windowId) {
      if (windowId == null) {
        return null;
      }

      return commitPatch({
        type: "window/focus",
        windowId
      });
    },

    removeWindow(windowId) {
      return commitPatch({
        type: "window/remove",
        windowId
      });
    },

    setActiveTab(windowId, tabId) {
      const patches: StorePatch[] = [];
      const currentIds = state.windowTabIds[windowId] ?? [];
      const currentActiveId = currentIds.find((candidateId) => state.tabsById[candidateId]?.active);

      if (currentActiveId === tabId) {
        return patches;
      }

      if (currentActiveId != null) {
        const previous = state.tabsById[currentActiveId];
        const patch = commitPatch({
          type: "tab/upsert",
          tab: {
            ...previous,
            active: false
          }
        });
        if (patch) {
          patches.push(patch);
        }
      }

      const next = state.tabsById[tabId];
      if (next) {
        const patch = commitPatch({
          type: "tab/upsert",
          tab: {
            ...next,
            active: true
          }
        });
        if (patch) {
          patches.push(patch);
        }
      }

      return patches;
    },

    purgeStaleWindows(liveWindowIds) {
      const patches: StorePatch[] = [];
      const staleWindowIds = state.windowOrder.filter((id) => !liveWindowIds.has(id));

      for (const windowId of staleWindowIds) {
        const patch = commitPatch({
          type: "window/remove",
          windowId
        });
        if (patch) {
          patches.push(patch);
        }
      }

      return patches;
    }
  };
}
