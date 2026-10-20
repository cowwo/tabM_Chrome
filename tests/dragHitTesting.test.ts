import { describe, expect, it } from "vitest";
import type { PanelRow } from "../src/shared/types";
import type { DropTarget, DragSource } from "../src/sidepanel/components/listDrag";
import {
  collectRenderedDragRows,
  createDragHitTestIndex,
  findClosestDropTarget,
  findClosestDropTargetInIndex,
  findNearestDragEntryIndex,
  isDragHitTestCacheValid,
  type DragHitTestRow,
  type PointerPosition
} from "../src/sidepanel/components/dragHitTesting";

function makePointerPosition(overrides: Partial<PointerPosition> = {}): PointerPosition {
  return {
    clientX: overrides.clientX ?? 24,
    clientY: overrides.clientY ?? 24
  };
}

function makeDragHitTestRow(overrides: Partial<DragHitTestRow>): DragHitTestRow {
  return {
    row: overrides.row!,
    rect: overrides.rect ?? {
      top: 0,
      bottom: 40,
      left: 0,
      right: 200,
      height: 40,
      width: 200,
      x: 0,
      y: 0,
      toJSON: () => ({})
    },
    level: overrides.level ?? 0
  };
}

describe("dragHitTesting", () => {
  const tabSource: DragSource = {
    kind: "tab",
    rowKey: "tab-1",
    tabId: 1,
    windowId: 1,
    index: 0,
    groupId: null
  };

  it("maps a pointer in the gap between rows to the nearest legal after-slot", () => {
    const rows: DragHitTestRow[] = [
      makeDragHitTestRow({
        row: {
          kind: "tab",
          key: "tab-2",
          windowId: 1,
          tab: {
            id: 2,
            windowId: 1,
            index: 2,
            groupId: -1,
            title: "Tab 2",
            url: "https://example.com/2",
            pinned: false,
            active: false,
            audible: false,
            discarded: false,
            favIconUrl: null,
            lastAccessed: 0
          }
        },
        rect: {
          top: 40,
          bottom: 80,
          left: 0,
          right: 200,
          height: 40,
          width: 200,
          x: 0,
          y: 40,
          toJSON: () => ({})
        }
      }),
      makeDragHitTestRow({
        row: {
          kind: "tab",
          key: "tab-3",
          windowId: 1,
          tab: {
            id: 3,
            windowId: 1,
            index: 3,
            groupId: -1,
            title: "Tab 3",
            url: "https://example.com/3",
            pinned: false,
            active: false,
            audible: false,
            discarded: false,
            favIconUrl: null,
            lastAccessed: 0
          }
        },
        rect: {
          top: 86,
          bottom: 126,
          left: 0,
          right: 200,
          height: 40,
          width: 200,
          x: 0,
          y: 86,
          toJSON: () => ({})
        }
      })
    ];

    expect(
      findClosestDropTarget({
        source: tabSource,
        pointer: makePointerPosition({ clientY: 83 }),
        rows
      })
    ).toEqual({
      rowKey: "tab-2",
      targetWindowId: 1,
      targetIndex: 3,
      targetGroupId: null,
      indicator: "after"
    } satisfies DropTarget);
  });

  it("maps a pointer above the first visible row to the first legal slot", () => {
    const rows: DragHitTestRow[] = [
      makeDragHitTestRow({
        row: {
          kind: "window",
          key: "window-1",
          windowId: 1,
          title: "Window 1",
          isFocused: true,
          collapsed: false,
          totalCount: 3,
          firstUnpinnedTabIndex: 1
        },
        rect: {
          top: 20,
          bottom: 60,
          left: 0,
          right: 200,
          height: 40,
          width: 200,
          x: 0,
          y: 20,
          toJSON: () => ({})
        }
      })
    ];

    expect(
      findClosestDropTarget({
        source: tabSource,
        pointer: makePointerPosition({ clientY: 4 }),
        rows
      })
    ).toEqual({
      rowKey: "window-1",
      targetWindowId: 1,
      targetIndex: 1,
      targetGroupId: null,
      indicator: "window-start"
    } satisfies DropTarget);
  });

  it("prefers into-group when the pointer is in the body zone of a group row", () => {
    const rows: DragHitTestRow[] = [
      makeDragHitTestRow({
        row: {
          kind: "group",
          key: "group-9",
          windowId: 1,
          groupId: 9,
          title: "Group 9",
          color: "blue",
          collapsed: false,
          totalCount: 2,
          tabIds: [91, 92],
          firstTabIndex: 4
        },
        rect: {
          top: 100,
          bottom: 144,
          left: 0,
          right: 200,
          height: 44,
          width: 200,
          x: 0,
          y: 100,
          toJSON: () => ({})
        }
      })
    ];

    expect(
      findClosestDropTarget({
        source: tabSource,
        pointer: makePointerPosition({ clientY: 122 }),
        rows
      })
    ).toEqual({
      rowKey: "group-9",
      targetWindowId: 1,
      targetIndex: 4,
      targetGroupId: 9,
      indicator: "into-group"
    } satisfies DropTarget);
  });

  it("falls back to the nearest legal neighboring row when the closest row is illegal", () => {
    const selectedTabsSource: DragSource = {
      kind: "tabs",
      rowKey: "tab-2",
      tabIds: [2, 4],
      tabs: [
        {
          tabId: 2,
          windowId: 1,
          index: 2,
          groupId: null
        },
        {
          tabId: 4,
          windowId: 1,
          index: 4,
          groupId: null
        }
      ]
    };

    const rows: DragHitTestRow[] = [
      makeDragHitTestRow({
        row: {
          kind: "tab",
          key: "tab-1",
          windowId: 1,
          tab: {
            id: 1,
            windowId: 1,
            index: 1,
            groupId: -1,
            title: "Tab 1",
            url: "https://example.com/1",
            pinned: false,
            active: false,
            audible: false,
            discarded: false,
            favIconUrl: null,
            lastAccessed: 0
          }
        },
        rect: {
          top: 0,
          bottom: 34,
          left: 0,
          right: 200,
          height: 34,
          width: 200,
          x: 0,
          y: 0,
          toJSON: () => ({})
        }
      }),
      makeDragHitTestRow({
        row: {
          kind: "tab",
          key: "tab-2",
          windowId: 1,
          tab: {
            id: 2,
            windowId: 1,
            index: 2,
            groupId: -1,
            title: "Tab 2",
            url: "https://example.com/2",
            pinned: false,
            active: false,
            audible: false,
            discarded: false,
            favIconUrl: null,
            lastAccessed: 0
          }
        },
        rect: {
          top: 40,
          bottom: 80,
          left: 0,
          right: 200,
          height: 40,
          width: 200,
          x: 0,
          y: 40,
          toJSON: () => ({})
        }
      }),
      makeDragHitTestRow({
        row: {
          kind: "tab",
          key: "tab-3",
          windowId: 1,
          tab: {
            id: 3,
            windowId: 1,
            index: 3,
            groupId: -1,
            title: "Tab 3",
            url: "https://example.com/3",
            pinned: false,
            active: false,
            audible: false,
            discarded: false,
            favIconUrl: null,
            lastAccessed: 0
          }
        },
        rect: {
          top: 86,
          bottom: 126,
          left: 0,
          right: 200,
          height: 40,
          width: 200,
          x: 0,
          y: 86,
          toJSON: () => ({})
        }
      })
    ];

    expect(
      findClosestDropTarget({
        source: selectedTabsSource,
        pointer: makePointerPosition({ clientY: 70 }),
        rows
      })
    ).toEqual({
      rowKey: "tab-3",
      targetWindowId: 1,
      targetIndex: 3,
      targetGroupId: null,
      indicator: "before"
    } satisfies DropTarget);
  });

  it("prefers parent group into-group when pointer is over a child tab in a cross-window drag", () => {
    const crossWindowSource: DragSource = {
      kind: "tab",
      rowKey: "tab-1",
      tabId: 1,
      windowId: 2,
      index: 0,
      groupId: null
    };

    const rows: DragHitTestRow[] = [
      makeDragHitTestRow({
        row: {
          kind: "group",
          key: "group-9",
          windowId: 1,
          groupId: 9,
          title: "Group 9",
          color: "blue",
          collapsed: false,
          totalCount: 2,
          tabIds: [91, 92],
          firstTabIndex: 4
        },
        rect: {
          top: 100,
          bottom: 144,
          left: 0,
          right: 200,
          height: 44,
          width: 200,
          x: 0,
          y: 100,
          toJSON: () => ({})
        }
      }),
      makeDragHitTestRow({
        row: {
          kind: "tab",
          key: "tab-91",
          windowId: 1,
          tab: {
            id: 91,
            windowId: 1,
            index: 4,
            groupId: 9,
            title: "Tab 91",
            url: "https://example.com/91",
            pinned: false,
            active: false,
            audible: false,
            discarded: false,
            favIconUrl: null,
            lastAccessed: 0
          }
        },
        rect: {
          top: 150,
          bottom: 190,
          left: 24,
          right: 200,
          height: 40,
          width: 176,
          x: 24,
          y: 150,
          toJSON: () => ({})
        }
      })
    ];

    expect(
      findClosestDropTarget({
        source: crossWindowSource,
        pointer: { clientX: 100, clientY: 170 },
        rows
      })
    ).toEqual({
      rowKey: "group-9",
      targetWindowId: 1,
      targetIndex: 4,
      targetGroupId: 9,
      indicator: "into-group"
    } satisfies DropTarget);
  });

  it("keeps same-group intra-group drop behavior when pointer is over a child tab", () => {
    const sameGroupSource: DragSource = {
      kind: "tab",
      rowKey: "tab-92",
      tabId: 92,
      windowId: 1,
      index: 5,
      groupId: 9
    };

    const rows: DragHitTestRow[] = [
      makeDragHitTestRow({
        row: {
          kind: "group",
          key: "group-9",
          windowId: 1,
          groupId: 9,
          title: "Group 9",
          color: "blue",
          collapsed: false,
          totalCount: 2,
          tabIds: [91, 92],
          firstTabIndex: 4
        },
        rect: {
          top: 100,
          bottom: 144,
          left: 0,
          right: 200,
          height: 44,
          width: 200,
          x: 0,
          y: 100,
          toJSON: () => ({})
        }
      }),
      makeDragHitTestRow({
        row: {
          kind: "tab",
          key: "tab-91",
          windowId: 1,
          tab: {
            id: 91,
            windowId: 1,
            index: 4,
            groupId: 9,
            title: "Tab 91",
            url: "https://example.com/91",
            pinned: false,
            active: false,
            audible: false,
            discarded: false,
            favIconUrl: null,
            lastAccessed: 0
          }
        },
        rect: {
          top: 150,
          bottom: 190,
          left: 24,
          right: 200,
          height: 40,
          width: 176,
          x: 24,
          y: 150,
          toJSON: () => ({})
        }
      })
    ];

    expect(
      findClosestDropTarget({
        source: sameGroupSource,
        pointer: { clientX: 100, clientY: 170 },
        rows
      })
    ).toEqual({
      rowKey: "tab-91",
      targetWindowId: 1,
      targetIndex: 5,
      targetGroupId: 9,
      indicator: "after"
    } satisfies DropTarget);
  });
});

