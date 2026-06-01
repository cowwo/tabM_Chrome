import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { translate, type SupportedLocale } from "../../shared/i18n";
import type { PanelRow, TabDisplaySize, WindowRenderSection } from "../../shared/types";
import { findClosestDropTarget } from "./dragHitTesting";
import {
  calculateAutoScrollDelta,
  deriveNextAutoScrollFrame
} from "./dragAutoScroll";
import type { DragSource, DropTarget, PointerDragSession, PointerPosition } from "./listDrag";
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
} from "./listDrag";
import type { HoveredTabPreview } from "./listRows";
import { RowShell } from "./listRows";
import {
  calculateAnchorScrollAdjustment,
  calculateRequiredBottomSpacer,
  calculateTargetRowScrollAdjustment,
  canReleaseBottomSpacer,
  getActiveRowTopObstruction,
  getRowTopWithinContainer,
  getStickyScrollStyle,
  getVirtualListClassName,
  getWindowSectionHeaderClassName,
  resolveActiveRowAutoScroll,
  shouldHandleLocateRequest
} from "./listUtils";
import { useStableCallback } from "../hooks/useStableCallback";

interface VirtualizedWindowListProps {
  locale: SupportedLocale;
  tabDisplaySize: TabDisplaySize;
  rows: PanelRow[];
  renderSections: WindowRenderSection[];
  currentActiveTabId: number | null;
  locateRequest: {
    rowKey: string;
    requestId: number;
  } | null;
  closingTabIds: ReadonlySet<number>;
  selectedTabIds: ReadonlySet<number>;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  disabled?: boolean;
  searchActive?: boolean;
  onTraceEvent?: (event: string, details: Record<string, unknown>) => void;
  onHoveredTabChange?: (preview: HoveredTabPreview | null) => void;
  selectionMode: boolean;
  onClearSelection: () => void;
  onToggleWindow: (windowId: number) => void;
  onToggleGroup: (groupId: number, collapsed: boolean) => void;
  onActivateTab: (params: {
    tabId: number;
    shiftKey: boolean;
    toggleKey: boolean;
  }) => void;
  onTogglePinned: (tabId: number, pinned: boolean) => void;
  onCloseTab: (tabId: number) => void;
  onMoveTab: (command: {
    tabId: number;
    targetWindowId: number;
    targetIndex: number;
    targetGroupId: number | null;
  }) => void;
  onMoveTabs: (command: {
    tabIds: number[];
    targetWindowId: number;
    targetIndex: number;
    targetGroupId: number | null;
  }) => void;
  onMoveGroup: (command: {
    groupId: number;
    tabIds: number[];
    targetWindowId: number;
    targetIndex: number;
    title: string;
    color: chrome.tabGroups.ColorEnum;
    collapsed: boolean;
  }) => void;
}

// Re-export pointer drag types and helpers so existing test imports stay valid.
export type { PointerDragSession, PointerPosition } from "./listDrag";
export {
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
} from "./listDrag";

const POINTER_DRAG_THRESHOLD_PX = 6;
const POINTER_DRAG_AUTO_SCROLL_HOT_ZONE_PX = 60;
const POINTER_DRAG_AUTO_SCROLL_MAX_STEP_PX = 24;

function resolveDragTargetFromPointer(params: {
  source: DragSource;
  pointer: PointerPosition;
  rows: readonly PanelRow[];
  rowRefs: ReadonlyMap<string, HTMLDivElement>;
}): DropTarget | null {
  return findClosestDropTarget({
    source: params.source,
    pointer: {
      clientX: params.pointer.x,
      clientY: params.pointer.y
    },
    rows: collectVisibleDragRows({
      rows: params.rows,
      rowRefs: params.rowRefs
    })
  });
}

function createPointerPosition(event: React.PointerEvent<HTMLElement>): PointerPosition {
  return {
    x: event.clientX,
    y: event.clientY
  };
}

