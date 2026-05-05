import { describe, expect, it } from "vitest";
import type { DropTarget, DragSource } from "../src/sidepanel/components/listDrag";
import {
  findClosestDropTarget,
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
});
