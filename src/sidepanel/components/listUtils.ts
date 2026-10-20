import type {
  PanelRow,
  TabDisplaySize,
  WindowRenderSection
} from "../../shared/types";

export function getRowShellClassName(params: {
  extraClassName?: string;
}): string {
  const { extraClassName = "" } = params;

  return `stack-list__item${extraClassName ? ` ${extraClassName}` : ""}`;
}

export function getWindowRowClassName(params: {
  isFocused: boolean;
  visuallyExpanded?: boolean;
}): string {
  const { isFocused, visuallyExpanded = false } = params;

  return `window-row${isFocused ? " window-row--focused" : ""}${
    visuallyExpanded ? " window-row--visually-expanded" : ""
  }`;
}

export function getGroupRowClassName(params: {
  collapsed: boolean;
  visuallyExpanded?: boolean;
}): string {
  const { collapsed, visuallyExpanded = false } = params;

  return `group-row${collapsed && !visuallyExpanded ? " group-row--collapsed" : ""}${
    visuallyExpanded ? " group-row--visually-expanded" : ""
  }`;
}

export function getWindowSectionHeaderClassName(params: {
  measured: boolean;
}): string {
  const { measured } = params;

  return `window-section__header${measured ? " window-section__header--measured" : ""}`;
}

export function getStickyScrollStyle(windowStickyOffset: number): React.CSSProperties {
  return {
    "--window-sticky-offset": `${windowStickyOffset}px`
  } as React.CSSProperties;
}

export function getTabRowClassName(params: {
  isCurrentActive: boolean;
  isWindowActive: boolean;
  isGrouped: boolean;
  isSelected?: boolean;
  isClosing?: boolean;
  groupedTabColor?: chrome.tabGroups.ColorEnum;
  matchesSearch?: boolean;
  isLocatePulsing?: boolean;
}): string {
  const {
    isCurrentActive,
    isWindowActive,
    isGrouped,
    isSelected = false,
    isClosing = false,
    groupedTabColor,
    matchesSearch,
    isLocatePulsing = false
  } = params;

  return `tab-row${
    isCurrentActive ? " tab-row--current-active" : isWindowActive ? " tab-row--window-active" : ""
  }${groupedTabColor ? ` tab-row--grouped tab-row--grouped-${groupedTabColor}` : ""}${
    isCurrentActive && isGrouped ? " tab-row--grouped-current-active" : ""
  }${isSelected || matchesSearch ? " tab-row--selected" : ""}${isClosing ? " tab-row--closing" : ""}${
    matchesSearch === false ? " tab-row--unmatched" : ""
  }${isLocatePulsing ? " tab-row--locate-pulsing" : ""}`;
}

export function shouldScrollToActiveRow(params: {
  activeRowKey: string | null;
  hasActiveRowInList: boolean;
  hasRenderedTargetRow: boolean;
  hasCompletedInitialScroll: boolean;
  previousScrolledRowKey: string | null;
}): boolean {
  const {
    activeRowKey,
    hasActiveRowInList,
    hasRenderedTargetRow,
    hasCompletedInitialScroll,
    previousScrolledRowKey
  } = params;

  if (!activeRowKey || !hasActiveRowInList || !hasRenderedTargetRow) {
    return false;
  }

  return !hasCompletedInitialScroll || previousScrolledRowKey !== activeRowKey;
}