function releasePointerCapture(event: React.PointerEvent<HTMLElement>): void {
  if (!("hasPointerCapture" in event.currentTarget) || !("releasePointerCapture" in event.currentTarget)) {
    return;
  }

  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
}

function dispatchDragCommand(
  command:
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
      },
  handlers: {
    onMoveTab: VirtualizedWindowListProps["onMoveTab"];
    onMoveTabs: VirtualizedWindowListProps["onMoveTabs"];
    onMoveGroup: VirtualizedWindowListProps["onMoveGroup"];
  }
): void {
  if (command.type === "tab/move") {
    handlers.onMoveTab({
      tabId: command.tabId,
      targetWindowId: command.targetWindowId,
      targetIndex: command.targetIndex,
      targetGroupId: command.targetGroupId
    });
    return;
  }

  if (command.type === "tabs/move") {
    handlers.onMoveTabs({
      tabIds: command.tabIds,
      targetWindowId: command.targetWindowId,
      targetIndex: command.targetIndex,
      targetGroupId: command.targetGroupId
    });
    return;
  }

  handlers.onMoveGroup({
    groupId: command.groupId,
    tabIds: command.tabIds,
    targetWindowId: command.targetWindowId,
    targetIndex: command.targetIndex,
    title: command.title,
    color: command.color,
    collapsed: command.collapsed
  });
}

