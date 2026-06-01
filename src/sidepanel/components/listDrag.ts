import { NO_TAB_GROUP_ID } from "../../shared/defaults";
import type { PanelRow } from "../../shared/types";
import type { DragHitTestRow } from "./dragHitTesting";

export type DragSource =
  | {
      kind: "tab";
      rowKey: string;
      tabId: number;
      windowId: number;
      index: number;
      groupId: number | null;
    }
  | {
      kind: "tabs";
      rowKey: string;
      tabIds: number[];
      tabs: Array<{
        tabId: number;
        windowId: number;
        index: number;
        groupId: number | null;
      }>;
    }
  | {
      kind: "group";
      rowKey: string;
      groupId: number;
      windowId: number;
      tabIds: number[];
      firstTabIndex: number;
      title: string;
      color: chrome.tabGroups.ColorEnum;
      collapsed: boolean;
    };

export interface DropTarget {
  rowKey: string;
  targetWindowId: number;
  targetIndex: number;
  targetGroupId: number | null;
  indicator: "before" | "after" | "into-group" | "window-start" | "window-end";
}

export function createDragSource(row: PanelRow): DragSource | null {
  if (row.kind === "window") {
    return null;
  }

  if (row.kind === "group") {
    return {
      kind: "group",
      rowKey: row.key,
      groupId: row.groupId,
      windowId: row.windowId,
      tabIds: [...row.tabIds],
      firstTabIndex: row.firstTabIndex,
      title: row.title,
      color: row.color,
      collapsed: row.collapsed
    };
  }

  if (row.tab.pinned) {
    return null;
  }

  return {
    kind: "tab",
    rowKey: row.key,
    tabId: row.tab.id,
    windowId: row.windowId,
    index: row.tab.index,
    groupId: normalizeGroupId(row.tab.groupId)
  };
}

export function createSelectedTabsDragSource(params: {
  row: PanelRow;
  rows: readonly PanelRow[];
  selectedTabIds: ReadonlySet<number>;
}): DragSource | null {
  const { row, rows, selectedTabIds } = params;

  if (row.kind !== "tab" || !selectedTabIds.has(row.tab.id)) {
    return null;
  }

  const selectedTabs = rows.flatMap((candidateRow) => {
    if (candidateRow.kind !== "tab" || !selectedTabIds.has(candidateRow.tab.id)) {
      return [];
    }

    return [
      {
        tabId: candidateRow.tab.id,
        windowId: candidateRow.windowId,
        index: candidateRow.tab.index,
        groupId: normalizeGroupId(candidateRow.tab.groupId),
        pinned: candidateRow.tab.pinned
      }
    ];
  });

  if (selectedTabs.length <= 1) {
    return null;
  }

  if (selectedTabs.some((tab) => tab.pinned)) {
    return null;
  }

  return {
    kind: "tabs",
    rowKey: row.key,
    tabIds: selectedTabs.map((tab) => tab.tabId),
    tabs: selectedTabs.map(({ pinned: _pinned, ...tab }) => tab)
  };
}

export function resolveDropTarget(params: {
  source: DragSource;
  targetRow: PanelRow;
  pointerRatio: number;
}): DropTarget | null {
  const { source, targetRow } = params;
  const pointerRatio = clampPointerRatio(params.pointerRatio);

  if (targetRow.kind === "window") {
    return {
      rowKey: targetRow.key,
      targetWindowId: targetRow.windowId,
      targetIndex: pointerRatio < 0.5 ? targetRow.firstUnpinnedTabIndex : targetRow.totalCount,
      targetGroupId: null,
      indicator: pointerRatio < 0.5 ? "window-start" : "window-end"
    };
  }

  if (targetRow.kind === "group") {
    if (source.kind === "tab" || source.kind === "tabs") {
      return {
        rowKey: targetRow.key,
        targetWindowId: targetRow.windowId,
        targetIndex: targetRow.firstTabIndex,
        targetGroupId: targetRow.groupId,
        indicator: "into-group"
      };
    }

    return {
      rowKey: targetRow.key,
      targetWindowId: targetRow.windowId,
      targetIndex:
        pointerRatio < 0.5 ? targetRow.firstTabIndex : targetRow.firstTabIndex + targetRow.tabIds.length,
      targetGroupId: null,
      indicator: pointerRatio < 0.5 ? "before" : "after"
    };
  }

  if (source.kind === "tabs" && source.tabIds.includes(targetRow.tab.id)) {
    return null;
  }

  if (source.kind === "group" && normalizeGroupId(targetRow.tab.groupId) === source.groupId) {
    return {
      rowKey: source.rowKey,
      targetWindowId: source.windowId,
      targetIndex:
        pointerRatio < 0.5
          ? source.firstTabIndex
          : source.firstTabIndex + source.tabIds.length,
      targetGroupId: null,
      indicator: pointerRatio < 0.5 ? "before" : "after"
    };
  }

  return {
    rowKey: targetRow.key,
    targetWindowId: targetRow.windowId,
    targetIndex: pointerRatio < 0.5 ? targetRow.tab.index : targetRow.tab.index + 1,
    targetGroupId: normalizeGroupId(targetRow.tab.groupId),
    indicator: pointerRatio < 0.5 ? "before" : "after"
  };
}