export function resolveActiveRowAutoScroll(params: {
  activeRowKey: string | null;
  hasActiveRowInList: boolean;
  hasRenderedTargetRow: boolean;
  hasCompletedInitialScroll: boolean;
  previousScrolledRowKey: string | null;
  suppressedActiveRowKey: string | null;
}): {
  shouldScroll: boolean;
  nextPreviousScrolledRowKey: string | null;
  nextSuppressedActiveRowKey: string | null;
} {
  const {
    activeRowKey,
    hasActiveRowInList,
    hasRenderedTargetRow,
    hasCompletedInitialScroll,
    previousScrolledRowKey,
    suppressedActiveRowKey
  } = params;

  if (!activeRowKey) {
    return {
      shouldScroll: false,
      nextPreviousScrolledRowKey: null,
      nextSuppressedActiveRowKey: null
    };
  }

  if (suppressedActiveRowKey === activeRowKey) {
    return {
      shouldScroll: false,
      nextPreviousScrolledRowKey: activeRowKey,
      nextSuppressedActiveRowKey: hasActiveRowInList ? null : suppressedActiveRowKey
    };
  }

  if (!hasActiveRowInList) {
    return {
      shouldScroll: false,
      nextPreviousScrolledRowKey: null,
      nextSuppressedActiveRowKey: suppressedActiveRowKey
    };
  }

  if (!hasRenderedTargetRow) {
    return {
      shouldScroll: false,
      nextPreviousScrolledRowKey: previousScrolledRowKey,
      nextSuppressedActiveRowKey: suppressedActiveRowKey
    };
  }

  const shouldScroll = shouldScrollToActiveRow({
    activeRowKey,
    hasActiveRowInList,
    hasRenderedTargetRow,
    hasCompletedInitialScroll,
    previousScrolledRowKey
  });

  return {
    shouldScroll,
    nextPreviousScrolledRowKey: shouldScroll ? activeRowKey : previousScrolledRowKey,
    nextSuppressedActiveRowKey: suppressedActiveRowKey
  };
}

export function calculateAnchorScrollAdjustment(params: {
  previousRowTop: number;
  nextRowTop: number;
}): number {
  const { previousRowTop, nextRowTop } = params;

  return nextRowTop - previousRowTop;
}

export function calculateRequiredBottomSpacer(params: {
  desiredScrollTop: number;
  maxScrollTop: number;
}): number {
  const { desiredScrollTop, maxScrollTop } = params;

  return Math.max(0, Math.ceil(desiredScrollTop - maxScrollTop));
}

export function canReleaseBottomSpacer(params: {
  currentScrollTop: number;
  maxScrollTop: number;
  bottomSpacerHeight: number;
}): boolean {
  const { currentScrollTop, maxScrollTop, bottomSpacerHeight } = params;

  if (bottomSpacerHeight <= 0) {
    return false;
  }

  const distanceToBottom = Math.max(0, maxScrollTop - currentScrollTop);
  return distanceToBottom >= bottomSpacerHeight;
}

export function calculateStickyHeaderObstruction(params: {
  windowHeaderHeight: number;
  groupHeaderHeight: number | null;
  groupHeaderOverlap: number | null;
}): number {
  const { windowHeaderHeight, groupHeaderHeight, groupHeaderOverlap } = params;

  return Math.max(0, windowHeaderHeight) + Math.max(0, (groupHeaderHeight ?? 0) - (groupHeaderOverlap ?? 0));
}

export function calculateTargetRowScrollAdjustment(params: {
  rowTop: number;
  rowBottom: number;
  containerHeight: number;
  topObstruction: number;
}): number {
  const { rowTop, rowBottom, containerHeight, topObstruction } = params;
  const visibleHeight = Math.max(0, containerHeight - topObstruction);
  const desiredRowCenter = topObstruction + visibleHeight / 2;
  const rowCenter = (rowTop + rowBottom) / 2;

  return rowCenter - desiredRowCenter;
}

export function shouldPulseLocateRow(params: {
  locateRequest: {
    rowKey: string;
    requestId: number;
  } | null;
  hasRenderedTargetRow: boolean;
}): boolean {
  const { locateRequest, hasRenderedTargetRow } = params;
  return locateRequest != null && hasRenderedTargetRow;
}

export function shouldHandleLocateRequest(params: {
  locateRequest: {
    rowKey: string;
    requestId: number;
  } | null;
  hasRenderedTargetRow: boolean;
  previousHandledRequestId: number | null;
}): boolean {
  const { locateRequest, hasRenderedTargetRow, previousHandledRequestId } = params;

  return (
    locateRequest != null
    && hasRenderedTargetRow
    && locateRequest.requestId !== previousHandledRequestId
  );
}

export function getVirtualListClassName(tabDisplaySize: TabDisplaySize): string {
  return `virtual-list virtual-list--${tabDisplaySize}`;
}

