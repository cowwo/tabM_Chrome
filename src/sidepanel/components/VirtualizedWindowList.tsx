import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from "react";
import { translate, type SupportedLocale } from "../../shared/i18n";
import type { PanelRow, TabDisplaySize, WindowRenderSection } from "../../shared/types";
import {
  collectRenderedDragRows,
  createDragHitTestIndex,
  findClosestDropTargetInIndex,
  isDragHitTestCacheValid,
  type DragHitTestCacheState
} from "./dragHitTesting";
import {
  calculateAutoScrollDelta,
  deriveNextAutoScrollFrame
} from "./dragAutoScroll";
import type { DragSource, DropTarget, PointerDragSession, PointerPosition } from "./listDrag";
import {
  createPointerDragSource,
  isPointerWithinContainerBounds,
  resolveDraggedRowKey,
  resolvePointerCancelResult,
  resolvePointerDragAutoScrollLoopState,
  resolvePointerDragAutoScrollTickResult,
  resolvePointerDragPhase,
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
  buildVirtualListLayout,
  calculateAnchorScrollAdjustment,
  calculateRequiredBottomSpacer,
  calculateTargetRowScrollAdjustment,
  canReleaseBottomSpacer,
  DEFAULT_VIRTUAL_VIEWPORT_HEIGHT_PX,
  getRowTopWithinContainer,
  getStickyScrollStyle,
  getVirtualListClassName,
  getVirtualListMetrics,
  getVirtualListStructuralKey,
  getWindowSectionHeaderClassName,
  resolveActiveRowAutoScroll,
  resolveVirtualRenderPlan,
  resolveVirtualRowTopObstruction,
  shouldHandleLocateRequest,
  type VirtualItemRenderPlan,
  type VirtualListLayout,
  type VirtualRenderPlan,
  type VirtualRowHeightKind
} from "./listUtils";
import { useStableCallback } from "../hooks/useStableCallback";

export interface VirtualListImperativeHandle {
  /** 按 row key 滚动到目标行（复用定位逻辑，用于 E2E 确定性验证）。 */
  scrollToRowKey: (rowKey: string) => boolean;
}

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
  /** E2E 只读/确定性测试用的命令式句柄（可选）。 */
  imperativeRef?: React.MutableRefObject<VirtualListImperativeHandle | null>;
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

interface DragRenderProjection {
  phase: PointerDragSession["phase"];
  draggedRowKey: string | null;
  target: DropTarget | null;
}

const IDLE_DRAG_PROJECTION: DragRenderProjection = {
  phase: "idle",
  draggedRowKey: null,
  target: null
};

function projectDragSession(session: PointerDragSession): DragRenderProjection {
  if (session.phase === "idle") {
    return IDLE_DRAG_PROJECTION;
  }

  if (session.phase === "pressing") {
    return {
      phase: "pressing",
      draggedRowKey: null,
      target: null
    };
  }

  return {
    phase: "dragging",
    draggedRowKey: session.source.rowKey,
    target: session.target
  };
}