export function buildDragCommand(params: {
  source: DragSource;
  target: DropTarget;
}):
  | {
      type: "tab/move";
      tabId: number;
      targetWindowId: number;
      targetIndex: number;
      targetGroupId: number | null;
    }
  | {
      type: "tabs/move";
      tabIds: number[];
      targetWindowId: number;
      targetIndex: number;
      targetGroupId: number | null;
    }
  | {
      type: "group/move";
      groupId: number;
      tabIds: number[];
      targetWindowId: number;
      targetIndex: number;
      title: string;
      color: chrome.tabGroups.ColorEnum;
      collapsed: boolean;
    }
  | null {
  const { source, target } = params;

  if (source.kind === "tab") {
    const targetIndex = normalizeTargetIndex({
      sourceWindowId: source.windowId,
      sourceIndex: source.index,
      targetWindowId: target.targetWindowId,
      targetIndex: target.targetIndex
    });

    if (
      source.windowId === target.targetWindowId &&
      source.index === targetIndex &&
      source.groupId === target.targetGroupId
    ) {
      return null;
    }

    return {
      type: "tab/move",
      tabId: source.tabId,
      targetWindowId: target.targetWindowId,
      targetIndex,
      targetGroupId: target.targetGroupId
    };
  }

  if (source.kind === "tabs") {
    return {
      type: "tabs/move",
      tabIds: [...source.tabIds],
      targetWindowId: target.targetWindowId,
      targetIndex: target.targetIndex,
      targetGroupId: target.targetGroupId
    };
  }

  const targetIndex = normalizeGroupTargetIndex({
    sourceWindowId: source.windowId,
    sourceFirstTabIndex: source.firstTabIndex,
    sourceTabCount: source.tabIds.length,
    targetWindowId: target.targetWindowId,
    targetIndex: target.targetIndex
  });

  if (source.windowId === target.targetWindowId && source.firstTabIndex === targetIndex) {
    return null;
  }

  return {
    type: "group/move",
    groupId: source.groupId,
    tabIds: [...source.tabIds],
    targetWindowId: target.targetWindowId,
    targetIndex,
    title: source.title,
    color: source.color,
    collapsed: source.collapsed
  };
}

export function buildFallbackDragCommand(params: {
  source: DragSource;
  lastTarget: DropTarget | null;
}):
  | {
      type: "tab/move";
      tabId: number;
      targetWindowId: number;
      targetIndex: number;
      targetGroupId: number | null;
    }
  | {
      type: "tabs/move";
      tabIds: number[];
      targetWindowId: number;
      targetIndex: number;
      targetGroupId: number | null;
    }
  | {
      type: "group/move";
      groupId: number;
      tabIds: number[];
      targetWindowId: number;
      targetIndex: number;
      title: string;
      color: chrome.tabGroups.ColorEnum;
      collapsed: boolean;
    }
  | null {
  const { source, lastTarget } = params;
  return lastTarget == null ? null : buildDragCommand({ source, target: lastTarget });
}

export function normalizeGroupId(groupId: number): number | null {
  return groupId === NO_TAB_GROUP_ID ? null : groupId;
}

function clampPointerRatio(pointerRatio: number): number {
  if (Number.isNaN(pointerRatio)) {
    return 0.5;
  }

  return Math.max(0, Math.min(pointerRatio, 1));
}