export function getRowTopWithinContainer(rowNode: HTMLDivElement, scrollContainer: HTMLDivElement): number {
  return rowNode.getBoundingClientRect().top - scrollContainer.getBoundingClientRect().top;
}

export function getActiveRowTopObstruction(rowNode: HTMLDivElement): number {
  const windowSection = rowNode.closest(".window-section");
  const windowHeader = windowSection?.querySelector<HTMLDivElement>(".window-section__header") ?? null;
  const groupBlock = rowNode.closest(".group-block");
  const groupHeader = groupBlock?.querySelector<HTMLDivElement>(".group-block__header") ?? null;

  const groupHeaderOverlap =
    groupHeader == null
      ? null
      : normalizePixelValue(window.getComputedStyle(groupHeader).paddingTop);

  return calculateStickyHeaderObstruction({
    windowHeaderHeight: windowHeader?.getBoundingClientRect().height ?? 0,
    groupHeaderHeight: groupHeader?.getBoundingClientRect().height ?? null,
    groupHeaderOverlap
  });
}

function normalizePixelValue(value: string): number | null {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function getPointerRatio(event: React.DragEvent<HTMLElement>): number {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.height <= 0) {
    return 0.5;
  }

  return (event.clientY - rect.top) / rect.height;
}

// ── Virtual list layout ───────────────────────────────────────────────
//
// 把 renderSections 展开成"带累计偏移"的层级布局（窗口段 / 组块 / 行），
// 渲染时只取可见区间 ± overscan，用上下 spacer 占位保持 scrollHeight 稳定。
// 本区域全部是纯函数（不读 DOM），便于单测：区间、偏移映射、二分命中。

export type VirtualRowHeightKind = "window" | "group" | "tab";

export interface VirtualListMetrics {
  tabRowHeight: number;
  windowHeaderHeight: number;
  groupHeaderHeight: number;
  sectionGap: number;
  bodyGap: number;
  bodyPaddingTop: number;
  groupBodyBorderBottom: number;
  groupBlockMarginBottom: number;
  overscanPx: number;
}

export const VIRTUAL_LIST_OVERSCAN_PX = 300;
export const DEFAULT_VIRTUAL_VIEWPORT_HEIGHT_PX = 600;
const VIRTUAL_LIST_SECTION_GAP_PX = 6;
const VIRTUAL_LIST_BODY_GAP_PX = 4;
const VIRTUAL_LIST_BODY_PADDING_TOP_PX = 2;
const VIRTUAL_LIST_GROUP_BODY_BORDER_BOTTOM_PX = 2;
const VIRTUAL_LIST_GROUP_BLOCK_MARGIN_BOTTOM_PX = 4;

/**
 * 估算高度与 styles.css 中 `--stack-item-intrinsic-size` 的分档保持一致
 * （大 40 / 中 38 / 小 30）；窗口头/组头按各自 CSS 盒模型估算，首帧实测后被覆盖。
 */
export function getVirtualListMetrics(tabDisplaySize: TabDisplaySize): VirtualListMetrics {
  const bySize: Record<TabDisplaySize, Pick<VirtualListMetrics, "tabRowHeight" | "windowHeaderHeight" | "groupHeaderHeight">> = {
    large: { tabRowHeight: 40, windowHeaderHeight: 52, groupHeaderHeight: 34 },
    medium: { tabRowHeight: 38, windowHeaderHeight: 45, groupHeaderHeight: 28 },
    small: { tabRowHeight: 30, windowHeaderHeight: 39, groupHeaderHeight: 25 }
  };
  const sizeMetrics = bySize[tabDisplaySize];

  return {
    ...sizeMetrics,
    sectionGap: VIRTUAL_LIST_SECTION_GAP_PX,
    bodyGap: VIRTUAL_LIST_BODY_GAP_PX,
    bodyPaddingTop: VIRTUAL_LIST_BODY_PADDING_TOP_PX,
    groupBodyBorderBottom: VIRTUAL_LIST_GROUP_BODY_BORDER_BOTTOM_PX,
    groupBlockMarginBottom: VIRTUAL_LIST_GROUP_BLOCK_MARGIN_BOTTOM_PX,
    overscanPx: VIRTUAL_LIST_OVERSCAN_PX
  };
}

