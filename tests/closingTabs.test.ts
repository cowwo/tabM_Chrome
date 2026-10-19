import { describe, expect, it } from "vitest";
import { reconcileClosingTabIds } from "../src/sidepanel/closingTabs";
import type { TabStoreSnapshot } from "../src/shared/types";

function createSnapshot(): TabStoreSnapshot {
  return {
    version: 8,
    focusedWindowId: 1,
    tabsById: {
      1: {
        id: 1,
        windowId: 1,
        index: 0,
        groupId: -1,
        title: "首页",
        url: "https://example.com",
        pinned: false,
        active: false,
        audible: false,
        discarded: false,
        favIconUrl: null,
        lastAccessed: 0
      },
      2: {
        id: 2,
        windowId: 1,
        index: 1,
        groupId: 66,
        title: "组内一",
        url: "https://example.com/group-1",
        pinned: false,
        active: true,
        audible: false,
        discarded: false,
        favIconUrl: null,
        lastAccessed: 0
      },
      3: {
        id: 3,
        windowId: 1,
        index: 2,
        groupId: 66,
        title: "组内二",
        url: "https://example.com/group-2",
        pinned: false,
        active: false,
        audible: false,
        discarded: false,
        favIconUrl: null,
        lastAccessed: 0
      },
      4: {
        id: 4,
        windowId: 2,
        index: 0,
        groupId: -1,
        title: "第二窗口",
        url: "https://example.com/window-2",
        pinned: false,
        active: false,
        audible: false,
        discarded: false,
        favIconUrl: null,
        lastAccessed: 0
      }
    },
    windowTabIds: {
      1: [1, 2, 3],
      2: [4]
    },
    windowOrder: [1, 2],
    groupsById: {
      66: {
        id: 66,
        windowId: 1,
        title: "测试组",
        color: "blue",
        collapsed: false
      }
    }
  };
}

describe("closingTabs", () => {
  it("keeps only tabs that still exist in the latest snapshot", () => {
    expect(reconcileClosingTabIds([2, 8], createSnapshot())).toEqual([2]);
  });

  it("clears pending close ids after Chrome confirms a tab is gone", () => {
    expect(reconcileClosingTabIds([3], {
      ...createSnapshot(),
      tabsById: {
        1: createSnapshot().tabsById[1],
        2: createSnapshot().tabsById[2],
        4: createSnapshot().tabsById[4]
      }
    })).toEqual([]);
  });
});