function normalizeTargetIndex(params: {
  sourceWindowId: number;
  sourceIndex: number;
  targetWindowId: number;
  targetIndex: number;
}): number {
  const { sourceWindowId, sourceIndex, targetWindowId, targetIndex } = params;

  if (sourceWindowId !== targetWindowId || targetIndex <= sourceIndex) {
    return targetIndex;
  }

  const adjusted = Math.max(0, targetIndex - 1);
  return adjusted === sourceIndex ? sourceIndex + 1 : adjusted;
}

function normalizeGroupTargetIndex(params: {
  sourceWindowId: number;
  sourceFirstTabIndex: number;
  sourceTabCount: number;
  targetWindowId: number;
  targetIndex: number;
}): number {
  const { sourceWindowId, sourceFirstTabIndex, sourceTabCount, targetWindowId, targetIndex } = params;

  // 同窗口内且目标位置在源位置之后时，需要减去源组占用的 tab 数量
  if (sourceWindowId === targetWindowId && targetIndex > sourceFirstTabIndex) {
    return Math.max(0, targetIndex - sourceTabCount);
  }

  return Math.max(0, targetIndex);
}

// ── Pointer drag types ──────────────────────────────────────────────

export type PointerPosition = {
  x: number;
  y: number;
};

export type PointerDragSession =
  | { phase: "idle" }
  | {
      phase: "pressing";
      pointerId: number;
      origin: PointerPosition;
      source: DragSource;
    }
  | {
      phase: "dragging";
      pointerId: number;
      origin: PointerPosition;
      source: DragSource;
      pointer: PointerPosition;
      target: DropTarget | null;
    };

// ── Pointer drag session helpers ────────────────────────────────────

export function resolvePointerDragPhase(params: {
  origin: PointerPosition;
  pointer: PointerPosition;
  threshold: number;
}): "pressing" | "dragging" {
  const deltaX = params.pointer.x - params.origin.x;
  const deltaY = params.pointer.y - params.origin.y;
  return Math.hypot(deltaX, deltaY) >= params.threshold ? "dragging" : "pressing";
}

export function shouldClearPointerDragSession(
  session: PointerDragSession,
  pointerId: number
): boolean {
  return session.phase !== "idle" && session.pointerId === pointerId;
}

export function resolvePointerCancelResult(params: {
  session: PointerDragSession;
  pointerId: number;
}): {
  nextSession: PointerDragSession;
  wasCancelled: boolean;
} {
  return shouldClearPointerDragSession(params.session, params.pointerId)
    ? {
        nextSession: { phase: "idle" },
        wasCancelled: true
      }
    : {
        nextSession: params.session,
        wasCancelled: false
      };
}

export function resolvePointerDragAutoScrollLoopState(params: {
  isDragging: boolean;
  hasScheduledFrame: boolean;
  delta: number;
  didScroll: boolean;
}): {
  shouldScheduleFromPointerMove: boolean;
  shouldScheduleNextFrame: boolean;
} {
  const shouldAutoScroll = params.isDragging && params.delta !== 0 && params.didScroll;
  return {
    shouldScheduleFromPointerMove: shouldAutoScroll && !params.hasScheduledFrame,
    shouldScheduleNextFrame: shouldAutoScroll
  };
}

export function resolvePointerDropOutcome(session: {
  phase: PointerDragSession["phase"];
  target?: DropTarget | null;
  releasedWithinContainer?: boolean;
}): "submit" | "cancel" {
  return session.phase === "dragging"
    && session.releasedWithinContainer !== false
    && session.target != null
    ? "submit"
    : "cancel";
}

export function resolveDraggedRowKey(session: {
  phase: PointerDragSession["phase"];
  sourceRowKey?: string;
}): string | null {
  return session.phase === "dragging" ? session.sourceRowKey ?? null : null;
}

export function resolveRenderedDropIndicator(params: {
  rowKey: string;
  target: DropTarget | null;
}): DropTarget["indicator"] | null {
  return params.target?.rowKey === params.rowKey ? params.target.indicator : null;
}

export function resolvePointerUpResult(params: {
  session: PointerDragSession;
  releasedWithinContainer: boolean;
  pointerId: number;
}): {
  nextSession: PointerDragSession;
  shouldSuppressPostDragClick: boolean;
  command:
    | ReturnType<typeof buildDragCommand>
    | null;
} {
  const { session, releasedWithinContainer, pointerId } = params;

  if (!shouldClearPointerDragSession(session, pointerId)) {
    return {
      nextSession: session,
      shouldSuppressPostDragClick: false,
      command: null
    };
  }

  const shouldSubmit = session.phase === "dragging"
    && resolvePointerDropOutcome({
      phase: session.phase,
      target: session.target,
      releasedWithinContainer
    }) === "submit";

  return {
    nextSession: { phase: "idle" },
    shouldSuppressPostDragClick: shouldSuppressPostDragClick(session),
    command: shouldSubmit && session.target != null
      ? buildDragCommand({
          source: session.source,
          target: session.target
        })
      : null
  };
}

