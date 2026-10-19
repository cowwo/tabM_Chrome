import { describe, expect, it } from "vitest";
import type { PanelRow } from "../src/shared/types";
import {
  buildVisibleTabIndex,
  reconcileVisibleTabSelection,
  resolveTabPrimaryAction,
  resolveTabSelection
} from "../src/sidepanel/tabSelection";

describe("tabSelection", () => {
  it("builds visible tab ids and index caches together", () => {
    const rows: PanelRow[] = [
      {
        kind: "window",
        key: "window-1",
        windowId: 1,
        title: "窗口 1 - A",
        isFocused: true,
        collapsed: false,
        totalCount: 2,
        firstUnpinnedTabIndex: 0
      },
      {
        kind: "tab",
        key: "tab-1",
        windowId: 1,
        tab: {
          id: 1,
          windowId: 1,
          index: 0,
          groupId: -1,
          title: "A",
          url: "https://a.com",
          pinned: false,
          active: true,
          audible: false,
          discarded: false,
          favIconUrl: null,
          lastAccessed: 0
        }
      },
      {
        kind: "tab",
        key: "tab-2",
        windowId: 1,
        tab: {
          id: 2,
          windowId: 1,
          index: 1,
          groupId: -1,
          title: "B",
          url: "https://b.com",
          pinned: false,
          active: false,
          audible: false,
          discarded: false,
          favIconUrl: null,
          lastAccessed: 0
        }
      }
    ];

    expect(buildVisibleTabIndex(rows)).toEqual({
      ids: [1, 2],
      idSet: new Set([1, 2]),
      indexById: new Map([
        [1, 0],
        [2, 1]
      ])
    });
  });


  it("supports ctrl or cmd toggle selection without activating the tab", () => {
    expect(
      resolveTabSelection({
        visibleTabIds: [1, 2, 3, 4],
        selectedTabIds: [2],
        anchorTabId: 2,
        tabId: 4,
        shiftKey: false,
        toggleKey: true
      })
    ).toEqual({
      selectedTabIds: [2, 4],
      anchorTabId: 4
    });
  });

  it("supports shift range selection across the current visible order", () => {
    expect(
      resolveTabSelection({
        visibleTabIds: [1, 2, 3, 4, 5],
        selectedTabIds: [2],
        anchorTabId: 2,
        tabId: 5,
        shiftKey: true,
        toggleKey: false
      })
    ).toEqual({
      selectedTabIds: [2, 3, 4, 5],
      anchorTabId: 2
    });
  });

  it("uses the nearest selected tab as the shift anchor", () => {
    expect(
      resolveTabSelection({
        visibleTabIds: [1, 2, 3, 4, 5, 6],
        selectedTabIds: [1, 4],
        anchorTabId: 4,
        tabId: 6,
        shiftKey: true,
        toggleKey: false
      })
    ).toEqual({
      selectedTabIds: [1, 4, 5, 6],
      anchorTabId: 4
    });
  });

  it("uses the upper selected tab when two selected anchors are equally near", () => {
    expect(
      resolveTabSelection({
        visibleTabIds: [1, 2, 3, 4, 5],
        selectedTabIds: [1, 5],
        anchorTabId: 5,
        tabId: 3,
        shiftKey: true,
        toggleKey: false
      })
    ).toEqual({
      selectedTabIds: [1, 2, 3, 5],
      anchorTabId: 1
    });
  });

  it("prefers the nearest selected tab over a stale anchor tab", () => {
    expect(
      resolveTabSelection({
        visibleTabIds: [1, 2, 3, 4, 5, 6],
        selectedTabIds: [2, 5],
        anchorTabId: 2,
        tabId: 6,
        shiftKey: true,
        toggleKey: false
      })
    ).toEqual({
      selectedTabIds: [2, 5, 6],
      anchorTabId: 5
    });
  });

  it("supports ctrl/cmd + shift by appending a visible range", () => {
    expect(
      resolveTabSelection({
        visibleTabIds: [1, 2, 3, 4, 5],
        selectedTabIds: [1],
        anchorTabId: 1,
        tabId: 4,
        shiftKey: true,
        toggleKey: true
      })
    ).toEqual({
      selectedTabIds: [1, 2, 3, 4],
      anchorTabId: 1
    });
  });

  it("activates the tab on plain click outside selection mode", () => {
    expect(
      resolveTabPrimaryAction({
        visibleTabIds: [1, 2, 3],
        selectedTabIds: [2],
        anchorTabId: 2,
        tabId: 3,
        shiftKey: false,
        toggleKey: false,
        selectionMode: false
      })
    ).toEqual({
      selectedTabIds: [],
      anchorTabId: null,
      selectionMode: false,
      shouldActivateTab: true
    });
  });

  it("enters selection mode on cmd or ctrl click and toggles one tab", () => {
    expect(
      resolveTabPrimaryAction({
        visibleTabIds: [1, 2, 3, 4],
        selectedTabIds: [],
        anchorTabId: null,
        tabId: 4,
        shiftKey: false,
        toggleKey: true,
        selectionMode: false
      })
    ).toEqual({
      selectedTabIds: [4],
      anchorTabId: 4,
      selectionMode: true,
      shouldActivateTab: false
    });
  });

  it("enters selection mode on shift click and selects a range from the clicked tab", () => {
    expect(
      resolveTabPrimaryAction({
        visibleTabIds: [1, 2, 3, 4],
        selectedTabIds: [],
        anchorTabId: null,
        tabId: 3,
        shiftKey: true,
        toggleKey: false,
        selectionMode: false
      })
    ).toEqual({
      selectedTabIds: [3],
      anchorTabId: 3,
      selectionMode: true,
      shouldActivateTab: false
    });
  });

  it("keeps selection mode and toggles on plain click inside selection mode", () => {
    expect(
      resolveTabPrimaryAction({
        visibleTabIds: [1, 2, 3, 4],
        selectedTabIds: [2],
        anchorTabId: 2,
        tabId: 4,
        shiftKey: false,
        toggleKey: false,
        selectionMode: true
      })
    ).toEqual({
      selectedTabIds: [2, 4],
      anchorTabId: 4,
      selectionMode: true,
      shouldActivateTab: false
    });
  });

  it("keeps selection mode after clearing the last selected tab", () => {
    expect(
      resolveTabPrimaryAction({
        visibleTabIds: [1, 2, 3],
        selectedTabIds: [2],
        anchorTabId: 2,
        tabId: 2,
        shiftKey: false,
        toggleKey: false,
        selectionMode: true
      })
    ).toEqual({
      selectedTabIds: [],
      anchorTabId: null,
      selectionMode: true,
      shouldActivateTab: false
    });
  });

  it("extends the current range on shift click inside selection mode", () => {
    expect(
      resolveTabPrimaryAction({
        visibleTabIds: [1, 2, 3, 4, 5],
        selectedTabIds: [2],
        anchorTabId: 2,
        tabId: 5,
        shiftKey: true,
        toggleKey: false,
        selectionMode: true
      })
    ).toEqual({
      selectedTabIds: [2, 3, 4, 5],
      anchorTabId: 2,
      selectionMode: true,
      shouldActivateTab: false
    });
  });

  it("clears hidden selections and resets a hidden anchor", () => {
    expect(
      reconcileVisibleTabSelection({
        visibleTabIds: [3, 4, 5],
        selectedTabIds: [2, 4, 5],
        anchorTabId: 2
      })
    ).toEqual({
      selectedTabIds: [4, 5],
      anchorTabId: null
    });
  });
});