export interface VirtualRowGeometry {
  top: number;
  height: number;
  kind: VirtualRowHeightKind;
}

export interface VirtualListSingleItem {
  type: "single";
  row: Extract<PanelRow, { kind: "tab" }>;
  top: number;
  height: number;
}

export interface VirtualGroupChildRow {
  row: Extract<PanelRow, { kind: "tab" }>;
  top: number;
  height: number;
}

export interface VirtualListGroupItem {
  type: "group";
  row: Extract<PanelRow, { kind: "group" }>;
  top: number;
  height: number;
  headerHeight: number;
  bodyTop: number;
  bodyHeight: number;
  hasBody: boolean;
  children: VirtualGroupChildRow[];
}

export type VirtualListBodyItem = VirtualListSingleItem | VirtualListGroupItem;

export interface VirtualSectionBodyLayout {
  top: number;
  height: number;
  paddingTop: number;
  gap: number;
  items: VirtualListBodyItem[];
}

export interface VirtualSectionLayout {
  windowRow: Extract<PanelRow, { kind: "window" }>;
  top: number;
  height: number;
  headerHeight: number;
  body: VirtualSectionBodyLayout | null;
}

export interface VirtualListLayout {
  metrics: VirtualListMetrics;
  sections: VirtualSectionLayout[];
  rowGeometry: Map<string, VirtualRowGeometry>;
  rowByKey: Map<string, PanelRow>;
  totalHeight: number;
  rowCount: number;
}

function resolveVirtualRowHeight(params: {
  rowKey: string;
  kind: VirtualRowHeightKind;
  fallback: number;
  measuredRowHeights?: ReadonlyMap<string, number>;
  measuredTypeHeights?: Partial<Record<VirtualRowHeightKind, number>>;
}): number {
  const { rowKey, kind, fallback, measuredRowHeights, measuredTypeHeights } = params;
  const perRowHeight = measuredRowHeights?.get(rowKey);
  if (perRowHeight != null && Number.isFinite(perRowHeight) && perRowHeight > 0) {
    return Math.round(perRowHeight);
  }

  const typeHeight = measuredTypeHeights?.[kind];
  if (typeHeight != null && Number.isFinite(typeHeight) && typeHeight > 0) {
    return Math.round(typeHeight);
  }

  return Math.round(fallback);
}