export function resolvePointerDragAutoScrollTickResult(params: {
  session: PointerDragSession;
  nextScrollTop: number;
  shouldScheduleNextFrame: boolean;
  nextTarget: DropTarget | null;
}): {
  nextSession: PointerDragSession;
  nextScrollTop: number;
  shouldApplyScroll: boolean;
  shouldScheduleNextFrame: boolean;
} {
  if (params.session.phase !== "dragging" || !params.shouldScheduleNextFrame) {
    return {
      nextSession: params.session,
      nextScrollTop: params.nextScrollTop,
      shouldApplyScroll: false,
      shouldScheduleNextFrame: false
    };
  }

  return {
    nextSession: {
      ...params.session,
      target: params.nextTarget
    },
    nextScrollTop: params.nextScrollTop,
    shouldApplyScroll: true,
    shouldScheduleNextFrame: true
  };
}

export function shouldSuppressPostDragClick(session: {
  phase: PointerDragSession["phase"];
}): boolean {
  return session.phase === "dragging";
}

export function isPointerWithinContainerBounds(params: {
  pointer: PointerPosition;
  containerRect: Pick<DOMRect, "left" | "right" | "top" | "bottom">;
}): boolean {
  const { pointer, containerRect } = params;
  return pointer.x >= containerRect.left
    && pointer.x <= containerRect.right
    && pointer.y >= containerRect.top
    && pointer.y <= containerRect.bottom;
}

export function collectVisibleDragRows(params: {
  rows: readonly PanelRow[];
  rowRefs: ReadonlyMap<string, HTMLDivElement>;
}): DragHitTestRow[] {
  return params.rows.flatMap((row) => {
    const node = params.rowRefs.get(row.key);
    return node == null
      ? []
      : [{
          row,
          rect: node.getBoundingClientRect(),
          level: 0
        }];
  });
}

// ── Selection gesture and drag source helpers ───────────────────────

export function shouldHandleSelectionGestureOnPointerDown(params: {
  row: PanelRow;
  pointerGesture: {
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  };
}): boolean {
  const { row, pointerGesture } = params;

  return row.kind === "tab" && (pointerGesture.ctrlKey || pointerGesture.metaKey || pointerGesture.shiftKey);
}

export function shouldClearSelectionOnPointerDown(params: {
  row: PanelRow;
  selectedTabIds: ReadonlySet<number>;
  pointerGesture: {
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  };
}): boolean {
  const { row, selectedTabIds, pointerGesture } = params;

  if (pointerGesture.ctrlKey || pointerGesture.metaKey || pointerGesture.shiftKey) {
    return false;
  }

  return row.kind === "tab" && !selectedTabIds.has(row.tab.id) && selectedTabIds.size > 0;
}

export function createPointerDragSource(params: {
  row: PanelRow;
  rows: PanelRow[];
  selectedTabIds: ReadonlySet<number>;
  pointerGesture: {
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  };
}): DragSource | null {
  const { row, rows, selectedTabIds, pointerGesture } = params;

  if (pointerGesture.ctrlKey || pointerGesture.metaKey || pointerGesture.shiftKey) {
    return null;
  }

  const selectedTabsSource =
    row.kind === "tab" && selectedTabIds.has(row.tab.id)
      ? createSelectedTabsDragSource({
          row,
          rows,
          selectedTabIds
        })
      : null;

  if (row.kind === "tab" && selectedTabIds.has(row.tab.id) && selectedTabIds.size > 1 && !selectedTabsSource) {
    return null;
  }

  return selectedTabsSource ?? createDragSource(row);
}

export function shouldStartPointerDragSession(params: {
  pointerGesture: {
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  };
  source: DragSource | null;
}): boolean {
  const { pointerGesture, source } = params;

  if (pointerGesture.ctrlKey || pointerGesture.metaKey || pointerGesture.shiftKey) {
    return false;
  }

  return source != null;
}
