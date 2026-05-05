import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NO_TAB_GROUP_ID } from "../src/shared/defaults";
import { buildWindowRenderSections } from "../src/shared/domain/selectors";
import type { PanelRow, TabRecord } from "../src/shared/types";
import { areRowShellPropsEqual, RowShell, type RowShellProps } from "../src/sidepanel/components/listRows";
import {
  calculateAnchorScrollAdjustment,
  calculateRequiredBottomSpacer,
  calculateStickyHeaderObstruction,
  calculateTargetRowScrollAdjustment,
  canReleaseBottomSpacer,
  getTabRowClassName,
  resolveActiveRowAutoScroll,
  shouldHandleLocateRequest,
  shouldPulseLocateRow,
  shouldScrollToActiveRow
} from "../src/sidepanel/components/listUtils";
import {
  buildDragCommand,
  buildFallbackDragCommand,
  createDragSource,
  createSelectedTabsDragSource,
  resolveDropTarget
} from "../src/sidepanel/components/listDrag";
import {
  findClosestDropTarget,
  type DragHitTestRow
} from "../src/sidepanel/components/dragHitTesting";
import {
  collectVisibleDragRows,
  createPointerDragSource,
  isPointerWithinContainerBounds,
  resolveDraggedRowKey,
  resolvePointerCancelResult,
  resolvePointerDragAutoScrollLoopState,
  resolvePointerDragAutoScrollTickResult,
  resolvePointerDragPhase,
  resolvePointerDropOutcome,
  resolvePointerUpResult,
  resolveRenderedDropIndicator,
  shouldClearPointerDragSession,
  shouldClearSelectionOnPointerDown,
  shouldHandleSelectionGestureOnPointerDown,
  shouldStartPointerDragSession,
  shouldSuppressPostDragClick
} from "../src/sidepanel/components/VirtualizedWindowList";

function makeTab(overrides: Partial<TabRecord> = {}): TabRecord {
  return {
    id: overrides.id ?? 1,
    windowId: overrides.windowId ?? 1,
    index: overrides.index ?? 0,
    groupId: overrides.groupId ?? NO_TAB_GROUP_ID,
    title: overrides.title ?? `Tab ${overrides.id ?? 1}`,
    url: overrides.url ?? "https://example.com",
    pinned: overrides.pinned ?? false,
    active: overrides.active ?? false,
    audible: overrides.audible ?? false,
    discarded: overrides.discarded ?? false,
    favIconUrl: overrides.favIconUrl ?? null,
    lastAccessed: overrides.lastAccessed ?? 0
  };
}

function makeWindowRow(overrides: Partial<Extract<PanelRow, { kind: "window" }>> = {}): Extract<
  PanelRow,
  { kind: "window" }
> {
  return {
    kind: "window",
    key: overrides.key ?? `window-${overrides.windowId ?? 1}`,
    windowId: overrides.windowId ?? 1,
    title: overrides.title ?? `Window ${overrides.windowId ?? 1}`,
    isFocused: overrides.isFocused ?? false,
    collapsed: overrides.collapsed ?? false,
    totalCount: overrides.totalCount ?? 0,
    firstUnpinnedTabIndex: overrides.firstUnpinnedTabIndex ?? 0
  };
}

function makeGroupRow(overrides: Partial<Extract<PanelRow, { kind: "group" }>> = {}): Extract<
  PanelRow,
  { kind: "group" }
> {
  return {
    kind: "group",
    key: overrides.key ?? `group-${overrides.groupId ?? 10}`,
    windowId: overrides.windowId ?? 1,
    groupId: overrides.groupId ?? 10,
    title: overrides.title ?? `Group ${overrides.groupId ?? 10}`,
    color: overrides.color ?? "blue",
    collapsed: overrides.collapsed ?? false,
    totalCount: overrides.totalCount ?? 2,
    tabIds: overrides.tabIds ?? [101, 102],
    firstTabIndex: overrides.firstTabIndex ?? 0
  };
}

function makeTabRow(overrides: Partial<Extract<PanelRow, { kind: "tab" }>> = {}): Extract<
  PanelRow,
  { kind: "tab" }
> {
  const tab = overrides.tab ?? makeTab();
  return {
    kind: "tab",
    key: overrides.key ?? `tab-${tab.id}`,
    windowId: overrides.windowId ?? tab.windowId,
    tab
  };
}

function makeDragHitTestRowFromTab(
  tab: TabRecord,
  top: number,
  bottom: number,
  overrides: Partial<DragHitTestRow> = {}
): DragHitTestRow {
  return {
    row: overrides.row ?? makeTabRow({ tab }),
    rect: overrides.rect ?? {
      top,
      bottom,
      left: 0,
      right: 200,
      height: bottom - top,
      width: 200,
      x: 0,
      y: top,
      toJSON: () => ({})
    },
    level: overrides.level ?? 0
  };
}