// ── 缓存索引 + 二分命中（拖拽热路径） ────────────────────────────────

function makeRect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 200,
    height,
    width: 200,
    x: 0,
    y: top,
    toJSON: () => ({})
  } as DOMRect;
}

function makeTabHitRow(id: number, index: number, top: number, height = 38): DragHitTestRow {
  return {
    row: {
      kind: "tab",
      key: `tab-${id}`,
      windowId: 1,
      tab: {
        id,
        windowId: 1,
        index,
        groupId: -1,
        title: `Tab ${id}`,
        url: "https://example.com",
        pinned: false,
        active: false,
        audible: false,
        discarded: false,
        favIconUrl: null,
        lastAccessed: 0
      }
    },
    rect: makeRect(top, height),
    level: 0
  };
}

describe("dragHitTesting index cache", () => {
  const tabSource: DragSource = {
    kind: "tab",
    rowKey: "tab-1",
    tabId: 1,
    windowId: 1,
    index: 0,
    groupId: null
  };

  it("sorts entries by rect top when building the index", () => {
    const rows = [makeTabHitRow(3, 2, 80), makeTabHitRow(2, 1, 40), makeTabHitRow(1, 0, 0)];
    const index = createDragHitTestIndex(rows);

    expect(index.entries.map((entry) => entry.row.kind === "tab" ? entry.row.tab.id : 0)).toEqual([1, 2, 3]);
  });

  it("binary-searches the nearest entry above, inside and below the list", () => {
    const index = createDragHitTestIndex([
      makeTabHitRow(1, 0, 0, 40),
      makeTabHitRow(2, 1, 44, 40),
      makeTabHitRow(3, 2, 88, 40)
    ]);

    expect(findNearestDragEntryIndex(index.entries, -100)).toBe(0);
    expect(findNearestDragEntryIndex(index.entries, 0)).toBe(0);
    expect(findNearestDragEntryIndex(index.entries, 46)).toBe(1);
    expect(findNearestDragEntryIndex(index.entries, 200)).toBe(2);
    expect(findNearestDragEntryIndex([], 10)).toBe(-1);
  });

  it("matches the legacy sort-based hit test for sorted rows", () => {
    const rows = [
      makeTabHitRow(1, 0, 0, 40),
      makeTabHitRow(2, 1, 44, 40),
      makeTabHitRow(3, 2, 88, 40)
    ];
    const index = createDragHitTestIndex(rows);

    for (let clientY = -20; clientY <= 150; clientY += 3) {
      const pointer = makePointerPosition({ clientY });
      expect(
        findClosestDropTargetInIndex({ source: tabSource, pointer, index })
      ).toEqual(
        findClosestDropTarget({ source: tabSource, pointer, rows })
      );
    }
  });

  it("validates the cached rect index against scroll/rows/layout revisions", () => {
    const index = createDragHitTestIndex([makeTabHitRow(1, 0, 0)]);

    expect(
      isDragHitTestCacheValid({
        cache: null,
        scrollTop: 0,
        rowsRevision: 1,
        layoutRevision: 1
      })
    ).toBe(false);

    expect(
      isDragHitTestCacheValid({
        cache: { index, scrollTop: 12, rowsRevision: 3, layoutRevision: 4 },
        scrollTop: 12,
        rowsRevision: 3,
        layoutRevision: 4
      })
    ).toBe(true);

    // 滚动后失效
    expect(
      isDragHitTestCacheValid({
        cache: { index, scrollTop: 12, rowsRevision: 3, layoutRevision: 4 },
        scrollTop: 13,
        rowsRevision: 3,
        layoutRevision: 4
      })
    ).toBe(false);

    // 行集合变化后失效
    expect(
      isDragHitTestCacheValid({
        cache: { index, scrollTop: 12, rowsRevision: 3, layoutRevision: 4 },
        scrollTop: 12,
        rowsRevision: 4,
        layoutRevision: 4
      })
    ).toBe(false);

    // 折叠/布局变化后失效
    expect(
      isDragHitTestCacheValid({
        cache: { index, scrollTop: 12, rowsRevision: 3, layoutRevision: 4 },
        scrollTop: 12,
        rowsRevision: 3,
        layoutRevision: 5
      })
    ).toBe(false);
  });

  it("collects only mounted rows and ignores unknown row keys", () => {
    const mountedRow = makeTabHitRow(1, 0, 0);
    const rowByKey = new Map<string, PanelRow>([[mountedRow.row.key, mountedRow.row]]);
    const rowRefs = new Map<string, HTMLElement>([
      [
        mountedRow.row.key,
        {
          getBoundingClientRect: () => makeRect(24, 38)
        } as unknown as HTMLElement
      ],
      [
        "tab-removed",
        {
          getBoundingClientRect: () => makeRect(100, 38)
        } as unknown as HTMLElement
      ]
    ]);

    const entries = collectRenderedDragRows({ rowRefs, rowByKey });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.row.key).toBe("tab-1");
    expect(entries[0]!.rect.top).toBe(24);
  });
});