export function buildVirtualListLayout(params: {
  renderSections: readonly WindowRenderSection[];
  metrics: VirtualListMetrics;
  searchActive: boolean;
  measuredRowHeights?: ReadonlyMap<string, number>;
  measuredTypeHeights?: Partial<Record<VirtualRowHeightKind, number>>;
}): VirtualListLayout {
  const { renderSections, metrics, searchActive } = params;
  const sections: VirtualSectionLayout[] = [];
  const rowGeometry = new Map<string, VirtualRowGeometry>();
  const rowByKey = new Map<string, PanelRow>();
  let cursor = 0;

  const resolveHeight = (rowKey: string, kind: VirtualRowHeightKind, fallback: number): number =>
    resolveVirtualRowHeight({
      rowKey,
      kind,
      fallback,
      measuredRowHeights: params.measuredRowHeights,
      measuredTypeHeights: params.measuredTypeHeights
    });

  for (let sectionIndex = 0; sectionIndex < renderSections.length; sectionIndex += 1) {
    const section = renderSections[sectionIndex]!;
    const windowRow = section.windowRow;
    const headerHeight = resolveHeight(windowRow.key, "window", metrics.windowHeaderHeight);
    const sectionTop = cursor;

    rowByKey.set(windowRow.key, windowRow);
    rowGeometry.set(windowRow.key, { top: sectionTop, height: headerHeight, kind: "window" });

    const bodyVisible = searchActive || !windowRow.collapsed;
    let body: VirtualSectionBodyLayout | null = null;
    let sectionHeight = headerHeight;

    if (bodyVisible) {
      const bodyTop = sectionTop + headerHeight;
      const items: VirtualListBodyItem[] = [];
      let itemCursor = bodyTop + metrics.bodyPaddingTop;

      for (let itemIndex = 0; itemIndex < section.items.length; itemIndex += 1) {
        const item = section.items[itemIndex]!;

        if (item.kind === "single" && item.row.kind === "tab") {
          const row = item.row;
          const height = resolveHeight(row.key, "tab", metrics.tabRowHeight);
          rowByKey.set(row.key, row);
          rowGeometry.set(row.key, { top: itemCursor, height, kind: "tab" });
          items.push({ type: "single", row, top: itemCursor, height });
          itemCursor += height;
        } else if (item.kind === "group-block") {
          const groupRow = item.groupRow;
          const groupHeaderHeight = resolveHeight(groupRow.key, "group", metrics.groupHeaderHeight);
          const groupTop = itemCursor;
          const bodyTop = groupTop + groupHeaderHeight;
          const childrenVisible = searchActive || !groupRow.collapsed;
          const children: VirtualGroupChildRow[] = [];
          let bodyHeight = 0;
          let childCursor = bodyTop;

          if (childrenVisible) {
            for (let childIndex = 0; childIndex < item.childRows.length; childIndex += 1) {
              const childRow = item.childRows[childIndex]!;
              const childHeight = resolveHeight(childRow.key, "tab", metrics.tabRowHeight);
              rowByKey.set(childRow.key, childRow);
              rowGeometry.set(childRow.key, { top: childCursor, height: childHeight, kind: "tab" });
              children.push({ row: childRow, top: childCursor, height: childHeight });
              childCursor += childHeight;
            }
            bodyHeight = metrics.groupBodyBorderBottom + (childCursor - bodyTop);
          }

          const groupHeight = groupHeaderHeight + bodyHeight + metrics.groupBlockMarginBottom;
          rowByKey.set(groupRow.key, groupRow);
          rowGeometry.set(groupRow.key, { top: groupTop, height: groupHeaderHeight, kind: "group" });
          items.push({
            type: "group",
            row: groupRow,
            top: groupTop,
            height: groupHeight,
            headerHeight: groupHeaderHeight,
            bodyTop,
            bodyHeight,
            hasBody: childrenVisible,
            children
          });
          itemCursor = groupTop + groupHeight;
        }

        if (itemIndex < section.items.length - 1) {
          itemCursor += metrics.bodyGap;
        }
      }

      const bodyHeight = itemCursor - bodyTop;
      body = {
        top: bodyTop,
        height: bodyHeight,
        paddingTop: metrics.bodyPaddingTop,
        gap: metrics.bodyGap,
        items
      };
      sectionHeight = headerHeight + bodyHeight;
    }

    sections.push({
      windowRow,
      top: sectionTop,
      height: sectionHeight,
      headerHeight,
      body
    });

    cursor = sectionTop + sectionHeight;
    if (sectionIndex < renderSections.length - 1) {
      cursor += metrics.sectionGap;
    }
  }

  return {
    metrics,
    sections,
    rowGeometry,
    rowByKey,
    totalHeight: cursor,
    rowCount: rowGeometry.size
  };
}

export interface VirtualVisibleRange {
  first: number;
  last: number;
}