function makeRowShellProps(overrides: Partial<RowShellProps> = {}): RowShellProps {
  const row = overrides.row ?? makeTabRow({ tab: makeTab({ id: 8, index: 3 }) });
  return {
    locale: overrides.locale ?? "zh-CN",
    row,
    rowRefs: overrides.rowRefs ?? { current: new Map<string, HTMLDivElement>() },
    isCurrentActive: overrides.isCurrentActive ?? false,
    isWindowActive: overrides.isWindowActive ?? false,
    isClosing: overrides.isClosing ?? false,
    isSelected: overrides.isSelected ?? false,
    isLocatePulsing: overrides.isLocatePulsing ?? false,
    onCaptureManualToggleAnchor: overrides.onCaptureManualToggleAnchor ?? (() => undefined),
    disabled: overrides.disabled ?? false,
    onClearSelection: overrides.onClearSelection ?? (() => undefined),
    onToggleWindow: overrides.onToggleWindow ?? (() => undefined),
    onToggleGroup: overrides.onToggleGroup ?? (() => undefined),
    onActivateTab: overrides.onActivateTab ?? (() => undefined),
    onTogglePinned: overrides.onTogglePinned ?? (() => undefined),
    onCloseTab: overrides.onCloseTab ?? (() => undefined),
    selectionMode: overrides.selectionMode ?? false,
    onPointerDown: overrides.onPointerDown ?? (() => undefined),
    onPointerEnter: overrides.onPointerEnter ?? (() => undefined),
    onPointerMove: overrides.onPointerMove ?? (() => undefined),
    onPointerUp: overrides.onPointerUp ?? (() => undefined),
    onPointerCancel: overrides.onPointerCancel ?? (() => undefined),
    extraClassName: overrides.extraClassName,
    groupedTabColor: overrides.groupedTabColor,
    visuallyExpanded: overrides.visuallyExpanded ?? false,
    isDragging: overrides.isDragging ?? false,
    dropIndicator: overrides.dropIndicator ?? null,
    onElementRefChange: overrides.onElementRefChange,
    onHoveredTabChange: overrides.onHoveredTabChange
  };
}

function renderRowShellMarkup(overrides: Partial<RowShellProps>): string {
  return renderToStaticMarkup(
    createElement(RowShell, makeRowShellProps(overrides))
  );
}