export function VirtualizedWindowList({
  locale,
  tabDisplaySize,
  rows,
  renderSections,
  currentActiveTabId,
  locateRequest,
  closingTabIds,
  selectedTabIds,
  scrollContainerRef,
  disabled = false,
  searchActive = false,
  onTraceEvent,
  onHoveredTabChange,
  selectionMode,
  onClearSelection,
  onToggleWindow,
  onToggleGroup,
  onActivateTab,
  onTogglePinned,
  onCloseTab,
  onMoveTab,
  onMoveTabs,
  onMoveGroup
}: VirtualizedWindowListProps) {
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const hasCompletedInitialScrollRef = useRef(false);
  const previousScrolledRowKeyRef = useRef<string | null>(null);
  const suppressedAutoScrollRowKeyRef = useRef<string | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const selectedTabIdsRef = useRef(selectedTabIds);
  selectedTabIdsRef.current = selectedTabIds;
  const pendingManualAnchorRef = useRef<{
    rowKey: string;
    previousRowTop: number;
  } | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const [bottomSpacerHeight, setBottomSpacerHeight] = useState(0);
  const [pointerDragSession, setPointerDragSession] = useState<PointerDragSession>({ phase: "idle" });
  const pointerDragSessionRef = useRef<PointerDragSession>(pointerDragSession);
  pointerDragSessionRef.current = pointerDragSession;
  const draggedRowKey = resolveDraggedRowKey({
    phase: pointerDragSession.phase,
    sourceRowKey: pointerDragSession.phase === "dragging" ? pointerDragSession.source.rowKey : undefined
  });
  const dragTarget = pointerDragSession.phase === "dragging" ? pointerDragSession.target : null;
  const getDropIndicator = useCallback(
    (rowKey: string): DropTarget["indicator"] | null =>
      resolveRenderedDropIndicator({ rowKey, target: dragTarget }),
    [dragTarget]
  );
  const [windowStickyOffset, setWindowStickyOffset] = useState(0);
  const [measuredWindowHeaderNode, setMeasuredWindowHeaderNode] = useState<HTMLDivElement | null>(null);
  const [locatePulseRowKey, setLocatePulseRowKey] = useState<string | null>(null);
  const previousHandledLocateRequestIdRef = useRef<number | null>(null);
  const suppressPostDragClickRef = useRef(false);
  const activeRowKey = currentActiveTabId != null ? `tab-${currentActiveTabId}` : null;
  const activeRowKeyRef = useRef<string | null>(null);
  activeRowKeyRef.current = activeRowKey;
  const onTraceEventRef = useRef(onTraceEvent);
  onTraceEventRef.current = onTraceEvent;
  const rowKeySet = useMemo(() => new Set(rows.map((row) => row.key)), [rows]);
  const hasActiveRowInList = activeRowKey != null && rowKeySet.has(activeRowKey);

  const handleClearSelection = useStableCallback(onClearSelection);
  const handleToggleWindowAction = useStableCallback(onToggleWindow);
  const handleToggleGroupAction = useStableCallback(onToggleGroup);
  const handleActivateTabAction = useStableCallback(onActivateTab);
  const handleTogglePinnedAction = useStableCallback(onTogglePinned);
  const handleCloseTabAction = useStableCallback(onCloseTab);
  const handleMoveTabAction = useStableCallback(onMoveTab);
  const handleMoveTabsAction = useStableCallback(onMoveTabs);
  const handleMoveGroupAction = useStableCallback(onMoveGroup);

  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const pendingAnchor = pendingManualAnchorRef.current;
    if (scrollContainer && pendingAnchor) {
      const rowNode = rowRefs.current.get(pendingAnchor.rowKey);
      if (!rowNode) {
        pendingManualAnchorRef.current = null;
      } else {
        const nextRowTop = getRowTopWithinContainer(rowNode, scrollContainer);
        const scrollAdjustment = calculateAnchorScrollAdjustment({
          previousRowTop: pendingAnchor.previousRowTop,
          nextRowTop
        });

        if (scrollAdjustment === 0) {
          pendingManualAnchorRef.current = null;
        } else {
          const desiredScrollTop = scrollContainer.scrollTop + scrollAdjustment;
          const maxScrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight;
          const requiredBottomSpacer = calculateRequiredBottomSpacer({
            desiredScrollTop,
            maxScrollTop
          });

          if (requiredBottomSpacer > bottomSpacerHeight) {
            setBottomSpacerHeight(requiredBottomSpacer);
            return;
          }

          scrollContainer.scrollTop = Math.max(0, Math.min(desiredScrollTop, maxScrollTop));
          pendingManualAnchorRef.current = null;
        }
      }
    }

    if (
      scrollContainer &&
      pendingManualAnchorRef.current == null &&
      canReleaseBottomSpacer({
        currentScrollTop: scrollContainer.scrollTop,
        maxScrollTop: scrollContainer.scrollHeight - scrollContainer.clientHeight,
        bottomSpacerHeight
      })
    ) {
      setBottomSpacerHeight(0);
    }
  }, [rows, bottomSpacerHeight, scrollContainerRef]);

  useEffect(() => {
    if (bottomSpacerHeight === 0) {
      return;
    }

    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }

    const handleScroll = () => {
      if (
        canReleaseBottomSpacer({
          currentScrollTop: scrollContainer.scrollTop,
          maxScrollTop: scrollContainer.scrollHeight - scrollContainer.clientHeight,
          bottomSpacerHeight
        })
      ) {
        setBottomSpacerHeight(0);
      }
    };

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll);
    };
  }, [bottomSpacerHeight, scrollContainerRef]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const currentLocateRequest = locateRequest;
    if (currentLocateRequest == null) {
      return;
    }

    const targetRow = rowRefs.current.get(currentLocateRequest.rowKey) ?? null;
    if (!scrollContainer || !targetRow || !shouldHandleLocateRequest({
      locateRequest: currentLocateRequest,
      hasRenderedTargetRow: true,
      previousHandledRequestId: previousHandledLocateRequestIdRef.current
    })) {
      return;
    }

    previousHandledLocateRequestIdRef.current = currentLocateRequest.requestId;

    const rowTop = getRowTopWithinContainer(targetRow, scrollContainer);
    const rowBottom = rowTop + targetRow.getBoundingClientRect().height;
    const topObstruction = getActiveRowTopObstruction(targetRow);
    const scrollAdjustment = calculateTargetRowScrollAdjustment({
      rowTop,
      rowBottom,
      containerHeight: scrollContainer.clientHeight,
      topObstruction
    });

    onTraceEventRef.current?.("list/scroll-to-locate-target", {
      rowKey: currentLocateRequest.rowKey,
      requestId: currentLocateRequest.requestId,
      scrollAdjustment,
      rowTop,
      rowBottom,
      topObstruction
    });

    if (scrollAdjustment !== 0) {
      const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
      const nextScrollTop = Math.max(0, Math.min(scrollContainer.scrollTop + scrollAdjustment, maxScrollTop));
      scrollContainer.scrollTo({
        top: nextScrollTop,
        behavior: "smooth"
      });
    }

    setLocatePulseRowKey(currentLocateRequest.rowKey);
  }, [locateRequest, rows, scrollContainerRef]);

  useEffect(() => {
    if (!locatePulseRowKey) {
      return;
    }

    const timer = window.setTimeout(() => {
      setLocatePulseRowKey((current) => (current === locatePulseRowKey ? null : current));
    }, 1200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [locatePulseRowKey]);

  useEffect(() => {
    if (locateRequest == null) {
      previousHandledLocateRequestIdRef.current = null;
    }

    if (locatePulseRowKey && !rowKeySet.has(locatePulseRowKey)) {
      setLocatePulseRowKey(null);
    }
  }, [locatePulseRowKey, locateRequest, rowKeySet]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const targetRow = activeRowKey == null ? null : rowRefs.current.get(activeRowKey);
    const decision = resolveActiveRowAutoScroll({
      activeRowKey,
      hasActiveRowInList,
      hasRenderedTargetRow: Boolean(targetRow),
      hasCompletedInitialScroll: hasCompletedInitialScrollRef.current,
      previousScrolledRowKey: previousScrolledRowKeyRef.current,
      suppressedActiveRowKey: suppressedAutoScrollRowKeyRef.current
    });

    previousScrolledRowKeyRef.current = decision.nextPreviousScrolledRowKey;
    suppressedAutoScrollRowKeyRef.current = decision.nextSuppressedActiveRowKey;

    if (!decision.shouldScroll || !targetRow || !scrollContainer) {
      return;
    }

    const rowTop = getRowTopWithinContainer(targetRow, scrollContainer);
    const rowBottom = rowTop + targetRow.getBoundingClientRect().height;
    const topObstruction = getActiveRowTopObstruction(targetRow);
    const scrollAdjustment = calculateTargetRowScrollAdjustment({
      rowTop,
      rowBottom,
      containerHeight: scrollContainer.clientHeight,
      topObstruction
    });

    onTraceEventRef.current?.("list/auto-scroll-to-active", {
      activeRowKey,
      scrollAdjustment,
      rowTop,
      rowBottom,
      topObstruction
    });

    if (scrollAdjustment !== 0) {
      const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
      const nextScrollTop = Math.max(0, Math.min(scrollContainer.scrollTop + scrollAdjustment, maxScrollTop));
      scrollContainer.scrollTo({
        top: nextScrollTop,
        behavior: "smooth"
      });
    }

    hasCompletedInitialScrollRef.current = true;
    previousScrolledRowKeyRef.current = activeRowKey;
  }, [activeRowKey, hasActiveRowInList, rows, scrollContainerRef]);

  useEffect(() => {
    if (pointerDragSession.phase !== "idle" && !rowKeySet.has(pointerDragSession.source.rowKey)) {
      setPointerDragSession({ phase: "idle" });
    }
  }, [pointerDragSession, rowKeySet]);

  useLayoutEffect(() => {
    if (!measuredWindowHeaderNode) {
      setWindowStickyOffset(0);
      return;
    }

    const updateWindowStickyOffset = () => {
      setWindowStickyOffset(measuredWindowHeaderNode.getBoundingClientRect().height);
    };

    updateWindowStickyOffset();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWindowStickyOffset);
      return () => {
        window.removeEventListener("resize", updateWindowStickyOffset);
      };
    }

    const observer = new ResizeObserver(() => {
      updateWindowStickyOffset();
    });
    observer.observe(measuredWindowHeaderNode);

    return () => {
      observer.disconnect();
    };
  }, [measuredWindowHeaderNode]);

  const captureManualToggleAnchor = useCallback((rowKey: string): void => {
    const scrollContainer = scrollContainerRef.current;
    const rowNode = rowRefs.current.get(rowKey);

    suppressedAutoScrollRowKeyRef.current = activeRowKeyRef.current;

    if (!scrollContainer || !rowNode) {
      pendingManualAnchorRef.current = null;
      return;
    }

    pendingManualAnchorRef.current = {
      rowKey,
      previousRowTop: getRowTopWithinContainer(rowNode, scrollContainer)
    };
  }, [scrollContainerRef]);

  const stopAutoScroll = useCallback((): void => {
    if (autoScrollFrameRef.current != null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
  }, []);

  const scheduleAutoScroll = useCallback((): void => {
    if (autoScrollFrameRef.current != null) {
      return;
    }

    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }

    const tick = () => {
      autoScrollFrameRef.current = null;

      const current = pointerDragSessionRef.current;
      if (current.phase !== "dragging") {
        return;
      }

      const containerRect = scrollContainer.getBoundingClientRect();
      const delta = calculateAutoScrollDelta({
        pointerClientY: current.pointer.y,
        containerTop: containerRect.top,
        containerHeight: containerRect.height,
        hotZoneSize: POINTER_DRAG_AUTO_SCROLL_HOT_ZONE_PX,
        maxStep: POINTER_DRAG_AUTO_SCROLL_MAX_STEP_PX
      });

      const { nextScrollTop, didScroll } = deriveNextAutoScrollFrame({
        currentScrollTop: scrollContainer.scrollTop,
        maxScrollTop: Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight),
        delta
      });

      const { shouldScheduleNextFrame } = resolvePointerDragAutoScrollLoopState({
        isDragging: true,
        hasScheduledFrame: false,
        delta,
        didScroll
      });

      const nextTarget = shouldScheduleNextFrame
        ? resolveDragTargetFromPointer({
            source: current.source,
            pointer: current.pointer,
            rows: rowsRef.current,
            rowRefs: rowRefs.current
          })
        : current.target;

      const tickResult = resolvePointerDragAutoScrollTickResult({
        session: current,
        nextScrollTop,
        shouldScheduleNextFrame,
        nextTarget
      });

      if (tickResult.shouldApplyScroll) {
        scrollContainer.scrollTop = tickResult.nextScrollTop;
        setPointerDragSession(tickResult.nextSession);
      }

      if (tickResult.shouldScheduleNextFrame) {
        autoScrollFrameRef.current = window.requestAnimationFrame(tick);
      }
    };

    autoScrollFrameRef.current = window.requestAnimationFrame(tick);
  }, [scrollContainerRef]);

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  useEffect(() => {
    if (pointerDragSession.phase !== "dragging") {
      stopAutoScroll();
      return;
    }

    scheduleAutoScroll();
    return stopAutoScroll;
  }, [pointerDragSession.phase, scheduleAutoScroll, stopAutoScroll]);

  const handlePointerDown = useCallback((row: PanelRow, event: React.PointerEvent<HTMLElement>): void => {
    if (disabled || event.button !== 0 || !event.isPrimary) {
      return;
    }

    suppressPostDragClickRef.current = false;

    const pointerGesture = {
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey
    };

    if (shouldHandleSelectionGestureOnPointerDown({
      row,
      pointerGesture
    })) {
      return;
    }

    const currentSelectedTabIds = selectedTabIdsRef.current;
    if (shouldClearSelectionOnPointerDown({
      row,
      selectedTabIds: currentSelectedTabIds,
      pointerGesture
    })) {
      handleClearSelection();
    }

    const source = createPointerDragSource({
      row,
      rows: rowsRef.current,
      selectedTabIds: currentSelectedTabIds,
      pointerGesture
    });

    if (!shouldStartPointerDragSession({
      source,
      pointerGesture: {
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey
      }
    })) {
      return;
    }

    const confirmedSource = source;
    if (confirmedSource == null) {
      return;
    }

    if ("setPointerCapture" in event.currentTarget) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    setPointerDragSession({
      phase: "pressing",
      pointerId: event.pointerId,
      origin: createPointerPosition(event),
      source: confirmedSource
    });
  }, [disabled, handleClearSelection]);


  const handlePointerEnter = useCallback((_row: PanelRow, _event: React.PointerEvent<HTMLElement>): void => {
    return;
  }, []);

  const handlePointerMove = useCallback((_row: PanelRow, event: React.PointerEvent<HTMLElement>): void => {
    setPointerDragSession((current) => {
      if (current.phase === "idle" || current.pointerId !== event.pointerId) {
        return current;
      }

      const pointer = createPointerPosition(event);

      if (current.phase === "pressing") {
        if (resolvePointerDragPhase({
          origin: current.origin,
          pointer,
          threshold: POINTER_DRAG_THRESHOLD_PX
        }) !== "dragging") {
          return current;
        }

        const target = resolveDragTargetFromPointer({
          source: current.source,
          pointer,
          rows: rowsRef.current,
          rowRefs: rowRefs.current
        });

        return {
          phase: "dragging",
          pointerId: current.pointerId,
          origin: current.origin,
          source: current.source,
          pointer,
          target
        };
      }

      const target = resolveDragTargetFromPointer({
        source: current.source,
        pointer,
        rows: rowsRef.current,
        rowRefs: rowRefs.current
      });

      return {
        ...current,
        pointer,
        target
      };
    });

    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }

    const containerRect = scrollContainer.getBoundingClientRect();
    const delta = calculateAutoScrollDelta({
      pointerClientY: event.clientY,
      containerTop: containerRect.top,
      containerHeight: containerRect.height,
      hotZoneSize: POINTER_DRAG_AUTO_SCROLL_HOT_ZONE_PX,
      maxStep: POINTER_DRAG_AUTO_SCROLL_MAX_STEP_PX
    });

    const { shouldScheduleFromPointerMove } = resolvePointerDragAutoScrollLoopState({
      isDragging: pointerDragSession.phase === "dragging" || resolvePointerDragPhase({
        origin: pointerDragSession.phase === "pressing" ? pointerDragSession.origin : { x: event.clientX, y: event.clientY },
        pointer: { x: event.clientX, y: event.clientY },
        threshold: POINTER_DRAG_THRESHOLD_PX
      }) === "dragging",
      hasScheduledFrame: autoScrollFrameRef.current != null,
      delta,
      didScroll: true
    });

    if (shouldScheduleFromPointerMove) {
      scheduleAutoScroll();
    }
  }, [pointerDragSession, scheduleAutoScroll, scrollContainerRef]);

  const handlePointerUp = useCallback((_row: PanelRow, event: React.PointerEvent<HTMLElement>): void => {
    stopAutoScroll();

    const scrollContainer = scrollContainerRef.current;
    const releasedWithinContainer = scrollContainer != null
      && isPointerWithinContainerBounds({
        pointer: createPointerPosition(event),
        containerRect: scrollContainer.getBoundingClientRect()
      });

    const pointerUpResult = resolvePointerUpResult({
      session: pointerDragSessionRef.current,
      releasedWithinContainer,
      pointerId: event.pointerId
    });

    setPointerDragSession(pointerUpResult.nextSession);
    suppressPostDragClickRef.current = pointerUpResult.shouldSuppressPostDragClick;

    if (pointerUpResult.command) {
      dispatchDragCommand(pointerUpResult.command, {
        onMoveTab: handleMoveTabAction,
        onMoveTabs: handleMoveTabsAction,
        onMoveGroup: handleMoveGroupAction
      });
    }

    releasePointerCapture(event);
  }, [handleMoveGroupAction, handleMoveTabAction, handleMoveTabsAction, scrollContainerRef, stopAutoScroll]);

  const handlePointerCancel = useCallback((_row: PanelRow, event: React.PointerEvent<HTMLElement>): void => {
    stopAutoScroll();

    const pointerCancelResult = resolvePointerCancelResult({
      session: pointerDragSessionRef.current,
      pointerId: event.pointerId
    });

    setPointerDragSession(pointerCancelResult.nextSession);

    releasePointerCapture(event);
  }, [stopAutoScroll]);

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state__title">
          {searchActive
            ? translate(locale, "sidepanel.list.emptySearchTitle")
            : translate(locale, "sidepanel.list.emptyTitle")}
        </p>
        <p className="empty-state__body">
          {searchActive
            ? translate(locale, "sidepanel.list.emptySearchBody")
            : translate(locale, "sidepanel.list.emptyBody")}
        </p>
      </div>
    );
  }

  return (
    <div
      className={getVirtualListClassName(tabDisplaySize)}
      role="tree"
      aria-label={translate(locale, "sidepanel.list.aria")}
      style={getStickyScrollStyle(windowStickyOffset)}
      onPointerDown={(event) => {
        if (event.target instanceof Element && event.target.closest(".stack-list__item")) {
          return;
        }

        if (selectionMode) {
          return;
        }

        onClearSelection();
      }}
      onPointerLeave={() => onHoveredTabChange?.(null)}
      onClickCapture={(event) => {
        if (!suppressPostDragClickRef.current) {
          return;
        }

        suppressPostDragClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
          return;
        }

        onHoveredTabChange?.(null);
      }}
    >
      <div className="stack-list">
        {renderSections.map((section, sectionIndex) => (
          <section
            key={section.windowRow.key}
            className="window-section"
          >
            <RowShell
              locale={locale}
              row={section.windowRow}
              rowRefs={rowRefs}
              isCurrentActive={false}
              isWindowActive={false}
              isClosing={false}
              isSelected={false}
              isLocatePulsing={false}
              onCaptureManualToggleAnchor={captureManualToggleAnchor}
              disabled={disabled}
              onClearSelection={handleClearSelection}
              onToggleWindow={handleToggleWindowAction}
              onToggleGroup={handleToggleGroupAction}
              onActivateTab={handleActivateTabAction}
              onTogglePinned={handleTogglePinnedAction}
              onCloseTab={handleCloseTabAction}
              selectionMode={selectionMode}
              isDragging={draggedRowKey === section.windowRow.key}
              dropIndicator={getDropIndicator(section.windowRow.key)}
              onPointerDown={handlePointerDown}
              onPointerEnter={handlePointerEnter}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              extraClassName={getWindowSectionHeaderClassName({
                measured: sectionIndex === 0
              })}
              visuallyExpanded={searchActive && section.windowRow.collapsed}
              onElementRefChange={sectionIndex === 0 ? setMeasuredWindowHeaderNode : undefined}
              onHoveredTabChange={onHoveredTabChange}
            />
            {searchActive || !section.windowRow.collapsed ? (
              <div className="window-section__body">
                {section.items.map((item) =>
                  item.kind === "single" ? (
                    <RowShell
                      locale={locale}
                      key={item.row.key}
                      row={item.row}
                      rowRefs={rowRefs}
                      isCurrentActive={item.row.kind === "tab" && item.row.tab.id === currentActiveTabId}
                      isWindowActive={item.row.kind === "tab" && item.row.tab.active && item.row.tab.id !== currentActiveTabId}
                      isClosing={item.row.kind === "tab" && closingTabIds.has(item.row.tab.id)}
                      isSelected={item.row.kind === "tab" && selectedTabIds.has(item.row.tab.id)}
                      isLocatePulsing={locatePulseRowKey === item.row.key}
                      onCaptureManualToggleAnchor={captureManualToggleAnchor}
                      disabled={disabled}
                      onClearSelection={handleClearSelection}
                      onToggleWindow={handleToggleWindowAction}
                      onToggleGroup={handleToggleGroupAction}
                      onActivateTab={handleActivateTabAction}
                      onTogglePinned={handleTogglePinnedAction}
                      onCloseTab={handleCloseTabAction}
                      selectionMode={selectionMode}
                      isDragging={draggedRowKey === item.row.key}
                      dropIndicator={getDropIndicator(item.row.key)}
                      onPointerDown={handlePointerDown}
                      onPointerEnter={handlePointerEnter}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={handlePointerCancel}
                      onHoveredTabChange={onHoveredTabChange}
                    />
                  ) : (
                    <div
                      key={item.groupRow.key}
                      className={`group-block group-block--${item.groupRow.color}${
                        item.groupRow.collapsed ? " group-block--collapsed" : ""
                      }${
                        draggedRowKey === item.groupRow.key
                          ? " group-block--dragging"
                          : ""
                      }`}
                    >
                      <RowShell
                        locale={locale}
                        row={item.groupRow}
                        rowRefs={rowRefs}
                        isCurrentActive={false}
                        isWindowActive={false}
                        isClosing={false}
                        isSelected={false}
                        isLocatePulsing={false}
                        onCaptureManualToggleAnchor={captureManualToggleAnchor}
                        disabled={disabled}
                        onClearSelection={handleClearSelection}
                        onToggleWindow={handleToggleWindowAction}
                        onToggleGroup={handleToggleGroupAction}
                        onActivateTab={handleActivateTabAction}
                        onTogglePinned={handleTogglePinnedAction}
                        onCloseTab={handleCloseTabAction}
                        selectionMode={selectionMode}
                        isDragging={draggedRowKey === item.groupRow.key}
                        dropIndicator={getDropIndicator(item.groupRow.key)}
                        onPointerDown={handlePointerDown}
                        onPointerEnter={handlePointerEnter}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerCancel}
                        onHoveredTabChange={onHoveredTabChange}
                      />
                      {!item.groupRow.collapsed || searchActive ? (
                        <div className="group-block__body">
                          {item.childRows.map((row, index) => (
                            <RowShell
                              locale={locale}
                              key={row.key}
                              row={row}
                              rowRefs={rowRefs}
                              isCurrentActive={row.tab.id === currentActiveTabId}
                              isWindowActive={row.tab.active && row.tab.id !== currentActiveTabId}
                              isClosing={closingTabIds.has(row.tab.id)}
                              isSelected={selectedTabIds.has(row.tab.id)}
                              isLocatePulsing={locatePulseRowKey === row.key}
                              onCaptureManualToggleAnchor={captureManualToggleAnchor}
                              disabled={disabled}
                              onClearSelection={handleClearSelection}
                              onToggleWindow={handleToggleWindowAction}
                              onToggleGroup={handleToggleGroupAction}
                              onActivateTab={handleActivateTabAction}
                              onTogglePinned={handleTogglePinnedAction}
                              onCloseTab={handleCloseTabAction}
                              selectionMode={selectionMode}
                              extraClassName={`group-block__item${
                                index === item.childRows.length - 1 ? " group-block__item--last" : ""
                              }`}
                              groupedTabColor={item.groupRow.color}
                              isDragging={draggedRowKey === row.key}
                              dropIndicator={getDropIndicator(row.key)}
                              onPointerDown={handlePointerDown}
                              onPointerEnter={handlePointerEnter}
                              onPointerMove={handlePointerMove}
                              onPointerUp={handlePointerUp}
                              onPointerCancel={handlePointerCancel}
                              onHoveredTabChange={onHoveredTabChange}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )
                )}
              </div>
            ) : null}
          </section>
        ))}
        {bottomSpacerHeight > 0 ? (
          <div
            aria-hidden="true"
            className="stack-list__bottom-spacer"
            style={{ height: `${bottomSpacerHeight}px` }}
          />
        ) : null}
      </div>
    </div>
  );
}