/** 二分：第一个 bottom > windowStart 的下标；没有则 -1。 */
function findFirstEntryEndingAfter(entries: readonly { top: number; height: number }[], windowStart: number): number {
  let low = 0;
  let high = entries.length;

  while (low < high) {
    const mid = (low + high) >> 1;
    const entry = entries[mid]!;
    if (entry.top + entry.height > windowStart) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  return low >= entries.length ? -1 : low;
}

/** 二分：最后一个 top < windowEnd 的下标；没有则 -1。 */
function findLastEntryStartingBefore(entries: readonly { top: number; height: number }[], windowEnd: number): number {
  let low = 0;
  let high = entries.length;

  while (low < high) {
    const mid = (low + high) >> 1;
    if (entries[mid]!.top < windowEnd) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low - 1;
}

/**
 * 在按 top 升序排列的 entries 中二分出与 [windowStart, windowEnd) 相交的闭区间。
 * 空区间返回 { first: -1, last: -1 }。
 */
export function findVisibleRange(
  entries: readonly { top: number; height: number }[],
  windowStart: number,
  windowEnd: number
): VirtualVisibleRange {
  if (entries.length === 0 || !(windowEnd > windowStart)) {
    return { first: -1, last: -1 };
  }

  const first = findFirstEntryEndingAfter(entries, windowStart);
  if (first < 0) {
    return { first: -1, last: -1 };
  }

  const last = findLastEntryStartingBefore(entries, windowEnd);
  if (last < first) {
    return { first: -1, last: -1 };
  }

  return { first, last };
}

/**
 * 计算"渲染切片"上下 spacer 高度，使渲染后 DOM 高度 = 完整内容高度。
 *
 * 推导：完整内容 = Σ高度 + gap*(N-1)；渲染内容 = Σ渲染高度 + spacerTotal + gap*(R-1)，
 * R = 渲染条目数（含 spacer）。故 spacerTotal = 全量高度 - 渲染高度 - gap*(R-1)。
 * 上 spacer 取自然偏移，剩余分配给下 spacer；为负时回填上 spacer。
 */
export function calculateVirtualSliceSpacers(params: {
  entries: readonly { top: number; height: number }[];
  firstIndex: number;
  lastIndex: number;
  gap: number;
}): { topSpacerHeight: number; bottomSpacerHeight: number } {
  const { entries, gap } = params;

  if (entries.length === 0) {
    return { topSpacerHeight: 0, bottomSpacerHeight: 0 };
  }

  const originTop = entries[0]!.top;
  const lastEntry = entries[entries.length - 1]!;
  const contentHeight = lastEntry.top + lastEntry.height - originTop;
  const firstIndex = params.firstIndex;
  const lastIndex = params.lastIndex;

  if (firstIndex < 0 || lastIndex < firstIndex) {
    // 一个条目都没渲染：用一个 spacer 顶住全部内容，避免两个 spacer 之间多出一个 gap。
    return { topSpacerHeight: contentHeight, bottomSpacerHeight: 0 };
  }

  const renderedCount = lastIndex - firstIndex + 1;
  let renderedHeights = 0;
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    renderedHeights += entries[index]!.height;
  }

  const hasTopSpacer = firstIndex > 0;
  const hasBottomSpacer = lastIndex < entries.length - 1;
  const spacerCount = (hasTopSpacer ? 1 : 0) + (hasBottomSpacer ? 1 : 0);
  const spacerTotal = Math.max(
    0,
    contentHeight - renderedHeights - gap * (renderedCount + spacerCount - 1)
  );

  if (spacerCount === 0) {
    return { topSpacerHeight: 0, bottomSpacerHeight: 0 };
  }

  if (!hasTopSpacer) {
    return { topSpacerHeight: 0, bottomSpacerHeight: spacerTotal };
  }

  const naturalTop = entries[firstIndex]!.top - originTop;
  if (!hasBottomSpacer) {
    return { topSpacerHeight: spacerTotal, bottomSpacerHeight: 0 };
  }

  // 上下都有 spacer 时，DOM 里第一个条目前面会多出一个 grid gap；把上 spacer 减掉
  // 一个 gap（补到下 spacer），让首个渲染条目仍落在布局偏移 naturalTop 上，避免滚动切片换挡时 1~gap px 抖动。
  const alignedTop = Math.max(0, naturalTop - gap);
  const bottomSpacerHeight = spacerTotal - alignedTop;
  if (bottomSpacerHeight < 0) {
    return { topSpacerHeight: Math.max(0, alignedTop + bottomSpacerHeight), bottomSpacerHeight: 0 };
  }

  return { topSpacerHeight: alignedTop, bottomSpacerHeight };
}

export interface VirtualGroupChildSlice {
  first: number;
  last: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
}

export interface VirtualItemRenderPlan {
  item: VirtualListBodyItem;
  group: VirtualGroupChildSlice | null;
}

export interface VirtualSectionBodyRenderPlan {
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  items: VirtualItemRenderPlan[];
}

export interface VirtualSectionRenderPlan {
  sectionIndex: number;
  section: VirtualSectionLayout;
  body: VirtualSectionBodyRenderPlan | null;
  /** 与下一个已渲染 section 之间需要补的 gap（列表内部已含 sectionGap）。 */
  gapAfterHeight: number;
}

export interface VirtualRenderPlan {
  layout: VirtualListLayout;
  sections: VirtualSectionRenderPlan[];
  topSpacerHeight: number;
  bottomSpacerHeight: number;
  renderedRowCount: number;
  totalRowCount: number;
  firstSectionIndex: number;
  lastSectionIndex: number;
  signature: string;
}

function buildVirtualRenderSignature(plan: Omit<VirtualRenderPlan, "signature">): string {
  const parts: string[] = [
    `t${plan.totalRowCount}:r${plan.renderedRowCount}:s${plan.topSpacerHeight}/${plan.bottomSpacerHeight}`
  ];

  for (const sectionPlan of plan.sections) {
    if (!sectionPlan.body) {
      parts.push(`${sectionPlan.sectionIndex}:x`);
      continue;
    }

    const itemParts = sectionPlan.body.items.map((itemPlan) => {
      if (itemPlan.group == null) {
        return "1";
      }

      return `g${itemPlan.group.first},${itemPlan.group.last},${itemPlan.group.topSpacerHeight},${itemPlan.group.bottomSpacerHeight}`;
    });
    parts.push(
      `${sectionPlan.sectionIndex}:${sectionPlan.body.topSpacerHeight},${sectionPlan.body.bottomSpacerHeight}:${itemParts.join(";")}:${sectionPlan.gapAfterHeight}`
    );
  }

  return parts.join("|");
}

export function resolveVirtualRenderPlan(params: {
  layout: VirtualListLayout;
  visibleTop: number;
  viewportHeight: number;
  overscanPx?: number;
}): VirtualRenderPlan {
  const { layout } = params;
  const overscan = Math.max(0, params.overscanPx ?? layout.metrics.overscanPx);
  const windowStart = params.visibleTop - overscan;
  const windowEnd = params.visibleTop + Math.max(0, params.viewportHeight) + overscan;
  const sections = layout.sections;

  if (sections.length === 0) {
    const emptyPlan: Omit<VirtualRenderPlan, "signature"> = {
      layout,
      sections: [],
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
      renderedRowCount: 0,
      totalRowCount: layout.rowCount,
      firstSectionIndex: -1,
      lastSectionIndex: -1
    };
    return { ...emptyPlan, signature: buildVirtualRenderSignature(emptyPlan) };
  }

  const sectionRange = findVisibleRange(sections, windowStart, windowEnd);

  if (sectionRange.first < 0) {
    const emptyPlan: Omit<VirtualRenderPlan, "signature"> = {
      layout,
      sections: [],
      topSpacerHeight: 0,
      bottomSpacerHeight: Math.max(0, Math.round(layout.totalHeight)),
      renderedRowCount: 0,
      totalRowCount: layout.rowCount,
      firstSectionIndex: -1,
      lastSectionIndex: -1
    };
    return { ...emptyPlan, signature: buildVirtualRenderSignature(emptyPlan) };
  }

  const sectionPlans: VirtualSectionRenderPlan[] = [];
  let renderedRowCount = 0;

  for (let sectionIndex = sectionRange.first; sectionIndex <= sectionRange.last; sectionIndex += 1) {
    const section = sections[sectionIndex]!;
    let body: VirtualSectionBodyRenderPlan | null = null;

    if (section.body != null) {
      const bodyItems = section.body.items;
      const itemRange = findVisibleRange(bodyItems, windowStart, windowEnd);
      const items: VirtualItemRenderPlan[] = [];
      const bodySpacers = calculateVirtualSliceSpacers({
        entries: bodyItems,
        firstIndex: itemRange.first,
        lastIndex: itemRange.last,
        gap: section.body.gap
      });

      if (itemRange.first >= 0) {
        for (let itemIndex = itemRange.first; itemIndex <= itemRange.last; itemIndex += 1) {
          const item = bodyItems[itemIndex]!;

          if (item.type === "single") {
            items.push({ item, group: null });
            renderedRowCount += 1;
            continue;
          }

          const childRange = findVisibleRange(item.children, windowStart, windowEnd);
          const childSpacers = calculateVirtualSliceSpacers({
            entries: item.children,
            firstIndex: childRange.first,
            lastIndex: childRange.last,
            gap: 0
          });
          const renderedChildCount = childRange.first >= 0 ? childRange.last - childRange.first + 1 : 0;
          items.push({
            item,
            group: {
              first: childRange.first,
              last: childRange.last,
              topSpacerHeight: Math.max(0, Math.round(childSpacers.topSpacerHeight)),
              bottomSpacerHeight: Math.max(0, Math.round(childSpacers.bottomSpacerHeight))
            }
          });
          renderedRowCount += 1 + renderedChildCount;
        }
      }

      body = {
        topSpacerHeight: Math.max(0, Math.round(bodySpacers.topSpacerHeight)),
        bottomSpacerHeight: Math.max(0, Math.round(bodySpacers.bottomSpacerHeight)),
        items
      };
    }

    renderedRowCount += 1;
    sectionPlans.push({
      sectionIndex,
      section,
      body,
      gapAfterHeight: 0
    });
  }

  for (let planIndex = 0; planIndex < sectionPlans.length - 1; planIndex += 1) {
    const currentSectionPlan = sectionPlans[planIndex]!;
    const nextSectionPlan = sectionPlans[planIndex + 1]!;
    currentSectionPlan.gapAfterHeight = Math.max(
      0,
      Math.round(nextSectionPlan.section.top - (currentSectionPlan.section.top + currentSectionPlan.section.height))
    );
  }

  const firstSection = sections[sectionRange.first]!;
  const lastSection = sections[sectionRange.last]!;
  const draftPlan: Omit<VirtualRenderPlan, "signature"> = {
    layout,
    sections: sectionPlans,
    topSpacerHeight: Math.max(0, Math.round(firstSection.top)),
    bottomSpacerHeight: Math.max(0, Math.round(layout.totalHeight - (lastSection.top + lastSection.height))),
    renderedRowCount,
    totalRowCount: layout.rowCount,
    firstSectionIndex: sectionRange.first,
    lastSectionIndex: sectionRange.last
  };

  return { ...draftPlan, signature: buildVirtualRenderSignature(draftPlan) };
}

/** 二分找到 offset 所在的 section 下标（用于定位时的粘性窗口头遮挡估算）。 */
export function findSectionIndexForOffset(layout: VirtualListLayout, offset: number): number {
  const sections = layout.sections;
  if (sections.length === 0) {
    return -1;
  }

  let low = 0;
  let high = sections.length - 1;
  let result = 0;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const section = sections[mid]!;
    if (section.top <= offset) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

/**
 * 目标行上方粘性窗口头的高度估算：定位/自动滚动时把目标行算在遮挡区下方。
 * （组头当前没有 sticky，故只算窗口头。）
 */
export function resolveVirtualRowTopObstruction(layout: VirtualListLayout, rowKey: string): number {
  const geometry = layout.rowGeometry.get(rowKey);
  if (geometry == null) {
    return 0;
  }

  const sectionIndex = findSectionIndexForOffset(layout, geometry.top);
  return layout.sections[sectionIndex]?.headerHeight ?? 0;
}

/**
 * 结构签名：搜索条件 / 折叠状态 / 窗口顺序 / 窗口与组内行数变化时变化，
 * 用于让实测高度缓存失效（行高是按类型缓存的，结构变化时重新校准更安全）。
 */
export function getVirtualListStructuralKey(params: {
  renderSections: readonly WindowRenderSection[];
  searchActive: boolean;
  tabDisplaySize: TabDisplaySize;
}): string {
  const parts: string[] = [
    params.searchActive ? "search" : "plain",
    params.tabDisplaySize
  ];

  for (const section of params.renderSections) {
    parts.push(
      `w:${section.windowRow.key}:${section.windowRow.collapsed ? "c" : "e"}:${section.items.length}`
    );
    for (const item of section.items) {
      parts.push(
        item.kind === "single"
          ? `s:${item.row.key}`
          : `g:${item.groupRow.key}:${item.groupRow.collapsed ? "c" : "e"}:${item.childRows.length}`
      );
    }
  }

  return parts.join("|");
}