describe("VirtualizedWindowList helpers", () => {
  it("marks the active dragged row and computed drop indicator from pointer session state", () => {
    const currentTarget = {
      rowKey: "tab-2",
      targetWindowId: 1,
      targetIndex: 3,
      targetGroupId: null,
      indicator: "after" as const
    };

    expect(resolveDraggedRowKey({ phase: "dragging", sourceRowKey: "tab-1" })).toBe("tab-1");
    expect(resolveRenderedDropIndicator({ rowKey: "tab-2", target: currentTarget })).toBe("after");
  });

  it("routes modifier-assisted tab pointerdown to selection instead of drag", () => {
    expect(
      shouldHandleSelectionGestureOnPointerDown({
        row: makeTabRow({ tab: makeTab({ id: 2, index: 1 }) }),
        pointerGesture: {
          ctrlKey: true,
          metaKey: false,
          shiftKey: false
        }
      })
    ).toBe(true);

    expect(
      shouldHandleSelectionGestureOnPointerDown({
        row: makeTabRow({ tab: makeTab({ id: 2, index: 1 }) }),
        pointerGesture: {
          ctrlKey: false,
          metaKey: false,
          shiftKey: false
        }
      })
    ).toBe(false);
  });

  it("does not start a pointer drag session when a selection modifier is held", () => {
    const source = createDragSource(makeTabRow({ tab: makeTab({ id: 2, index: 1 }) }));
    if (!source) {
      throw new Error("expected source");
    }

    expect(
      shouldStartPointerDragSession({
        source,
        pointerGesture: {
          ctrlKey: true,
          metaKey: false,
          shiftKey: false
        }
      })
    ).toBe(false);
  });

  it("does not clear existing selection on pointer down when a multi-select modifier is held", () => {
    expect(
      shouldClearSelectionOnPointerDown({
        row: makeTabRow({ tab: makeTab({ id: 2, index: 1 }) }),
        selectedTabIds: new Set([1]),
        pointerGesture: {
          ctrlKey: true,
          metaKey: false,
          shiftKey: false
        }
      })
    ).toBe(false);
  });

  it("does not start a drag source when a multi-select modifier is held", () => {
    const rows = [
      makeTabRow({ tab: makeTab({ id: 1, index: 0 }) }),
      makeTabRow({ tab: makeTab({ id: 2, index: 1 }) })
    ];

    expect(
      createPointerDragSource({
        row: rows[1],
        rows,
        selectedTabIds: new Set([1]),
        pointerGesture: {
          ctrlKey: true,
          metaKey: false,
          shiftKey: false
        }
      })
    ).toBeNull();
  });

  it("creates a multi-tab drag source when the row is already selected and no selection modifier is held", () => {
    const rows = [
      makeTabRow({ tab: makeTab({ id: 1, index: 0 }) }),
      makeTabRow({ tab: makeTab({ id: 2, index: 1 }) })
    ];

    expect(
      createPointerDragSource({
        row: rows[1],
        rows,
        selectedTabIds: new Set([1, 2]),
        pointerGesture: {
          ctrlKey: false,
          metaKey: false,
          shiftKey: false
        }
      })
    ).toEqual({
      kind: "tabs",
      rowKey: "tab-2",
      tabIds: [1, 2],
      tabs: [
        { tabId: 1, windowId: 1, index: 0, groupId: null },
        { tabId: 2, windowId: 1, index: 1, groupId: null }
      ]
    });
  });

  it("starts dragging only after pointer movement exceeds threshold", () => {
    expect(
      resolvePointerDragPhase({
        origin: { x: 10, y: 10 },
        pointer: { x: 12, y: 13 },
        threshold: 6
      })
    ).toBe("pressing");

    expect(
      resolvePointerDragPhase({
        origin: { x: 10, y: 10 },
        pointer: { x: 20, y: 20 },
        threshold: 6
      })
    ).toBe("dragging");
  });

  it("allows auto-scroll to restart within the same dragging session after becoming inactive", () => {
    expect(
      resolvePointerDragAutoScrollLoopState({
        isDragging: true,
        hasScheduledFrame: false,
        delta: 12,
        didScroll: true
      })
    ).toEqual({
      shouldScheduleFromPointerMove: true,
      shouldScheduleNextFrame: true
    });

    expect(
      resolvePointerDragAutoScrollLoopState({
        isDragging: true,
        hasScheduledFrame: true,
        delta: 0,
        didScroll: false
      })
    ).toEqual({
      shouldScheduleFromPointerMove: false,
      shouldScheduleNextFrame: false
    });

    expect(
      resolvePointerDragAutoScrollLoopState({
        isDragging: true,
        hasScheduledFrame: false,
        delta: 18,
        didScroll: true
      })
    ).toEqual({
      shouldScheduleFromPointerMove: true,
      shouldScheduleNextFrame: true
    });
  });

  it("scrolls to an active row when it first appears", () => {
    expect(
      shouldScrollToActiveRow({
        activeRowKey: "tab-2",
        hasActiveRowInList: true,
        hasRenderedTargetRow: true,
        hasCompletedInitialScroll: false,
        previousScrolledRowKey: null
      })
    ).toBe(true);
  });

  it("does not scroll when the active row is not ready", () => {
    expect(
      shouldScrollToActiveRow({
        activeRowKey: "tab-2",
        hasActiveRowInList: false,
        hasRenderedTargetRow: false,
        hasCompletedInitialScroll: false,
        previousScrolledRowKey: null
      })
    ).toBe(false);
  });

  it("suppresses one auto-scroll pass after a manual collapse", () => {
    expect(
      resolveActiveRowAutoScroll({
        activeRowKey: "tab-2",
        hasActiveRowInList: true,
        hasRenderedTargetRow: true,
        hasCompletedInitialScroll: true,
        previousScrolledRowKey: "tab-2",
        suppressedActiveRowKey: "tab-2"
      })
    ).toEqual({
      shouldScroll: false,
      nextPreviousScrolledRowKey: "tab-2",
      nextSuppressedActiveRowKey: null
    });
  });

  it("scrolls when the active row actually changes", () => {
    expect(
      resolveActiveRowAutoScroll({
        activeRowKey: "tab-3",
        hasActiveRowInList: true,
        hasRenderedTargetRow: true,
        hasCompletedInitialScroll: true,
        previousScrolledRowKey: "tab-2",
        suppressedActiveRowKey: null
      })
    ).toEqual({
      shouldScroll: true,
      nextPreviousScrolledRowKey: "tab-3",
      nextSuppressedActiveRowKey: null
    });
  });

  it("calculates anchor and target-row scroll adjustments", () => {
    expect(
      calculateAnchorScrollAdjustment({
        previousRowTop: 140,
        nextRowTop: 92
      })
    ).toBe(-48);

    expect(
      calculateTargetRowScrollAdjustment({
        rowTop: 44,
        rowBottom: 84,
        containerHeight: 200,
        topObstruction: 24
      })
    ).toBe(-48);

    expect(
      calculateTargetRowScrollAdjustment({
        rowTop: 160,
        rowBottom: 228,
        containerHeight: 200,
        topObstruction: 24
      })
    ).toBe(82);
  });

  it("calculates spacer and sticky obstruction helpers", () => {
    expect(
      calculateRequiredBottomSpacer({
        desiredScrollTop: 260,
        maxScrollTop: 220
      })
    ).toBe(40);

    expect(
      canReleaseBottomSpacer({
        currentScrollTop: 120,
        maxScrollTop: 200,
        bottomSpacerHeight: 60
      })
    ).toBe(true);

    expect(
      calculateStickyHeaderObstruction({
        windowHeaderHeight: 40,
        groupHeaderHeight: 28,
        groupHeaderOverlap: 6
      })
    ).toBe(62);
  });

  it("compares RowShell props without native drag handler props", () => {
    const base = makeRowShellProps({
      onPointerDown: () => undefined,
      onPointerEnter: () => undefined,
      onPointerMove: () => undefined,
      onPointerUp: () => undefined,
      onPointerCancel: () => undefined
    });

    expect(
      areRowShellPropsEqual(
        base,
        makeRowShellProps({
          ...base,
          onPointerMove: () => undefined
        })
      )
    ).toBe(false);
  });

  it("compares RowShell props only by display-relevant values", () => {
    const base = makeRowShellProps();
    expect(areRowShellPropsEqual(base, makeRowShellProps({ ...base }))).toBe(true);
    expect(areRowShellPropsEqual(base, makeRowShellProps({ ...base, isSelected: true }))).toBe(false);
    expect(areRowShellPropsEqual(base, makeRowShellProps({ ...base, groupedTabColor: "blue" }))).toBe(false);
    expect(areRowShellPropsEqual(base, makeRowShellProps({ ...base, visuallyExpanded: true }))).toBe(false);
    expect(areRowShellPropsEqual(base, makeRowShellProps({ ...base, dropIndicator: "before" }))).toBe(false);
    expect(areRowShellPropsEqual(base, makeRowShellProps({ ...base, row: makeTabRow({ tab: makeTab({ id: 9, index: 4 }) }) }))).toBe(false);
  });

  it("compares RowShell props with hovered tab callback changes", () => {
    const base = makeRowShellProps({
      onHoveredTabChange: () => undefined
    });

    expect(
      areRowShellPropsEqual(
        base,
        makeRowShellProps({
          ...base,
          onHoveredTabChange: () => undefined
        })
      )
    ).toBe(false);
  });
  it("renders grouped tab color passthrough in tab output", () => {
    const markup = renderRowShellMarkup({
      row: makeTabRow({ tab: makeTab({ id: 91, windowId: 1, index: 0, groupId: 9 }) }),
      groupedTabColor: "blue"
    });

    expect(markup).toContain("tab-row--grouped-blue");
    expect(markup).toContain('aria-level="3"');
  });

  it("renders visually expanded passthrough for collapsed window and group output", () => {
    const windowMarkup = renderRowShellMarkup({
      row: makeWindowRow({ windowId: 1, collapsed: true, totalCount: 2 }),
      visuallyExpanded: true
    });
    const groupMarkup = renderRowShellMarkup({
      row: makeGroupRow({ windowId: 1, groupId: 9, collapsed: true, tabIds: [91], totalCount: 1, firstTabIndex: 0 }),
      visuallyExpanded: true
    });

    expect(windowMarkup).toContain("window-row--visually-expanded");
    expect(windowMarkup).toContain('aria-expanded="true"');
    expect(windowMarkup).toContain("▾");
    expect(groupMarkup).toContain("group-row--visually-expanded");
    expect(groupMarkup).toContain('aria-expanded="true"');
    expect(groupMarkup).toContain("▾");
  });

  it("builds window render sections with grouped child rows", () => {
    const rows: PanelRow[] = [
      makeWindowRow({ windowId: 1, totalCount: 3 }),
      makeGroupRow({ windowId: 1, groupId: 9, tabIds: [91, 92], totalCount: 2, firstTabIndex: 0 }),
      makeTabRow({ tab: makeTab({ id: 91, windowId: 1, index: 0, groupId: 9 }) }),
      makeTabRow({ tab: makeTab({ id: 92, windowId: 1, index: 1, groupId: 9 }) }),
      makeTabRow({ tab: makeTab({ id: 93, windowId: 1, index: 2 }) }),
      makeWindowRow({ windowId: 2, totalCount: 1 }),
      makeTabRow({ tab: makeTab({ id: 201, windowId: 2, index: 0 }) })
    ];

    expect(buildWindowRenderSections(rows)).toEqual([
      {
        windowRow: rows[0],
        items: [
          {
            kind: "group-block",
            groupRow: rows[1],
            childRows: [rows[2], rows[3]]
          },
          {
            kind: "single",
            row: rows[4]
          }
        ]
      },
      {
        windowRow: rows[5],
        items: [
          {
            kind: "single",
            row: rows[6]
          }
        ]
      }
    ]);
  });

  it("builds render sections from rows even when a window or group row is marked collapsed", () => {
    const rows: PanelRow[] = [
      makeWindowRow({ windowId: 1, collapsed: true, totalCount: 2 }),
      makeGroupRow({ windowId: 1, groupId: 9, collapsed: true, tabIds: [91], totalCount: 1, firstTabIndex: 0 }),
      makeTabRow({ tab: makeTab({ id: 91, windowId: 1, index: 0, groupId: 9 }) }),
      makeTabRow({ tab: makeTab({ id: 92, windowId: 1, index: 1 }) })
    ];

    expect(buildWindowRenderSections(rows)).toEqual([
      {
        windowRow: rows[0],
        items: [
          {
            kind: "group-block",
            groupRow: rows[1],
            childRows: [rows[2]]
          },
          {
            kind: "single",
            row: rows[3]
          }
        ]
      }
    ]);
  });

  it("treats search matches like selected rows for visual class generation", () => {
    expect(
      getTabRowClassName({
        isCurrentActive: false,
        isWindowActive: false,
        isGrouped: false,
        isSelected: false,
        matchesSearch: true
      })
    ).toContain("tab-row--selected");
  });


  it("pulses a locate row only after the requested row is rendered", () => {
    expect(
      shouldPulseLocateRow({
        locateRequest: {
          rowKey: "tab-2",
          requestId: 1
        },
        hasRenderedTargetRow: true
      })
    ).toBe(true);

    expect(
      shouldPulseLocateRow({
        locateRequest: {
          rowKey: "tab-2",
          requestId: 1
        },
        hasRenderedTargetRow: false
      })
    ).toBe(false);
  });

  it("handles a locate request only once per request id", () => {
    expect(
      shouldHandleLocateRequest({
        locateRequest: {
          rowKey: "tab-2",
          requestId: 1
        },
        hasRenderedTargetRow: true,
        previousHandledRequestId: null
      })
    ).toBe(true);

    expect(
      shouldHandleLocateRequest({
        locateRequest: {
          rowKey: "tab-2",
          requestId: 1
        },
        hasRenderedTargetRow: true,
        previousHandledRequestId: 1
      })
    ).toBe(false);

    expect(
      shouldHandleLocateRequest({
        locateRequest: {
          rowKey: "tab-2",
          requestId: 2
        },
        hasRenderedTargetRow: false,
        previousHandledRequestId: 1
      })
    ).toBe(false);
  });

});