function hasSameRenderedTarget(left: DropTarget | null, right: DropTarget | null): boolean {
  if (left == null || right == null) {
    return left === right;
  }

  return left.rowKey === right.rowKey && left.indicator === right.indicator;
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

function isEventInsideRenderedRow(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(".stack-list__item") != null;
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

interface RowScrollResult {
  available: boolean;
  scrollAdjustment: number;
  rowTop: number;
  rowBottom: number;
  topObstruction: number;
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
  onMoveGroup,
  imperativeRef
}: VirtualizedWindowListProps) {
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const listElementRef = useRef<HTMLDivElement | null>(null);
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
  const [windowStickyOffset, setWindowStickyOffset] = useState(0);
  const windowStickyOffsetRef = useRef(0);
  const [locatePulseRowKey, setLocatePulseRowKey] = useState<string | null>(null);
  const previousHandledLocateRequestIdRef = useRef<number | null>(null);
  const pendingLocatePulseRowKeyRef = useRef<string | null>(null);
  const pendingActiveSettleRef = useRef<{ rowKey: string; lastLayout: VirtualListLayout } | null>(null);
  const pendingLocateSettleRef = useRef<{ rowKey: string; lastLayout: VirtualListLayout } | null>(null);
  const suppressPostDragClickRef = useRef(false);
  const activeRowKey = currentActiveTabId != null ? `tab-${currentActiveTabId}` : null;
  const activeRowKeyRef = useRef<string | null>(null);
  activeRowKeyRef.current = activeRowKey;
  const onTraceEventRef = useRef(onTraceEvent);
  onTraceEventRef.current = onTraceEvent;
  const onHoveredTabChangeRef = useRef(onHoveredTabChange);
  onHoveredTabChangeRef.current = onHoveredTabChange;
  const hoveredRowKeyRef = useRef<string | null>(null);
  const rowKeySet = useMemo(() => new Set(rows.map((row) => row.key)), [rows]);
  const hasActiveRowInList = activeRowKey != null && rowKeySet.has(activeRowKey);

  // ── 虚拟化布局状态 ────────────────────────────────────────────────
  const metrics = useMemo(() => getVirtualListMetrics(tabDisplaySize), [tabDisplaySize]);
  const structuralKey = useMemo(
    () => getVirtualListStructuralKey({ renderSections, searchActive, tabDisplaySize }),
    [renderSections, searchActive, tabDisplaySize]
  );
  const [measurementVersion, setMeasurementVersion] = useState(0);
  const measuredRowHeightsRef = useRef(new Map<string, number>());
  const measuredTypeHeightsRef = useRef<Partial<Record<VirtualRowHeightKind, number>>>({});
  const layout = useMemo(
    () =>
      buildVirtualListLayout({
        renderSections,
        metrics,
        searchActive,
        measuredRowHeights: measuredRowHeightsRef.current,
        measuredTypeHeights: measuredTypeHeightsRef.current
      }),
    [renderSections, metrics, searchActive, measurementVersion]
  );
  const layoutRef = useRef<VirtualListLayout>(layout);
  layoutRef.current = layout;
  const rowByKeyRef = useRef(layout.rowByKey);
  rowByKeyRef.current = layout.rowByKey;
  const [renderPlan, setRenderPlan] = useState<VirtualRenderPlan>(() =>
    resolveVirtualRenderPlan({
      layout,
      visibleTop: 0,
      viewportHeight: DEFAULT_VIRTUAL_VIEWPORT_HEIGHT_PX
    })
  );
  const renderPlanRef = useRef(renderPlan);
  renderPlanRef.current = renderPlan;
  const previousStructuralKeyRef = useRef(structuralKey);
  const rowsRevisionRef = useRef(0);
  const layoutRevisionRef = useRef(0);

  const [dragRenderProjection, setDragRenderProjection] = useState<DragRenderProjection>(IDLE_DRAG_PROJECTION);
  const dragRenderProjectionRef = useRef<DragRenderProjection>(IDLE_DRAG_PROJECTION);
  const pointerDragSessionRef = useRef<PointerDragSession>({ phase: "idle" });
  const dragHitTestCacheRef = useRef<DragHitTestCacheState | null>(null);
  const draggedRowKey = dragRenderProjection.draggedRowKey;
  const dragTarget = dragRenderProjection.target;
  const getDropIndicator = useCallback(
    (rowKey: string): DropTarget["indicator"] | null =>
      resolveRenderedDropIndicator({ rowKey, target: dragTarget }),
    [dragTarget]
  );

  const commitDragSession = useStableCallback((session: PointerDragSession): void => {
    pointerDragSessionRef.current = session;
    const nextProjection = projectDragSession(session);
    const currentProjection = dragRenderProjectionRef.current;

    if (
      currentProjection.phase === nextProjection.phase
      && currentProjection.draggedRowKey === nextProjection.draggedRowKey
      && hasSameRenderedTarget(currentProjection.target, nextProjection.target)
    ) {
      return;
    }

    dragRenderProjectionRef.current = nextProjection;
    setDragRenderProjection(nextProjection);
  });

  const readViewport = useCallback((container: HTMLDivElement, listElement: HTMLDivElement) => {
    const containerRect = container.getBoundingClientRect();
    const listRect = listElement.getBoundingClientRect();
    const listTopInContent = listRect.top - containerRect.top + container.scrollTop;

    return {
      visibleTop: container.scrollTop - listTopInContent,
      viewportHeight: container.clientHeight
    };
  }, []);

  const refreshRenderPlan = useStableCallback((): void => {
    const container = scrollContainerRef.current;
    const listElement = listElementRef.current;
    const nextLayout = layoutRef.current;
    const viewport = container != null && listElement != null
      ? readViewport(container, listElement)
      : { visibleTop: 0, viewportHeight: DEFAULT_VIRTUAL_VIEWPORT_HEIGHT_PX };
    const nextPlan = resolveVirtualRenderPlan({
      layout: nextLayout,
      visibleTop: viewport.visibleTop,
      viewportHeight: viewport.viewportHeight
    });
    const currentPlan = renderPlanRef.current;

    if (currentPlan.layout === nextLayout && currentPlan.signature === nextPlan.signature) {
      return;
    }

    renderPlanRef.current = nextPlan;
    setRenderPlan(nextPlan);
  });

  // ── 拖拽命中：缓存索引 + 二分 ─────────────────────────────────────
  const resolveDragTarget = useStableCallback((source: DragSource, pointer: PointerPosition): DropTarget | null => {
    const container = scrollContainerRef.current;
    const scrollTop = container?.scrollTop ?? 0;
    const cached = dragHitTestCacheRef.current;
    let index = isDragHitTestCacheValid({
      cache: cached,
      scrollTop,
      rowsRevision: rowsRevisionRef.current,
      layoutRevision: layoutRevisionRef.current
    })
      ? cached!.index
      : null;

    if (index == null) {
      const entries = collectRenderedDragRows({
        rowRefs: rowRefs.current,
        rowByKey: rowByKeyRef.current
      });
      index = createDragHitTestIndex(entries);
      dragHitTestCacheRef.current = {
        scrollTop,
        rowsRevision: rowsRevisionRef.current,
        layoutRevision: layoutRevisionRef.current,
        index
      };
    }

    return findClosestDropTargetInIndex({
      source,
      pointer: { clientX: pointer.x, clientY: pointer.y },
      index
    });
  });

  // ── 滚动定位（渲染行/未渲染行都用虚拟布局偏移） ──────────────────
  const scrollRowKeyIntoView = useStableCallback((rowKey: string, behavior: ScrollBehavior): RowScrollResult => {
    const nextLayout = layoutRef.current;
    const geometry = nextLayout.rowGeometry.get(rowKey);
    const container = scrollContainerRef.current;
    const listElement = listElementRef.current;
    const unavailable: RowScrollResult = {
      available: false,
      scrollAdjustment: 0,
      rowTop: 0,
      rowBottom: 0,
      topObstruction: 0
    };

    if (geometry == null || container == null || listElement == null) {
      return unavailable;
    }

    const viewport = readViewport(container, listElement);
    const rowTop = geometry.top - viewport.visibleTop;
    const rowBottom = rowTop + geometry.height;
    const topObstruction = resolveVirtualRowTopObstruction(nextLayout, rowKey);
    const scrollAdjustment = calculateTargetRowScrollAdjustment({
      rowTop,
      rowBottom,
      containerHeight: container.clientHeight,
      topObstruction
    });

    if (scrollAdjustment !== 0) {
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const nextScrollTop = Math.max(0, Math.min(container.scrollTop + scrollAdjustment, maxScrollTop));
      container.scrollTo({
        top: nextScrollTop,
        behavior
      });
    }

    return {
      available: true,
      scrollAdjustment,
      rowTop,
      rowBottom,
      topObstruction
    };
  });

  /**
   * 首帧高度估算可能失真：远端目标第一次滚动到位后若未渲染，等实测高度刷新布局
   * （layout 变化）后再用 "auto" 补滚一次；同一布局只尝试一次，避免与平滑滚动互相打断。
   */
  const settlePendingRowScroll = useStableCallback(
    (entryRef: React.MutableRefObject<{ rowKey: string; lastLayout: VirtualListLayout } | null>): void => {
      const entry = entryRef.current;
      if (entry == null) {
        return;
      }

      if (rowRefs.current.has(entry.rowKey)) {
        entryRef.current = null;
        return;
      }

      const currentLayout = layoutRef.current;
      if (!currentLayout.rowGeometry.has(entry.rowKey)) {
        entryRef.current = null;
        return;
      }

      if (entry.lastLayout === currentLayout) {
        return;
      }

      entry.lastLayout = currentLayout;
      scrollRowKeyIntoView(entry.rowKey, "auto");
    }
  );

  const pendingLayoutAnchorRef = useRef<{ rowKey: string; previousTop: number } | null>(null);

  const findFirstRenderedRowKey = (plan: VirtualRenderPlan): string | null => {
    for (const sectionPlan of plan.sections) {
      if (sectionPlan.body == null) {
        continue;
      }

      for (const itemPlan of sectionPlan.body.items) {
        if (itemPlan.item.type === "single") {
          return itemPlan.item.row.key;
        }

        if (itemPlan.group != null && itemPlan.group.first >= 0) {
          const childRow = itemPlan.item.children[itemPlan.group.first];
          if (childRow != null) {
            return childRow.row.key;
          }
        }

        return itemPlan.item.row.key;
      }
    }

    return plan.sections[0]?.section.windowRow.key ?? null;
  };

  /**
   * 实测高度变化会整体重排（未渲染行用类型高度估算）。滚走后再校准某一类型高度时，
   * 记录"当前首个可见行"的旧偏移，重排后用 delta 修正 scrollTop，避免内容整体跳动。
   */
  const captureLayoutAnchor = useStableCallback((): void => {
    if (pendingLayoutAnchorRef.current != null) {
      return;
    }

    const rowKey = findFirstRenderedRowKey(renderPlanRef.current);
    if (rowKey == null) {
      return;
    }

    const geometry = layoutRef.current.rowGeometry.get(rowKey);
    if (geometry == null) {
      return;
    }

    pendingLayoutAnchorRef.current = {
      rowKey,
      previousTop: geometry.top
    };
  });

  const applyPendingLayoutAnchor = useStableCallback((): void => {
    const pendingAnchor = pendingLayoutAnchorRef.current;
    if (pendingAnchor == null) {
      return;
    }

    pendingLayoutAnchorRef.current = null;
    const container = scrollContainerRef.current;
    const geometry = layoutRef.current.rowGeometry.get(pendingAnchor.rowKey);
    if (container == null || geometry == null) {
      return;
    }

    const delta = geometry.top - pendingAnchor.previousTop;
    if (delta === 0) {
      return;
    }

    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = Math.max(0, Math.min(container.scrollTop + delta, maxScrollTop));
  });

  // ── 稳定事件回调 ─────────────────────────────────────────────────
  const handleClearSelection = useStableCallback(onClearSelection);
  const handleToggleWindowAction = useStableCallback(onToggleWindow);
  const handleToggleGroupAction = useStableCallback(onToggleGroup);
  const handleActivateTabAction = useStableCallback(onActivateTab);
  const handleTogglePinnedAction = useStableCallback(onTogglePinned);
  const handleCloseTabAction = useStableCallback(onCloseTab);
  const handleMoveTabAction = useStableCallback(onMoveTab);
  const handleMoveTabsAction = useStableCallback(onMoveTabs);
  const handleMoveGroupAction = useStableCallback(onMoveGroup);

  const handleListPointerDown = useStableCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.target instanceof Element && event.target.closest(".stack-list__item")) {
        return;
      }

      if (selectionMode) {
        return;
      }

      onClearSelection();
    }
  );
  const handleListPointerLeave = useStableCallback((): void => {
    hoveredRowKeyRef.current = null;
    onHoveredTabChange?.(null);
  });
  const handleListClickCapture = useStableCallback(
    (event: React.MouseEvent<HTMLDivElement>): void => {
      if (!suppressPostDragClickRef.current) {
        return;
      }

      suppressPostDragClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  );
  const handleListBlur = useStableCallback(
    (event: React.FocusEvent<HTMLDivElement>): void => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
        return;
      }

      hoveredRowKeyRef.current = null;
      onHoveredTabChange?.(null);
    }
  );

  const stopAutoScroll = useStableCallback((): void => {
    if (autoScrollFrameRef.current != null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
  });

  const scheduleAutoScroll = useStableCallback((): void => {
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

      if (shouldScheduleNextFrame) {
        scrollContainer.scrollTop = nextScrollTop;
      }

      const nextTarget = shouldScheduleNextFrame
        ? resolveDragTarget(current.source, current.pointer)
        : current.target;

      const tickResult = resolvePointerDragAutoScrollTickResult({
        session: current,
        nextScrollTop,
        shouldScheduleNextFrame,
        nextTarget
      });

      commitDragSession(tickResult.nextSession);

      if (tickResult.shouldScheduleNextFrame) {
        autoScrollFrameRef.current = window.requestAnimationFrame(tick);
      }
    };

    autoScrollFrameRef.current = window.requestAnimationFrame(tick);
  });

  const processPointerMove = useStableCallback((event: React.PointerEvent<HTMLElement>): void => {
    const session = pointerDragSessionRef.current;
    if (session.phase === "idle" || session.pointerId !== event.pointerId) {
      return;
    }

    const pointer = createPointerPosition(event);
    let nextSession: PointerDragSession;

    if (session.phase === "pressing") {
      if (resolvePointerDragPhase({
        origin: session.origin,
        pointer,
        threshold: POINTER_DRAG_THRESHOLD_PX
      }) !== "dragging") {
        return;
      }

      nextSession = {
        phase: "dragging",
        pointerId: session.pointerId,
        origin: session.origin,
        source: session.source,
        pointer,
        target: resolveDragTarget(session.source, pointer)
      };
    } else {
      nextSession = {
        ...session,
        pointer,
        target: resolveDragTarget(session.source, pointer)
      };
    }

    commitDragSession(nextSession);

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
      isDragging: true,
      hasScheduledFrame: autoScrollFrameRef.current != null,
      delta,
      didScroll: true
    });

    if (shouldScheduleFromPointerMove) {
      scheduleAutoScroll();
    }
  });

  const processPointerUp = useStableCallback((event: React.PointerEvent<HTMLElement>): void => {
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

    commitDragSession(pointerUpResult.nextSession);
    suppressPostDragClickRef.current = pointerUpResult.shouldSuppressPostDragClick;

    if (pointerUpResult.command) {
      dispatchDragCommand(pointerUpResult.command, {
        onMoveTab: handleMoveTabAction,
        onMoveTabs: handleMoveTabsAction,
        onMoveGroup: handleMoveGroupAction
      });
    }

    releasePointerCapture(event);
  });

  const processPointerCancel = useStableCallback((event: React.PointerEvent<HTMLElement>): void => {
    stopAutoScroll();

    const pointerCancelResult = resolvePointerCancelResult({
      session: pointerDragSessionRef.current,
      pointerId: event.pointerId
    });

    commitDragSession(pointerCancelResult.nextSession);
    releasePointerCapture(event);
  });

  const handlePointerDown = useStableCallback((row: PanelRow, event: React.PointerEvent<HTMLElement>): void => {
    if (disabled || event.button !== 0 || !event.isPrimary) {
      return;
    }

    suppressPostDragClickRef.current = false;

    const pointerGesture = {
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey
    };

    if (shouldHandleSelectionGestureOnPointerDown({ row, pointerGesture })) {
      return;
    }

    const currentSelectedTabIds = selectedTabIdsRef.current;
    if (shouldClearSelectionOnPointerDown({
      row,
      selectedTabIds: currentSelectedTabIds,
      selectionMode,
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

    if (!shouldStartPointerDragSession({ source, pointerGesture })) {
      return;
    }

    if (source == null) {
      return;
    }

    if ("setPointerCapture" in event.currentTarget) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    commitDragSession({
      phase: "pressing",
      pointerId: event.pointerId,
      origin: createPointerPosition(event),
      source
    });
  });

  const handlePointerEnter = useStableCallback((row: PanelRow, _event: React.PointerEvent<HTMLElement>): void => {
    hoveredRowKeyRef.current = row.key;
  });

  const handlePointerMove = useStableCallback((_row: PanelRow, event: React.PointerEvent<HTMLElement>): void => {
    processPointerMove(event);
  });

  const handlePointerUp = useStableCallback((_row: PanelRow, event: React.PointerEvent<HTMLElement>): void => {
    processPointerUp(event);
  });

  const handlePointerCancel = useStableCallback((_row: PanelRow, event: React.PointerEvent<HTMLElement>): void => {
    processPointerCancel(event);
  });

  // 行会在滚动/自动滚动中被回收，根节点兜底接收落在 spacer/空白上的指针事件。
  const handleRootPointerMove = useStableCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (isEventInsideRenderedRow(event.target)) {
      return;
    }

    processPointerMove(event);
  });
  const handleRootPointerUp = useStableCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (isEventInsideRenderedRow(event.target)) {
      return;
    }

    processPointerUp(event);
  });
  const handleRootPointerCancel = useStableCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    if (isEventInsideRenderedRow(event.target)) {
      return;
    }

    processPointerCancel(event);
  });

  const captureManualToggleAnchor = useStableCallback((rowKey: string): void => {
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
  });

  // ── 布局/滚动/测量副作用 ─────────────────────────────────────────
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    const listElement = listElementRef.current;

    if (container == null || listElement == null) {
      return;
    }

    applyPendingLayoutAnchor();

    const containerRect = container.getBoundingClientRect();
    const nextRowHeights = measuredRowHeightsRef.current;
    const nextTypeHeights = measuredTypeHeightsRef.current;
    let measurementChanged = false;

    for (const [rowKey, node] of rowRefs.current) {
      const geometry = layoutRef.current.rowGeometry.get(rowKey);
      if (geometry == null) {
        continue;
      }

      const rect = node.getBoundingClientRect();
      if (rect.height <= 0) {
        continue;
      }

      // 只采信"真正进入可视区"的节点：overscan 内被 content-visibility 跳过的
      // 节点高度是 contain-intrinsic-size 占位值，不是真实行高。
      if (rect.bottom <= containerRect.top || rect.top >= containerRect.bottom) {
        continue;
      }

      const roundedHeight = Math.round(rect.height);
      const currentTypeHeight = nextTypeHeights[geometry.kind];

      // 同一类型的行高应一致；这里只允许单调上调，避免亚像素取整在两行间来回抖动造成渲染循环。
      if (currentTypeHeight == null || roundedHeight >= currentTypeHeight + 1) {
        nextTypeHeights[geometry.kind] = roundedHeight;
        measurementChanged = true;
      }

      const effectiveTypeHeight = nextTypeHeights[geometry.kind] ?? roundedHeight;
      if (Math.abs(roundedHeight - effectiveTypeHeight) >= 1) {
        const previousRowHeight = nextRowHeights.get(rowKey);
        if (previousRowHeight !== roundedHeight) {
          nextRowHeights.set(rowKey, roundedHeight);
          measurementChanged = true;
        }
      } else if (nextRowHeights.delete(rowKey)) {
        measurementChanged = true;
      }
    }

    const measuredSectionPlan = renderPlanRef.current.sections[0];
    if (measuredSectionPlan != null) {
      const headerNode = rowRefs.current.get(measuredSectionPlan.section.windowRow.key);
      const headerHeight = headerNode == null ? 0 : Math.round(headerNode.getBoundingClientRect().height);
      if (headerHeight > 0 && headerHeight !== windowStickyOffsetRef.current) {
        windowStickyOffsetRef.current = headerHeight;
        setWindowStickyOffset(headerHeight);
      }
    }

    refreshRenderPlan();

    if (measurementChanged) {
      captureLayoutAnchor();
      setMeasurementVersion((current) => current + 1);
    }

    const pendingPulseRowKey = pendingLocatePulseRowKeyRef.current;
    if (pendingPulseRowKey != null && rowRefs.current.has(pendingPulseRowKey)) {
      pendingLocatePulseRowKeyRef.current = null;
      setLocatePulseRowKey(pendingPulseRowKey);
    }

    const hoveredRowKey = hoveredRowKeyRef.current;
    if (hoveredRowKey != null && !rowRefs.current.has(hoveredRowKey)) {
      hoveredRowKeyRef.current = null;
      onHoveredTabChangeRef.current?.(null);
    }
  });

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    let frame: number | null = null;
    const scheduleRefresh = () => {
      if (frame != null) {
        return;
      }

      frame = window.requestAnimationFrame(() => {
        frame = null;
        refreshRenderPlan();
      });
    };

    container.addEventListener("scroll", scheduleRefresh, { passive: true });
    window.addEventListener("resize", scheduleRefresh);
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => scheduleRefresh());
    observer?.observe(container);

    scheduleRefresh();

    return () => {
      container.removeEventListener("scroll", scheduleRefresh);
      window.removeEventListener("resize", scheduleRefresh);
      observer?.disconnect();
      if (frame != null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [refreshRenderPlan, scrollContainerRef]);

  useEffect(() => {
    rowsRevisionRef.current += 1;
    dragHitTestCacheRef.current = null;
  }, [rows]);

  useEffect(() => {
    layoutRevisionRef.current += 1;
    dragHitTestCacheRef.current = null;
  }, [layout]);

  useEffect(() => {
    if (previousStructuralKeyRef.current === structuralKey) {
      return;
    }

    previousStructuralKeyRef.current = structuralKey;
    const hadRows = measuredRowHeightsRef.current.size > 0;
    if (hadRows) {
      captureLayoutAnchor();
    }

    measuredRowHeightsRef.current.clear();
    if (hadRows) {
      setMeasurementVersion((current) => current + 1);
    }
  }, [structuralKey]);

  const previousTabDisplaySizeRef = useRef(tabDisplaySize);
  useEffect(() => {
    if (previousTabDisplaySizeRef.current === tabDisplaySize) {
      return;
    }

    previousTabDisplaySizeRef.current = tabDisplaySize;
    captureLayoutAnchor();
    measuredRowHeightsRef.current.clear();
    measuredTypeHeightsRef.current = {};
    setMeasurementVersion((current) => current + 1);
  }, [tabDisplaySize, captureLayoutAnchor]);

  useEffect(() => {
    const currentSession = pointerDragSessionRef.current;
    if (currentSession.phase !== "idle" && !rowKeySet.has(currentSession.source.rowKey)) {
      commitDragSession({ phase: "idle" });
    }
  }, [commitDragSession, rowKeySet]);

  useEffect(() => {
    if (dragRenderProjection.phase !== "dragging") {
      stopAutoScroll();
      return;
    }

    scheduleAutoScroll();
    return stopAutoScroll;
  }, [dragRenderProjection.phase, scheduleAutoScroll, stopAutoScroll]);

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  // 兜底：拖拽源行可能因虚拟化被回收导致 pointer capture 丢失；
  // 若指针在列表外释放，行/根节点都收不到事件，这里统一收尾，避免会话卡在 dragging。
  useEffect(() => {
    if (dragRenderProjection.phase === "idle") {
      return;
    }

    const finishPointerSession = (event: PointerEvent): void => {
      const session = pointerDragSessionRef.current;
      if (session.phase === "idle" || session.pointerId !== event.pointerId) {
        return;
      }

      stopAutoScroll();
      const scrollContainer = scrollContainerRef.current;
      const releasedWithinContainer = scrollContainer != null
        && isPointerWithinContainerBounds({
          pointer: { x: event.clientX, y: event.clientY },
          containerRect: scrollContainer.getBoundingClientRect()
        });
      const pointerUpResult = resolvePointerUpResult({
        session,
        releasedWithinContainer,
        pointerId: event.pointerId
      });

      commitDragSession(pointerUpResult.nextSession);
      suppressPostDragClickRef.current = pointerUpResult.shouldSuppressPostDragClick;

      if (pointerUpResult.command) {
        dispatchDragCommand(pointerUpResult.command, {
          onMoveTab: handleMoveTabAction,
          onMoveTabs: handleMoveTabsAction,
          onMoveGroup: handleMoveGroupAction
        });
      }
    };

    const handleWindowPointerUp = (event: PointerEvent): void => {
      finishPointerSession(event);
    };
    const handleWindowPointerCancel = (event: PointerEvent): void => {
      const session = pointerDragSessionRef.current;
      if (session.phase === "idle" || session.pointerId !== event.pointerId) {
        return;
      }

      stopAutoScroll();
      commitDragSession(resolvePointerCancelResult({ session, pointerId: event.pointerId }).nextSession);
    };

    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerCancel);

    return () => {
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerCancel);
    };
  }, [dragRenderProjection.phase, commitDragSession, handleMoveGroupAction, handleMoveTabAction, handleMoveTabsAction, stopAutoScroll]);

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
    const currentLocateRequest = locateRequest;
    if (currentLocateRequest == null) {
      previousHandledLocateRequestIdRef.current = null;
      pendingLocatePulseRowKeyRef.current = null;
      pendingLocateSettleRef.current = null;
      return;
    }

    const hasTargetRow = layout.rowGeometry.has(currentLocateRequest.rowKey);
    if (!shouldHandleLocateRequest({
      locateRequest: currentLocateRequest,
      hasRenderedTargetRow: hasTargetRow,
      previousHandledRequestId: previousHandledLocateRequestIdRef.current
    })) {
      return;
    }

    previousHandledLocateRequestIdRef.current = currentLocateRequest.requestId;

    const scrollResult = scrollRowKeyIntoView(currentLocateRequest.rowKey, "smooth");
    if (!scrollResult.available) {
      return;
    }

    onTraceEventRef.current?.("list/scroll-to-locate-target", {
      rowKey: currentLocateRequest.rowKey,
      requestId: currentLocateRequest.requestId,
      scrollAdjustment: scrollResult.scrollAdjustment,
      rowTop: scrollResult.rowTop,
      rowBottom: scrollResult.rowBottom,
      topObstruction: scrollResult.topObstruction
    });

    if (rowRefs.current.has(currentLocateRequest.rowKey)) {
      setLocatePulseRowKey(currentLocateRequest.rowKey);
      pendingLocateSettleRef.current = null;
    } else {
      pendingLocatePulseRowKeyRef.current = currentLocateRequest.rowKey;
      pendingLocateSettleRef.current = {
        rowKey: currentLocateRequest.rowKey,
        lastLayout: layout
      };
    }
  }, [layout, locateRequest, scrollRowKeyIntoView]);

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
    const currentLayout = layout;
    const hasTargetRow = activeRowKey != null && currentLayout.rowGeometry.has(activeRowKey);
    const decision = resolveActiveRowAutoScroll({
      activeRowKey,
      hasActiveRowInList,
      hasRenderedTargetRow: hasTargetRow,
      hasCompletedInitialScroll: hasCompletedInitialScrollRef.current,
      previousScrolledRowKey: previousScrolledRowKeyRef.current,
      suppressedActiveRowKey: suppressedAutoScrollRowKeyRef.current
    });

    previousScrolledRowKeyRef.current = decision.nextPreviousScrolledRowKey;
    suppressedAutoScrollRowKeyRef.current = decision.nextSuppressedActiveRowKey;

    if (!decision.shouldScroll || activeRowKey == null) {
      return;
    }

    const scrollResult = scrollRowKeyIntoView(activeRowKey, "smooth");
    if (!scrollResult.available) {
      return;
    }

    onTraceEventRef.current?.("list/auto-scroll-to-active", {
      activeRowKey,
      scrollAdjustment: scrollResult.scrollAdjustment,
      rowTop: scrollResult.rowTop,
      rowBottom: scrollResult.rowBottom,
      topObstruction: scrollResult.topObstruction
    });

    hasCompletedInitialScrollRef.current = true;
    previousScrolledRowKeyRef.current = activeRowKey;
    pendingActiveSettleRef.current = rowRefs.current.has(activeRowKey)
      ? null
      : { rowKey: activeRowKey, lastLayout: layout };
  }, [activeRowKey, hasActiveRowInList, layout, scrollRowKeyIntoView]);

  // 首帧估算滚动后的补正：只在实测高度刷新布局（layout 身份变化）后尝试一次。
  useLayoutEffect(() => {
    settlePendingRowScroll(pendingActiveSettleRef);
    settlePendingRowScroll(pendingLocateSettleRef);
  });

  useEffect(() => {
    if (!imperativeRef) {
      return;
    }

    imperativeRef.current = {
      scrollToRowKey: (rowKey: string): boolean => scrollRowKeyIntoView(rowKey, "auto").available
    };

    return () => {
      if (imperativeRef.current != null) {
        imperativeRef.current = null;
      }
    };
  }, [imperativeRef, scrollRowKeyIntoView]);

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

  const renderWindowHeader = (sectionPlan: VirtualRenderPlan["sections"][number]): ReactElement => {
    const { section } = sectionPlan;
    const isMeasuredSection = sectionPlan.sectionIndex === renderPlan.firstSectionIndex;

    return (
      <RowShell
        key={section.windowRow.key}
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
        extraClassName={getWindowSectionHeaderClassName({ measured: isMeasuredSection })}
        visuallyExpanded={searchActive && section.windowRow.collapsed}
        onHoveredTabChange={onHoveredTabChange}
      />
    );
  };

  const renderTabRow = (
    row: Extract<PanelRow, { kind: "tab" }>,
    options: {
      extraClassName?: string;
      groupedTabColor?: chrome.tabGroups.ColorEnum;
      isCurrentActive?: boolean;
      isWindowActive?: boolean;
    } = {}
  ): ReactElement => (
    <RowShell
      key={row.key}
      locale={locale}
      row={row}
      rowRefs={rowRefs}
      isCurrentActive={options.isCurrentActive ?? (row.tab.id === currentActiveTabId)}
      isWindowActive={options.isWindowActive ?? (row.tab.active && row.tab.id !== currentActiveTabId)}
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
      extraClassName={options.extraClassName}
      groupedTabColor={options.groupedTabColor}
      isDragging={draggedRowKey === row.key}
      dropIndicator={getDropIndicator(row.key)}
      onPointerDown={handlePointerDown}
      onPointerEnter={handlePointerEnter}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onHoveredTabChange={onHoveredTabChange}
    />
  );

  const renderGroupBlock = (itemPlan: VirtualItemRenderPlan): ReactElement => {
    const { item, group } = itemPlan;

    if (item.type !== "group") {
      return <Fragment key={item.row.key} />;
    }

    return (
      <div
        key={item.row.key}
        className={`group-block group-block--${item.row.color}${
          item.row.collapsed ? " group-block--collapsed" : ""
        }${draggedRowKey === item.row.key ? " group-block--dragging" : ""}`}
      >
        <RowShell
          locale={locale}
          row={item.row}
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
          isDragging={draggedRowKey === item.row.key}
          dropIndicator={getDropIndicator(item.row.key)}
          onPointerDown={handlePointerDown}
          onPointerEnter={handlePointerEnter}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onHoveredTabChange={onHoveredTabChange}
        />
        {item.hasBody ? (
          <div className="group-block__body">
            {group != null && group.topSpacerHeight > 0 ? (
              <div
                aria-hidden="true"
                className="stack-list__virtual-spacer"
                style={{ height: `${group.topSpacerHeight}px` }}
              />
            ) : null}
            {group == null || group.first < 0
              ? null
              : item.children.slice(group.first, group.last + 1).map((childRow, offset) => {
                  const childIndex = group.first + offset;
                  return renderTabRow(childRow.row, {
                    extraClassName: `group-block__item${
                      childIndex === item.children.length - 1 ? " group-block__item--last" : ""
                    }`,
                    groupedTabColor: item.row.color
                  });
                })}
            {group != null && group.bottomSpacerHeight > 0 ? (
              <div
                aria-hidden="true"
                className="stack-list__virtual-spacer"
                style={{ height: `${group.bottomSpacerHeight}px` }}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  // content-visibility 占位高度对齐实测行高：overscan 内被浏览器跳过的行按真实高度占位，
  // 避免虚拟 spacer 与 DOM 实际高度不一致导致滚动位置跳变。
  const measuredTabRowHeight = measuredTypeHeightsRef.current.tab;
  const measuredGroupHeaderHeight = measuredTypeHeightsRef.current.group;
  const virtualListStyle = {
    ...getStickyScrollStyle(windowStickyOffset),
    ...(measuredTabRowHeight != null
      ? { "--stack-item-intrinsic-size": `${measuredTabRowHeight}px` }
      : null),
    ...(measuredGroupHeaderHeight != null
      ? { "--group-header-intrinsic-size": `${measuredGroupHeaderHeight}px` }
      : null)
  } as React.CSSProperties;

  return (
    <div
      ref={listElementRef}
      className={getVirtualListClassName(tabDisplaySize)}
      role="tree"
      aria-label={translate(locale, "sidepanel.list.aria")}
      style={virtualListStyle}
      data-total-rows={rows.length}
      data-rendered-rows={renderPlan.renderedRowCount}
      onPointerDown={handleListPointerDown}
      onPointerLeave={handleListPointerLeave}
      onPointerMove={handleRootPointerMove}
      onPointerUp={handleRootPointerUp}
      onPointerCancel={handleRootPointerCancel}
      onClickCapture={handleListClickCapture}
      onBlur={handleListBlur}
    >
      <div className="stack-list">
        {renderPlan.topSpacerHeight > 0 ? (
          <div
            aria-hidden="true"
            className="stack-list__virtual-spacer"
            style={{ height: `${renderPlan.topSpacerHeight}px` }}
          />
        ) : null}
        {renderPlan.sections.map((sectionPlan) => (
          <Fragment key={sectionPlan.section.windowRow.key}>
            <section className="window-section">
              {renderWindowHeader(sectionPlan)}
              {sectionPlan.body != null ? (
                <div className="window-section__body">
                  {sectionPlan.body.topSpacerHeight > 0 ? (
                    <div
                      aria-hidden="true"
                      className="stack-list__virtual-spacer"
                      style={{ height: `${sectionPlan.body.topSpacerHeight}px` }}
                    />
                  ) : null}
                  {sectionPlan.body.items.map((itemPlan) =>
                    itemPlan.item.type === "single"
                      ? renderTabRow(itemPlan.item.row)
                      : renderGroupBlock(itemPlan)
                  )}
                  {sectionPlan.body.bottomSpacerHeight > 0 ? (
                    <div
                      aria-hidden="true"
                      className="stack-list__virtual-spacer"
                      style={{ height: `${sectionPlan.body.bottomSpacerHeight}px` }}
                    />
                  ) : null}
                </div>
              ) : null}
            </section>
            {sectionPlan.gapAfterHeight > 0 ? (
              <div
                aria-hidden="true"
                className="stack-list__virtual-spacer"
                style={{ height: `${sectionPlan.gapAfterHeight}px` }}
              />
            ) : null}
          </Fragment>
        ))}
        {renderPlan.bottomSpacerHeight > 0 ? (
          <div
            aria-hidden="true"
            className="stack-list__virtual-spacer"
            style={{ height: `${renderPlan.bottomSpacerHeight}px` }}
          />
        ) : null}
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
