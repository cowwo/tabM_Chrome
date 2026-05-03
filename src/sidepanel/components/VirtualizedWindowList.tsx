import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { translate, type SupportedLocale } from "../../shared/i18n";
import type { PanelRow, TabDisplaySize, WindowRenderSection } from "../../shared/types";
import type { DragSource, DropTarget } from "./listDrag";
import { buildDragCommand, buildFallbackDragCommand, createDragSource, createSelectedTabsDragSource, resolveDropTarget } from "./listDrag";
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
  const dragSourceRef = useRef<DragSource | null>(null);
  const pendingManualAnchorRef = useRef<{
    rowKey: string;
    previousRowTop: number;
  } | null>(null);
  const [bottomSpacerHeight, setBottomSpacerHeight] = useState(0);
  const [dragSource, setDragSource] = useState<DragSource | null>(null);
  dragSourceRef.current = dragSource;
  const lastResolvedDropTargetRef = useRef<DropTarget | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [windowStickyOffset, setWindowStickyOffset] = useState(0);
  const [measuredWindowHeaderNode, setMeasuredWindowHeaderNode] = useState<HTMLDivElement | null>(null);
  const [locatePulseRowKey, setLocatePulseRowKey] = useState<string | null>(null);
  const previousHandledLocateRequestIdRef = useRef<number | null>(null);
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
    if (dragSource && !rowKeySet.has(dragSource.rowKey)) {
      setDragSource(null);
      setDropTarget(null);
    }
  }, [dragSource, rowKeySet]);

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

  const clearDragState = useCallback((): void => {
    lastResolvedDropTargetRef.current = null;
    setDragSource(null);
    setDropTarget(null);
  }, []);

  const handleDragStart = useCallback((row: PanelRow, event: React.DragEvent<HTMLElement>): void => {
    if (disabled) {
      event.preventDefault();
      return;
    }

    const currentSelectedTabIds = selectedTabIdsRef.current;
    if (row.kind === "tab" && !currentSelectedTabIds.has(row.tab.id) && currentSelectedTabIds.size > 0) {
      handleClearSelection();
    }

    const selectedTabsSource =
      row.kind === "tab" && currentSelectedTabIds.has(row.tab.id)
        ? createSelectedTabsDragSource({
            row,
            rows: rowsRef.current,
            selectedTabIds: currentSelectedTabIds
          })
        : null;

    if (row.kind === "tab" && currentSelectedTabIds.has(row.tab.id) && currentSelectedTabIds.size > 1 && !selectedTabsSource) {
      event.preventDefault();
      return;
    }

    const source = selectedTabsSource ?? createDragSource(row);
    if (!source) {
      event.preventDefault();
      return;
    }

    onTraceEventRef.current?.("list/drag-start", {
      rowKey: row.key,
      rowKind: row.kind,
      source
    });

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", row.key);
    dragSourceRef.current = source;
    lastResolvedDropTargetRef.current = null;
    setDragSource(source);
    setDropTarget(null);
  }, [disabled, handleClearSelection]);

  const handleDragOver = useCallback((row: PanelRow, event: React.DragEvent<HTMLElement>): void => {
    const currentDragSource = dragSourceRef.current;
    if (disabled || !currentDragSource) {
      return;
    }

    const target = resolveDropTarget({
      source: currentDragSource,
      targetRow: row,
      pointerRatio: getPointerRatio(event)
    });

    if (!target) {
      event.preventDefault();
      setDropTarget(null);
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    lastResolvedDropTargetRef.current = target;
    setDropTarget((current) =>
      current
      && current.rowKey === target.rowKey
      && current.indicator === target.indicator
      && current.targetWindowId === target.targetWindowId
      && current.targetIndex === target.targetIndex
      && current.targetGroupId === target.targetGroupId
        ? current
        : target
    );
  }, [disabled]);

  const handleDrop = useCallback((row: PanelRow, event: React.DragEvent<HTMLElement>): void => {
    const currentDragSource = dragSourceRef.current;
    if (disabled || !currentDragSource) {
      return;
    }

    const target = resolveDropTarget({
      source: currentDragSource,
      targetRow: row,
      pointerRatio: getPointerRatio(event)
    });

    const command = target
      ? buildDragCommand({
          source: currentDragSource,
          target
        })
      : buildFallbackDragCommand({
          source: currentDragSource,
          lastTarget: lastResolvedDropTargetRef.current
        });

    if (!target && !command) {
      clearDragState();
      return;
    }

    event.preventDefault();
    onTraceEventRef.current?.("list/drop", {
      rowKey: row.key,
      rowKind: row.kind,
      dragSource: currentDragSource,
      target,
      fallbackTarget: target == null ? lastResolvedDropTargetRef.current : null,
      command
    });
    clearDragState();

    if (!command) {
      return;
    }

    if (command.type === "tab/move") {
      handleMoveTabAction(command);
      return;
    }

    if (command.type === "tabs/move") {
      handleMoveTabsAction(command);
      return;
    }

    handleMoveGroupAction(command);
  }, [clearDragState, disabled, handleMoveGroupAction, handleMoveTabAction, handleMoveTabsAction]);

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
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
          return;
        }

        onHoveredTabChange?.(null);
      }}
      onDragEnd={clearDragState}
      onDrop={(event) => {
        event.preventDefault();
        clearDragState();
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
              isDragging={dragSource?.rowKey === section.windowRow.key}
              dropIndicator={dropTarget?.rowKey === section.windowRow.key ? dropTarget.indicator : null}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
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
                      isDragging={dragSource?.rowKey === item.row.key}
                      dropIndicator={dropTarget?.rowKey === item.row.key ? dropTarget.indicator : null}
                      onDragStart={handleDragStart}
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                      onHoveredTabChange={onHoveredTabChange}
                    />
                  ) : (
                    <div
                      key={item.groupRow.key}
                      className={`group-block group-block--${item.groupRow.color}${
                        item.groupRow.collapsed ? " group-block--collapsed" : ""
                      }${
                        dragSource?.kind === "group" && dragSource.groupId === item.groupRow.groupId
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
                        isDragging={dragSource?.rowKey === item.groupRow.key}
                        dropIndicator={dropTarget?.rowKey === item.groupRow.key ? dropTarget.indicator : null}
                        onDragStart={handleDragStart}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop}
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
                              isDragging={dragSource?.rowKey === row.key}
                              dropIndicator={dropTarget?.rowKey === row.key ? dropTarget.indicator : null}
                              onDragStart={handleDragStart}
                              onDragOver={handleDragOver}
                              onDrop={handleDrop}
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

function getPointerRatio(event: React.DragEvent<HTMLElement>): number {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.height <= 0) {
    return 0.5;
  }

  return (event.clientY - rect.top) / rect.height;
}