describe("listDrag helpers", () => {
  it("creates drag sources for group and unpinned tab rows", () => {
    expect(createDragSource(makeWindowRow())).toBeNull();
    expect(createDragSource(makeTabRow({ tab: makeTab({ pinned: true }) }))).toBeNull();

    expect(createDragSource(makeGroupRow({ groupId: 5, tabIds: [1, 2] }))).toEqual({
      kind: "group",
      rowKey: "group-5",
      groupId: 5,
      windowId: 1,
      tabIds: [1, 2],
      firstTabIndex: 0,
      title: "Group 5",
      color: "blue",
      collapsed: false
    });

    expect(createDragSource(makeTabRow({ tab: makeTab({ id: 7, index: 3, groupId: 12 }) }))).toEqual({
      kind: "tab",
      rowKey: "tab-7",
      tabId: 7,
      windowId: 1,
      index: 3,
      groupId: 12
    });
  });

  it("creates multi-tab drag sources only for multi-selection without pinned tabs", () => {
    const rows: PanelRow[] = [
      makeTabRow({ tab: makeTab({ id: 1, index: 0 }) }),
      makeTabRow({ tab: makeTab({ id: 2, index: 1 }) }),
      makeTabRow({ tab: makeTab({ id: 3, index: 2, pinned: true }) })
    ];

    expect(
      createSelectedTabsDragSource({
        row: rows[0],
        rows,
        selectedTabIds: new Set([1])
      })
    ).toBeNull();

    expect(
      createSelectedTabsDragSource({
        row: rows[0],
        rows,
        selectedTabIds: new Set([1, 3])
      })
    ).toBeNull();

    expect(
      createSelectedTabsDragSource({
        row: rows[1],
        rows,
        selectedTabIds: new Set([1, 2])
      })
    ).toEqual({
      kind: "tabs",
      rowKey: "tab-2",
      tabIds: [1, 2],
      tabs: [
        { tabId: 1, windowId: 1, index: 0, groupId: null },
        { tabId: 2, windowId: 1, index: 1, groupId: null }
      ]
    });
  });

  it("resolves drop targets for windows, groups, and tabs", () => {
    const tabSource = createDragSource(makeTabRow({ tab: makeTab({ id: 8, index: 2 }) }));
    if (!tabSource) {
      throw new Error("expected tabSource");
    }

    expect(
      resolveDropTarget({
        source: tabSource,
        targetRow: makeWindowRow({ windowId: 2, totalCount: 5, firstUnpinnedTabIndex: 1 }),
        pointerRatio: 0.2
      })
    ).toEqual({
      rowKey: "window-2",
      targetWindowId: 2,
      targetIndex: 1,
      targetGroupId: null,
      indicator: "window-start"
    });

    expect(
      resolveDropTarget({
        source: tabSource,
        targetRow: makeGroupRow({ groupId: 11, windowId: 1, firstTabIndex: 4, tabIds: [21, 22] }),
        pointerRatio: 0.5
      })
    ).toEqual({
      rowKey: "group-11",
      targetWindowId: 1,
      targetIndex: 4,
      targetGroupId: 11,
      indicator: "into-group"
    });

    expect(
      resolveDropTarget({
        source: tabSource,
        targetRow: makeTabRow({ tab: makeTab({ id: 30, index: 6, groupId: 15 }) }),
        pointerRatio: 0.9
      })
    ).toEqual({
      rowKey: "tab-30",
      targetWindowId: 1,
      targetIndex: 7,
      targetGroupId: 15,
      indicator: "after"
    });
  });

  it("prevents invalid drop targets for self-selection and same group", () => {
    expect(
      resolveDropTarget({
        source: {
          kind: "tabs",
          rowKey: "tab-1",
          tabIds: [1, 2],
          tabs: [
            { tabId: 1, windowId: 1, index: 0, groupId: null },
            { tabId: 2, windowId: 1, index: 1, groupId: null }
          ]
        },
        targetRow: makeTabRow({ tab: makeTab({ id: 2, index: 1 }) }),
        pointerRatio: 0.5
      })
    ).toBeNull();

    expect(
      resolveDropTarget({
        source: {
          kind: "group",
          rowKey: "group-5",
          groupId: 5,
          windowId: 1,
          tabIds: [11, 12],
          firstTabIndex: 3,
          title: "G5",
          color: "blue",
          collapsed: false
        },
        targetRow: makeTabRow({ tab: makeTab({ id: 12, index: 4, groupId: 5 }) }),
        pointerRatio: 0.5
      })
    ).toEqual({
      rowKey: "group-5",
      targetWindowId: 1,
      targetIndex: 5,
      targetGroupId: null,
      indicator: "after"
    });
  });

  it("builds drag commands and normalizes intra-window indices", () => {
    expect(
      buildDragCommand({
        source: {
          kind: "tab",
          rowKey: "tab-1",
          tabId: 1,
          windowId: 1,
          index: 2,
          groupId: null
        },
        target: {
          rowKey: "tab-9",
          targetWindowId: 1,
          targetIndex: 5,
          targetGroupId: null,
          indicator: "after"
        }
      })
    ).toEqual({
      type: "tab/move",
      tabId: 1,
      targetWindowId: 1,
      targetIndex: 4,
      targetGroupId: null
    });

    expect(
      buildDragCommand({
        source: {
          kind: "tab",
          rowKey: "tab-1",
          tabId: 1,
          windowId: 1,
          index: 2,
          groupId: null
        },
        target: {
          rowKey: "tab-2",
          targetWindowId: 1,
          targetIndex: 2,
          targetGroupId: null,
          indicator: "before"
        }
      })
    ).toBeNull();
  });

  it("keeps raw targetIndex for multi-tab commands so backend owns normalization", () => {
    expect(
      buildDragCommand({
        source: {
          kind: "tabs",
          rowKey: "tab-2",
          tabIds: [1, 2],
          tabs: [
            { tabId: 1, windowId: 1, index: 0, groupId: null },
            { tabId: 2, windowId: 1, index: 1, groupId: null }
          ]
        },
        target: {
          rowKey: "tab-8",
          targetWindowId: 1,
          targetIndex: 4,
          targetGroupId: null,
          indicator: "before"
        }
      })
    ).toEqual({
      type: "tabs/move",
      tabIds: [1, 2],
      targetWindowId: 1,
      targetIndex: 4,
      targetGroupId: null
    });
  });

  it("builds group move commands without changing cross-window targetIndex", () => {
    expect(
      buildDragCommand({
        source: {
          kind: "tabs",
          rowKey: "tab-2",
          tabIds: [1, 2],
          tabs: [
            { tabId: 1, windowId: 1, index: 0, groupId: null },
            { tabId: 2, windowId: 1, index: 1, groupId: null }
          ]
        },
        target: {
          rowKey: "tab-8",
          targetWindowId: 1,
          targetIndex: 4,
          targetGroupId: null,
          indicator: "before"
        }
      })
    ).toEqual({
      type: "tabs/move",
      tabIds: [1, 2],
      targetWindowId: 1,
      targetIndex: 4,
      targetGroupId: null
    });

    expect(
      buildDragCommand({
        source: {
          kind: "group",
          rowKey: "group-7",
          groupId: 7,
          windowId: 1,
          tabIds: [20, 21],
          firstTabIndex: 3,
          title: "Group 7",
          color: "purple",
          collapsed: true
        },
        target: {
          rowKey: "window-2",
          targetWindowId: 2,
          targetIndex: 1,
          targetGroupId: null,
          indicator: "window-start"
        }
      })
    ).toEqual({
      type: "group/move",
      groupId: 7,
      tabIds: [20, 21],
      targetWindowId: 2,
      targetIndex: 1,
      title: "Group 7",
      color: "purple",
      collapsed: true
    });
  });

  it("returns explicit pointercancel results only for the matching pointer id", () => {
    const source = createDragSource(makeTabRow({ tab: makeTab({ id: 1, index: 0 }) }));
    if (!source) {
      throw new Error("expected source");
    }

    const draggingSession = {
      phase: "dragging" as const,
      pointerId: 11,
      origin: { x: 10, y: 10 },
      source,
      pointer: { x: 18, y: 82 },
      target: {
        rowKey: "tab-2",
        targetWindowId: 1,
        targetIndex: 3,
        targetGroupId: null,
        indicator: "after" as const
      }
    };

    expect(
      resolvePointerCancelResult({
        session: draggingSession,
        pointerId: 11
      })
    ).toEqual({
      nextSession: { phase: "idle" },
      wasCancelled: true
    });

    expect(
      resolvePointerCancelResult({
        session: draggingSession,
        pointerId: 99
      })
    ).toEqual({
      nextSession: draggingSession,
      wasCancelled: false
    });
  });

  it("derives pointerup state reset and optional command without side effects", () => {
    const source = createDragSource(makeTabRow({ tab: makeTab({ id: 1, index: 0 }) }));
    if (!source) {
      throw new Error("expected source");
    }

    const draggingSession = {
      phase: "dragging" as const,
      pointerId: 11,
      origin: { x: 10, y: 10 },
      source,
      pointer: { x: 18, y: 82 },
      target: {
        rowKey: "tab-2",
        targetWindowId: 1,
        targetIndex: 3,
        targetGroupId: null,
        indicator: "after" as const
      }
    };

    expect(
      resolvePointerUpResult({
        session: draggingSession,
        releasedWithinContainer: true,
        pointerId: 11
      })
    ).toEqual({
      nextSession: { phase: "idle" },
      shouldSuppressPostDragClick: true,
      command: {
        type: "tab/move",
        tabId: 1,
        targetWindowId: 1,
        targetIndex: 2,
        targetGroupId: null
      }
    });

    expect(
      resolvePointerUpResult({
        session: draggingSession,
        releasedWithinContainer: false,
        pointerId: 11
      })
    ).toEqual({
      nextSession: { phase: "idle" },
      shouldSuppressPostDragClick: true,
      command: null
    });

    expect(
      resolvePointerUpResult({
        session: { phase: "pressing", pointerId: 11, origin: { x: 10, y: 10 }, source },
        releasedWithinContainer: true,
        pointerId: 11
      })
    ).toEqual({
      nextSession: { phase: "idle" },
      shouldSuppressPostDragClick: false,
      command: null
    });

    expect(
      resolvePointerUpResult({
        session: draggingSession,
        releasedWithinContainer: true,
        pointerId: 99
      })
    ).toEqual({
      nextSession: draggingSession,
      shouldSuppressPostDragClick: false,
      command: null
    });
  });

  it("derives auto-scroll tick transitions without mutating component state", () => {
    const source = createDragSource(makeTabRow({ tab: makeTab({ id: 1, index: 0 }) }));
    if (!source) {
      throw new Error("expected source");
    }

    const draggingSession = {
      phase: "dragging" as const,
      pointerId: 11,
      origin: { x: 10, y: 10 },
      source,
      pointer: { x: 24, y: 186 },
      target: null
    };
    const nextTarget = {
      rowKey: "tab-3",
      targetWindowId: 1,
      targetIndex: 4,
      targetGroupId: null,
      indicator: "after" as const
    };

    expect(
      resolvePointerDragAutoScrollTickResult({
        session: draggingSession,
        nextScrollTop: 124,
        shouldScheduleNextFrame: true,
        nextTarget
      })
    ).toEqual({
      nextSession: {
        ...draggingSession,
        target: nextTarget
      },
      nextScrollTop: 124,
      shouldApplyScroll: true,
      shouldScheduleNextFrame: true
    });

    expect(
      resolvePointerDragAutoScrollTickResult({
        session: draggingSession,
        nextScrollTop: 124,
        shouldScheduleNextFrame: false,
        nextTarget
      })
    ).toEqual({
      nextSession: draggingSession,
      nextScrollTop: 124,
      shouldApplyScroll: false,
      shouldScheduleNextFrame: false
    });

    expect(
      resolvePointerDragAutoScrollTickResult({
        session: { phase: "idle" },
        nextScrollTop: 124,
        shouldScheduleNextFrame: true,
        nextTarget
      })
    ).toEqual({
      nextSession: { phase: "idle" },
      nextScrollTop: 124,
      shouldApplyScroll: false,
      shouldScheduleNextFrame: false
    });
  });

  it("submits exactly one move command or one explicit cancellation on pointerup", () => {
    expect(
      resolvePointerDropOutcome({
        phase: "dragging",
        target: {
          rowKey: "tab-2",
          targetWindowId: 1,
          targetIndex: 3,
          targetGroupId: null,
          indicator: "after"
        },
        releasedWithinContainer: true
      })
    ).toBe("submit");

    expect(
      resolvePointerDropOutcome({
        phase: "dragging",
        target: null,
        releasedWithinContainer: true
      })
    ).toBe("cancel");
  });

  it("cancels pointerup outside the list container even when a last target exists", () => {
    expect(
      resolvePointerDropOutcome({
        phase: "dragging",
        target: {
          rowKey: "tab-2",
          targetWindowId: 1,
          targetIndex: 3,
          targetGroupId: null,
          indicator: "after"
        },
        releasedWithinContainer: false
      })
    ).toBe("cancel");
  });

  it("suppresses post-drag click activation only after a threshold-crossed drag", () => {
    expect(shouldSuppressPostDragClick({ phase: "pressing" })).toBe(false);
    expect(shouldSuppressPostDragClick({ phase: "dragging" })).toBe(true);
    expect(shouldSuppressPostDragClick({ phase: "idle" })).toBe(false);
  });

  it("starts suppressing post-drag click only after the drag threshold is crossed", () => {
    const origin = { x: 10, y: 10 };

    expect(
      shouldSuppressPostDragClick({
        phase: resolvePointerDragPhase({
          origin,
          pointer: { x: 12, y: 13 },
          threshold: 6
        })
      })
    ).toBe(false);

    expect(
      shouldSuppressPostDragClick({
        phase: resolvePointerDragPhase({
          origin,
          pointer: { x: 18, y: 18 },
          threshold: 6
        })
      })
    ).toBe(true);
  });

  it("treats pointer release beyond container bounds as outside the list", () => {
    const containerRect = {
      left: 10,
      right: 210,
      top: 20,
      bottom: 120
    };

    expect(
      isPointerWithinContainerBounds({
        pointer: { x: 50, y: 60 },
        containerRect
      })
    ).toBe(true);

    expect(
      isPointerWithinContainerBounds({
        pointer: { x: 211, y: 60 },
        containerRect
      })
    ).toBe(false);

    expect(
      isPointerWithinContainerBounds({
        pointer: { x: 50, y: 121 },
        containerRect
      })
    ).toBe(false);
  });

  it("only submits when both target exists and release stays within container bounds", () => {
    const target = {
      rowKey: "tab-2",
      targetWindowId: 1,
      targetIndex: 3,
      targetGroupId: null,
      indicator: "after" as const
    };

    expect(
      resolvePointerDropOutcome({
        phase: "dragging",
        target,
        releasedWithinContainer: true
      })
    ).toBe("submit");

    expect(
      resolvePointerDropOutcome({
        phase: "dragging",
        target,
        releasedWithinContainer: false
      })
    ).toBe("cancel");
  });

  it("clamps pointer ratio for window and tab drop targets", () => {
    const tabSource = createDragSource(makeTabRow({ tab: makeTab({ id: 42, index: 2 }) }));
    if (!tabSource) {
      throw new Error("expected tabSource");
    }

    expect(
      resolveDropTarget({
        source: tabSource,
        targetRow: makeWindowRow({ windowId: 3, totalCount: 6, firstUnpinnedTabIndex: 2 }),
        pointerRatio: Number.NaN
      })
    ).toEqual({
      rowKey: "window-3",
      targetWindowId: 3,
      targetIndex: 6,
      targetGroupId: null,
      indicator: "window-end"
    });

    expect(
      resolveDropTarget({
        source: tabSource,
        targetRow: makeTabRow({ tab: makeTab({ id: 50, index: 5 }) }),
        pointerRatio: -1
      })
    ).toEqual({
      rowKey: "tab-50",
      targetWindowId: 1,
      targetIndex: 5,
      targetGroupId: null,
      indicator: "before"
    });
  });

  it("reuses the last resolved drop target when drop lands on a gap", () => {
    const source = createDragSource(makeTabRow({ tab: makeTab({ id: 1, index: 0 }) }));
    if (!source) {
      throw new Error("expected source");
    }

    const lastTarget = resolveDropTarget({
      source,
      targetRow: makeTabRow({ tab: makeTab({ id: 2, index: 3 }) }),
      pointerRatio: 0.9
    });

    if (!lastTarget) {
      throw new Error("expected lastTarget");
    }

    expect(buildFallbackDragCommand({ source, lastTarget })).toEqual({
      type: "tab/move",
      tabId: 1,
      targetWindowId: 1,
      targetIndex: 3,
      targetGroupId: null
    });
  });

  it("collects visible drag rows for geometry hit testing from mounted row refs", () => {
    const firstRect = {
      top: 40,
      bottom: 80,
      left: 0,
      right: 200,
      height: 40,
      width: 200,
      x: 0,
      y: 40,
      toJSON: () => ({})
    } as DOMRect;
    const secondRect = {
      top: 86,
      bottom: 126,
      left: 0,
      right: 200,
      height: 40,
      width: 200,
      x: 0,
      y: 86,
      toJSON: () => ({})
    } as DOMRect;

    const rows = [
      makeTabRow({ tab: makeTab({ id: 2, index: 2, title: "Tab 2" }) }),
      makeTabRow({ tab: makeTab({ id: 3, index: 3, title: "Tab 3" }) }),
      makeWindowRow({ windowId: 9 })
    ];

    const rowRefs = new Map<string, HTMLDivElement>([
      [rows[0].key, { getBoundingClientRect: () => firstRect } as HTMLDivElement],
      [rows[1].key, { getBoundingClientRect: () => secondRect } as HTMLDivElement]
    ]);

    expect(collectVisibleDragRows({ rows, rowRefs })).toEqual([
      {
        row: rows[0],
        rect: firstRect,
        level: 0
      },
      {
        row: rows[1],
        rect: secondRect,
        level: 0
      }
    ]);
  });

  it("wires a threshold-crossed pointer drag target into the rendered drop indicator class", () => {
    const source = createDragSource(makeTabRow({ tab: makeTab({ id: 1, index: 0 }) }));
    if (!source) {
      throw new Error("expected source");
    }

    const pointerPhase = resolvePointerDragPhase({
      origin: { x: 10, y: 10 },
      pointer: { x: 18, y: 82 },
      threshold: 6
    });

    const targetRows = collectVisibleDragRows({
      rows: [
        makeTabRow({ tab: makeTab({ id: 2, index: 2, title: "Tab 2" }) }),
        makeTabRow({ tab: makeTab({ id: 3, index: 3, title: "Tab 3" }) })
      ],
      rowRefs: new Map<string, HTMLDivElement>([
        ["tab-2", {
          getBoundingClientRect: () => ({
            top: 40,
            bottom: 80,
            left: 0,
            right: 200,
            height: 40,
            width: 200,
            x: 0,
            y: 40,
            toJSON: () => ({})
          })
        } as HTMLDivElement],
        ["tab-3", {
          getBoundingClientRect: () => ({
            top: 86,
            bottom: 126,
            left: 0,
            right: 200,
            height: 40,
            width: 200,
            x: 0,
            y: 86,
            toJSON: () => ({})
          })
        } as HTMLDivElement]
      ])
    });

    const target = findClosestDropTarget({
      source,
      pointer: { clientX: 18, clientY: 82 },
      rows: targetRows
    });

    expect(pointerPhase).toBe("dragging");
    expect(target).toEqual({
      rowKey: "tab-2",
      targetWindowId: 1,
      targetIndex: 3,
      targetGroupId: null,
      indicator: "after"
    });

    const targetRow = targetRows.find((candidate) => candidate.row.key === target?.rowKey)?.row;
    expect(targetRow).toBeDefined();

    const markup = renderRowShellMarkup({
      row: targetRow,
      dropIndicator: target?.indicator ?? null
    });

    expect(markup).toContain("stack-list__item--drop-after");
  });

  it("uses computed geometry hit targets instead of native drop fallback state", () => {
    const source = createDragSource(makeTabRow({ tab: makeTab({ id: 1, index: 0 }) }));
    if (!source) {
      throw new Error("expected source");
    }

    const target = findClosestDropTarget({
      source,
      pointer: { clientX: 24, clientY: 83 },
      rows: [
        makeDragHitTestRowFromTab(makeTab({ id: 2, index: 2, title: "Tab 2" }), 40, 80),
        makeDragHitTestRowFromTab(makeTab({ id: 3, index: 3, title: "Tab 3" }), 86, 126)
      ]
    });

    expect(target).not.toBeNull();
    expect(buildDragCommand({ source, target: target! })).toEqual({
      type: "tab/move",
      tabId: 1,
      targetWindowId: 1,
      targetIndex: 2,
      targetGroupId: null
    });
  });

  it("does not create a fallback command when there is no last resolved target", () => {
    const source = createDragSource(makeTabRow({ tab: makeTab({ id: 1, index: 0 }) }));
    if (!source) {
      throw new Error("expected source");
    }

    expect(buildFallbackDragCommand({ source, lastTarget: null })).toBeNull();
  });
});
