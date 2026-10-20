import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NO_TAB_GROUP_ID } from "../src/shared/defaults";
import { buildWindowRenderSections } from "../src/shared/domain/selectors";
import type {
  PanelRow,
  TabRecord,
  WindowRenderItem,
  WindowRenderSection
} from "../src/shared/types";
import { VirtualizedWindowList } from "../src/sidepanel/components/VirtualizedWindowList";
import {
  buildVirtualListLayout,
  calculateVirtualSliceSpacers,
  findSectionIndexForOffset,
  findVisibleRange,
  getVirtualListMetrics,
  getVirtualListStructuralKey,
  resolveVirtualRenderPlan,
  resolveVirtualRowTopObstruction,
  type VirtualListLayout,
  type VirtualRenderPlan
} from "../src/sidepanel/components/listUtils";

// ── 测试数据工厂 ─────────────────────────────────────────────────────

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

type WindowRow = Extract<PanelRow, { kind: "window" }>;
type GroupRow = Extract<PanelRow, { kind: "group" }>;
type TabRow = Extract<PanelRow, { kind: "tab" }>;

function makeWindowRow(overrides: Partial<WindowRow> = {}): WindowRow {
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

function makeGroupRow(overrides: Partial<GroupRow> = {}): GroupRow {
  return {
    kind: "group",
    key: overrides.key ?? `group-${overrides.groupId ?? 10}`,
    windowId: overrides.windowId ?? 1,
    groupId: overrides.groupId ?? 10,
    title: overrides.title ?? `Group ${overrides.groupId ?? 10}`,
    color: overrides.color ?? "blue",
    collapsed: overrides.collapsed ?? false,
    totalCount: overrides.totalCount ?? 0,
    tabIds: overrides.tabIds ?? [],
    firstTabIndex: overrides.firstTabIndex ?? 0
  };
}

function makeTabRow(tab: TabRecord): TabRow {
  return {
    kind: "tab",
    key: `tab-${tab.id}`,
    windowId: tab.windowId,
    tab
  };
}

function makeTabRows(count: number, options: { windowId?: number; startId?: number } = {}): TabRow[] {
  const windowId = options.windowId ?? 1;
  const startId = options.startId ?? 1;
  return Array.from({ length: count }, (_, index) => {
    const tabId = startId + index;
    return makeTabRow(
      makeTab({
        id: tabId,
        windowId,
        index,
        title: `Tab ${tabId}`
      })
    );
  });
}

function makeWindowSectionsFromRows(rows: PanelRow[]): WindowRenderSection[] {
  return buildWindowRenderSections(rows);
}

/** 单个窗口 + N 个 tab 的线性 renderSections。 */
function makeSingleWindowSection(tabCount: number): WindowRenderSection {
  return {
    windowRow: makeWindowRow({ totalCount: tabCount }),
    items: makeTabRows(tabCount).map<WindowRenderItem>((row) => ({ kind: "single", row }))
  };
}

const MEDIUM_METRICS = getVirtualListMetrics("medium");

function buildLayout(renderSections: WindowRenderSection[], searchActive = false): VirtualListLayout {
  return buildVirtualListLayout({
    renderSections,
    metrics: MEDIUM_METRICS,
    searchActive
  });
}

function countRenderedRowsInMarkup(markup: string): number {
  return (markup.match(/class="stack-list__item/g) ?? []).length;
}

function parseRenderedRowsAttribute(markup: string): number | null {
  const match = markup.match(/data-rendered-rows="(\d+)"/);
  return match == null ? null : Number.parseInt(match[1]!, 10);
}

// ── 布局：偏移映射 ───────────────────────────────────────────────────

describe("virtual list layout", () => {
  it("maps a single window with tab rows to cumulative offsets", () => {
    const layout = buildLayout([makeSingleWindowSection(3)]);
    const section = layout.sections[0]!;

    // header 45 + body(paddingTop 2 + 38*3 + gap 4*2)
    expect(section.top).toBe(0);
    expect(section.headerHeight).toBe(45);
    expect(section.body?.top).toBe(45);
    expect(section.body?.height).toBe(124);
    expect(section.height).toBe(169);
    expect(layout.totalHeight).toBe(169);

    const firstTab = section.body!.items[0]!;
    const secondTab = section.body!.items[1]!;
    expect(firstTab.top).toBe(47);
    expect(secondTab.top).toBe(89);
    expect(layout.rowGeometry.get(firstTab.row.key)).toEqual({
      top: 47,
      height: 38,
      kind: "tab"
    });
  });

  it("keeps section gap between window sections and excludes it from the last section", () => {
    const sections = [makeSingleWindowSection(1), makeSingleWindowSection(1)];
    const layout = buildLayout(sections);

    expect(layout.sections[0]!.height).toBe(45 + 2 + 38);
    // 下一个 section 顶部 = 上一段高度 + sectionGap(6)
    expect(layout.sections[1]!.top).toBe(layout.sections[0]!.height + 6);
    expect(layout.totalHeight).toBe(
      layout.sections[0]!.height + 6 + layout.sections[1]!.height
    );
  });

  it("omits the body for a collapsed window, but keeps children when search is active", () => {
    const section: WindowRenderSection = {
      windowRow: makeWindowRow({ collapsed: true, totalCount: 2 }),
      items: makeTabRows(2).map<WindowRenderItem>((row) => ({ kind: "single", row }))
    };

    const collapsedLayout = buildLayout([section], false);
    expect(collapsedLayout.sections[0]!.body).toBeNull();
    expect(collapsedLayout.sections[0]!.height).toBe(45);
    expect(collapsedLayout.rowGeometry.size).toBe(1);

    const searchLayout = buildLayout([section], true);
    expect(searchLayout.sections[0]!.body).not.toBeNull();
    expect(searchLayout.sections[0]!.body!.items).toHaveLength(2);
    expect(searchLayout.rowGeometry.size).toBe(3);
  });

  it("lays out group blocks with header, body border, margin and child rows", () => {
    const childRows = makeTabRows(2, { startId: 101 });
    const section: WindowRenderSection = {
      windowRow: makeWindowRow({ totalCount: 2 }),
      items: [
        {
          kind: "group-block",
          groupRow: makeGroupRow({ groupId: 10, totalCount: 2, tabIds: [101, 102] }),
          childRows
        }
      ]
    };

    const layout = buildLayout([section]);
    const groupItem = layout.sections[0]!.body!.items[0]!;
    expect(groupItem.type).toBe("group");
    if (groupItem.type !== "group") {
      return;
    }

    expect(groupItem.top).toBe(47);
    expect(groupItem.headerHeight).toBe(28);
    expect(groupItem.bodyTop).toBe(75);
    // 两个 tab 38*2 + body 下边框 2
    expect(groupItem.bodyHeight).toBe(78);
    // 组块高度 = header + body + margin-bottom 4
    expect(groupItem.height).toBe(28 + 78 + 4);
    expect(groupItem.children.map((child) => child.top)).toEqual([75, 113]);
    expect(groupItem.children.map((child) => child.row.key)).toEqual(["tab-101", "tab-102"]);
  });

  it("omits group children when the group is collapsed", () => {
    const section: WindowRenderSection = {
      windowRow: makeWindowRow({ totalCount: 2 }),
      items: [
        {
          kind: "group-block",
          groupRow: makeGroupRow({ groupId: 10, collapsed: true, totalCount: 2 }),
          childRows: makeTabRows(2, { startId: 101 })
        }
      ]
    };

    const layout = buildLayout([section], false);
    const groupItem = layout.sections[0]!.body!.items[0]!;
    expect(groupItem.type).toBe("group");
    if (groupItem.type !== "group") {
      return;
    }

    expect(groupItem.hasBody).toBe(false);
    expect(groupItem.children).toHaveLength(0);
    expect(groupItem.height).toBe(28 + 4);
    expect(layout.rowGeometry.has("tab-101")).toBe(false);
  });

  it("uses measured type heights over density estimates", () => {
    const layout = buildVirtualListLayout({
      renderSections: [makeSingleWindowSection(2)],
      metrics: MEDIUM_METRICS,
      searchActive: false,
      measuredTypeHeights: { tab: 41, window: 50, group: 30 }
    });
    const section = layout.sections[0]!;

    expect(section.headerHeight).toBe(50);
    expect(section.body!.items[0]!.height).toBe(41);
  });
});

// ── 可见区间：二分 ───────────────────────────────────────────────────

describe("findVisibleRange", () => {
  const entries = [
    { top: 0, height: 40 },
    { top: 44, height: 40 },
    { top: 88, height: 40 },
    { top: 132, height: 40 }
  ];

  it("finds the first and last intersecting entries", () => {
    expect(findVisibleRange(entries, -200, 200)).toEqual({ first: 0, last: 3 });
    expect(findVisibleRange(entries, 44, 46)).toEqual({ first: 1, last: 1 });
    expect(findVisibleRange(entries, 40, 44)).toEqual({ first: -1, last: -1 });
    expect(findVisibleRange(entries, 40, 45)).toEqual({ first: 1, last: 1 });
    expect(findVisibleRange(entries, 30, 50)).toEqual({ first: 0, last: 1 });
    expect(findVisibleRange(entries, 130, 200)).toEqual({ first: 3, last: 3 });
  });

  it("returns an empty range outside the entries", () => {
    expect(findVisibleRange(entries, -100, 0)).toEqual({ first: -1, last: -1 });
    expect(findVisibleRange(entries, 172, 300)).toEqual({ first: -1, last: -1 });
    expect(findVisibleRange([], 0, 100)).toEqual({ first: -1, last: -1 });
    expect(findVisibleRange(entries, 50, 50)).toEqual({ first: -1, last: -1 });
  });
});

// ── spacer 计算：渲染高度恒等于完整高度 ─────────────────────────────

describe("calculateVirtualSliceSpacers", () => {
  function entriesFor(count: number, height: number, gap: number) {
    return Array.from({ length: count }, (_, index) => ({
      top: index * (height + gap),
      height
    }));
  }

  it("keeps rendered DOM height equal to full content height for every slice", () => {
    const gap = 4;
    const entries = entriesFor(6, 38, gap);
    const fullHeight = entries[entries.length - 1]!.top + 38;

    for (let first = 0; first < entries.length; first += 1) {
      for (let last = first; last < entries.length; last += 1) {
        const spacers = calculateVirtualSliceSpacers({
          entries,
          firstIndex: first,
          lastIndex: last,
          gap
        });
        const renderedItems = last - first + 1;
        const spacerCount =
          (first > 0 ? 1 : 0) + (last < entries.length - 1 ? 1 : 0);
        const renderedHeight =
          spacers.topSpacerHeight
          + renderedItems * 38
          + spacers.bottomSpacerHeight
          + gap * (renderedItems + spacerCount - 1);

        expect(renderedHeight).toBeCloseTo(fullHeight, 5);
        expect(spacers.topSpacerHeight).toBeGreaterThanOrEqual(0);
        expect(spacers.bottomSpacerHeight).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("keeps the first rendered entry at its layout offset when both spacers exist", () => {
    const gap = 4;
    const entries = entriesFor(8, 38, gap);
    const spacers = calculateVirtualSliceSpacers({
      entries,
      firstIndex: 3,
      lastIndex: 5,
      gap
    });

    // 首个渲染条目的 DOM 偏移 = 上 spacer + 一个 gap，应等于布局偏移
    const expectedOffset = entries[3]!.top - entries[0]!.top;
    expect(spacers.topSpacerHeight + gap).toBe(expectedOffset);
  });

  it("uses one full-height spacer when no entry is rendered", () => {
    const entries = entriesFor(4, 30, 4);
    const spacers = calculateVirtualSliceSpacers({
      entries,
      firstIndex: -1,
      lastIndex: -1,
      gap: 4
    });

    expect(spacers.topSpacerHeight).toBe(entries[3]!.top + 30);
    expect(spacers.bottomSpacerHeight).toBe(0);
  });

  it("keeps block layout exact for gap 0 (group body)", () => {
    const entries = entriesFor(5, 38, 0);
    const spacers = calculateVirtualSliceSpacers({
      entries,
      firstIndex: 2,
      lastIndex: 3,
      gap: 0
    });

    expect(spacers.topSpacerHeight).toBe(76);
    expect(spacers.bottomSpacerHeight).toBe(38);
  });
});

// ── 渲染计划：可见区间 + spacer ─────────────────────────────────────

function layoutTotalFromPlan(plan: VirtualRenderPlan): number {
  let total = plan.topSpacerHeight + plan.bottomSpacerHeight;
  for (const sectionPlan of plan.sections) {
    total += sectionPlan.section.height + sectionPlan.gapAfterHeight;
  }
  return total;
}

describe("resolveVirtualRenderPlan", () => {
  it("bounds rendered rows for 1000 tabs in one window", () => {
    const layout = buildLayout([makeSingleWindowSection(1000)]);
    const plan = resolveVirtualRenderPlan({ layout, visibleTop: 0, viewportHeight: 600 });

    expect(plan.renderedRowCount).toBeGreaterThan(0);
    expect(plan.renderedRowCount).toBeLessThanOrEqual(80);
    expect(plan.totalRowCount).toBe(1001);
    expect(plan.sections).toHaveLength(1);
    expect(plan.sections[0]!.body).not.toBeNull();
    expect(plan.topSpacerHeight).toBe(0);
    expect(plan.bottomSpacerHeight).toBe(0);
    expect(plan.sections[0]!.body!.topSpacerHeight).toBe(0);
    expect(plan.sections[0]!.body!.bottomSpacerHeight).toBeGreaterThan(0);
    expect(layoutTotalFromPlan(plan)).toBeCloseTo(layout.totalHeight, 0);
  });

  it("renders a bounded slice around the middle of a long list", () => {
    const layout = buildLayout([makeSingleWindowSection(1000)]);
    const visibleTop = 12000;
    const plan = resolveVirtualRenderPlan({ layout, visibleTop, viewportHeight: 600 });

    expect(plan.renderedRowCount).toBeLessThanOrEqual(80);
    expect(plan.topSpacerHeight).toBe(0);
    expect(plan.bottomSpacerHeight).toBe(0);
    expect(plan.sections[0]!.body!.topSpacerHeight).toBeGreaterThan(0);
    expect(plan.sections[0]!.body!.bottomSpacerHeight).toBeGreaterThan(0);
    expect(layoutTotalFromPlan(plan)).toBeCloseTo(layout.totalHeight, 0);

    // 首个渲染条目仍落在布局偏移上（spacer 已补偿 grid gap），避免切片换挡抖动
    const layoutItems = layout.sections[0]!.body!.items;
    const firstRenderedItem = plan.sections[0]!.body!.items[0]!.item;
    const firstRenderedIndex = layoutItems.indexOf(firstRenderedItem);
    expect(firstRenderedIndex).toBeGreaterThan(0);
    expect(plan.sections[0]!.body!.topSpacerHeight + layout.sections[0]!.body!.gap).toBe(
      layoutItems[firstRenderedIndex]!.top - layoutItems[0]!.top
    );
  });

  it("keeps rendered rows bounded across many windows", () => {
    const sections: WindowRenderSection[] = [];
    for (let windowIndex = 0; windowIndex < 20; windowIndex += 1) {
      sections.push({
        windowRow: makeWindowRow({
          windowId: windowIndex + 1,
          key: `window-${windowIndex + 1}`,
          totalCount: 50
        }),
        items: makeTabRows(50, {
          windowId: windowIndex + 1,
          startId: windowIndex * 100 + 1
        }).map<WindowRenderItem>((row) => ({ kind: "single", row }))
      });
    }

    const layout = buildLayout(sections);
    const plan = resolveVirtualRenderPlan({ layout, visibleTop: 20000, viewportHeight: 600 });

    expect(plan.sections.length).toBeGreaterThan(0);
    expect(plan.renderedRowCount).toBeLessThanOrEqual(80);
    expect(plan.topSpacerHeight).toBeGreaterThan(0);
    expect(plan.bottomSpacerHeight).toBeGreaterThan(0);
    expect(layoutTotalFromPlan(plan)).toBeCloseTo(layout.totalHeight, 0);
  });

  it("renders only window headers when every window is collapsed", () => {
    const sections: WindowRenderSection[] = [];
    for (let windowIndex = 0; windowIndex < 3; windowIndex += 1) {
      sections.push({
        windowRow: makeWindowRow({
          windowId: windowIndex + 1,
          key: `window-${windowIndex + 1}`,
          collapsed: true,
          totalCount: 10
        }),
        items: makeTabRows(10, { windowId: windowIndex + 1 }).map<WindowRenderItem>((row) => ({
          kind: "single",
          row
        }))
      });
    }

    const layout = buildLayout(sections, false);
    const plan = resolveVirtualRenderPlan({ layout, visibleTop: 0, viewportHeight: 600 });

    expect(plan.renderedRowCount).toBe(3);
    for (const sectionPlan of plan.sections) {
      expect(sectionPlan.body).toBeNull();
    }
  });

  it("slices large group bodies and keeps the DOM bounded", () => {
    const childRows = makeTabRows(200, { startId: 500 });
    const section: WindowRenderSection = {
      windowRow: makeWindowRow({ totalCount: 200 }),
      items: [
        {
          kind: "group-block",
          groupRow: makeGroupRow({ groupId: 10, totalCount: 200 }),
          childRows
        }
      ]
    };

    const layout = buildLayout([section]);
    const groupItem = layout.sections[0]!.body!.items[0]!;
    expect(groupItem.type).toBe("group");
    if (groupItem.type !== "group") {
      return;
    }

    const visibleTop = groupItem.bodyTop + 2000;
    const plan = resolveVirtualRenderPlan({ layout, visibleTop, viewportHeight: 600 });

    expect(plan.renderedRowCount).toBeLessThanOrEqual(80);
    const groupPlan = plan.sections[0]!.body!.items[0]!;
    expect(groupPlan.group).not.toBeNull();
    expect(groupPlan.group!.first).toBeGreaterThan(0);
    expect(groupPlan.group!.last).toBeLessThan(199);
    expect(groupPlan.group!.topSpacerHeight).toBeGreaterThan(0);
    expect(groupPlan.group!.bottomSpacerHeight).toBeGreaterThan(0);

    // DOM 高度（group 内）守恒：topSpacer + kids + bottomSpacer == 全部子行高度
    const renderedChildCount = groupPlan.group!.last - groupPlan.group!.first + 1;
    const renderedGroupBodyHeight =
      groupPlan.group!.topSpacerHeight
      + renderedChildCount * 38
      + groupPlan.group!.bottomSpacerHeight;
    expect(renderedGroupBodyHeight).toBe(200 * 38);
  });

  it("empties the plan when the viewport is entirely above the list", () => {
    const layout = buildLayout([makeSingleWindowSection(10)]);
    const plan = resolveVirtualRenderPlan({ layout, visibleTop: -5000, viewportHeight: 600 });

    expect(plan.sections).toHaveLength(0);
    expect(plan.renderedRowCount).toBe(0);
    expect(plan.bottomSpacerHeight).toBe(layout.totalHeight);
  });
});

// ── 定位辅助 ─────────────────────────────────────────────────────────

describe("virtual list locate helpers", () => {
  it("finds the section index for an offset", () => {
    const sections = [makeSingleWindowSection(2), makeSingleWindowSection(2)];
    const layout = buildLayout(sections);

    expect(findSectionIndexForOffset(layout, 0)).toBe(0);
    expect(findSectionIndexForOffset(layout, -10)).toBe(0);
    expect(findSectionIndexForOffset(layout, layout.sections[1]!.top + 1)).toBe(1);
    expect(findSectionIndexForOffset(layout, layout.totalHeight + 100)).toBe(1);
    expect(findSectionIndexForOffset({ ...layout, sections: [] }, 0)).toBe(-1);
  });

  it("uses the containing section header as sticky obstruction", () => {
    const layout = buildLayout([makeSingleWindowSection(3)]);
    const targetTab = layout.sections[0]!.body!.items[1]!;

    expect(resolveVirtualRowTopObstruction(layout, targetTab.row.key)).toBe(45);
    expect(resolveVirtualRowTopObstruction(layout, "missing-row")).toBe(0);
  });

  it("produces a structural key that changes with collapse/search/order", () => {
    const openSection = makeSingleWindowSection(2);
    const collapsedSection: WindowRenderSection = {
      ...openSection,
      windowRow: { ...openSection.windowRow, collapsed: true }
    };

    const keyOpen = getVirtualListStructuralKey({
      renderSections: [openSection],
      searchActive: false,
      tabDisplaySize: "medium"
    });
    const keyCollapsed = getVirtualListStructuralKey({
      renderSections: [collapsedSection],
      searchActive: false,
      tabDisplaySize: "medium"
    });
    const keySearch = getVirtualListStructuralKey({
      renderSections: [openSection],
      searchActive: true,
      tabDisplaySize: "medium"
    });
    const keyReversed = getVirtualListStructuralKey({
      renderSections: [makeSingleWindowSection(2), openSection],
      searchActive: false,
      tabDisplaySize: "medium"
    });

    expect(keyOpen).not.toBe(keyCollapsed);
    expect(keyOpen).not.toBe(keySearch);
    expect(keyOpen).not.toBe(keyReversed);
  });
});

// ── 组件渲染（SSR 快照）：DOM 行数上界 ──────────────────────────────

interface RenderListOptions {
  rows: PanelRow[];
  renderSections: WindowRenderSection[];
  searchActive?: boolean;
  tabDisplaySize?: "large" | "medium" | "small";
}

function renderVirtualListMarkup(options: RenderListOptions): string {
  const noop = () => undefined;

  return renderToStaticMarkup(
    createElement(VirtualizedWindowList, {
      locale: "zh-CN" as const,
      tabDisplaySize: options.tabDisplaySize ?? "medium",
      rows: options.rows,
      renderSections: options.renderSections,
      currentActiveTabId: null,
      locateRequest: null,
      closingTabIds: new Set<number>(),
      selectedTabIds: new Set<number>(),
      scrollContainerRef: { current: null },
      disabled: false,
      searchActive: options.searchActive ?? false,
      selectionMode: false,
      onClearSelection: noop,
      onToggleWindow: noop,
      onToggleGroup: noop,
      onActivateTab: noop,
      onTogglePinned: noop,
      onCloseTab: noop,
      onMoveTab: noop,
      onMoveTabs: noop,
      onMoveGroup: noop
    })
  );
}

describe("VirtualizedWindowList SSR rendering", () => {
  it("keeps rendered rows bounded for 1000 tabs and preserves list semantics", () => {
    const section = makeSingleWindowSection(1000);
    const renderSections = [section];
    const rows: PanelRow[] = [
      section.windowRow,
      ...section.items.map<PanelRow>((item) => (item.kind === "single" ? item.row : item.groupRow))
    ];

    const markup = renderVirtualListMarkup({ rows, renderSections });
    const renderedRows = countRenderedRowsInMarkup(markup);

    expect(markup).toContain('role="tree"');
    expect(markup).toContain('class="window-section"');
    expect(markup).toContain("window-section__header");
    expect(markup).toContain("stack-list__virtual-spacer");
    expect(markup).toContain("Tab 1<");
    expect(markup).not.toContain("Tab 999");
    expect(renderedRows).toBeGreaterThan(0);
    expect(renderedRows).toBeLessThanOrEqual(80);
    expect(parseRenderedRowsAttribute(markup)).toBe(renderedRows);
  });

  it("renders only headers for collapsed windows", () => {
    const sections: WindowRenderSection[] = [1, 2, 3].map((windowId) => ({
      windowRow: makeWindowRow({
        windowId,
        key: `window-${windowId}`,
        collapsed: true,
        totalCount: 5
      }),
      items: makeTabRows(5, { windowId }).map<WindowRenderItem>((row) => ({ kind: "single", row }))
    }));
    const rows: PanelRow[] = sections.map((section) => section.windowRow);

    const markup = renderVirtualListMarkup({ rows, renderSections: sections });
    expect(countRenderedRowsInMarkup(markup)).toBe(3);
    expect(markup).not.toContain("tab-row__main");
  });

  it("shows collapsed-window children while search is active", () => {
    const section: WindowRenderSection = {
      windowRow: makeWindowRow({ collapsed: true, totalCount: 2 }),
      items: makeTabRows(2).map<WindowRenderItem>((row) => ({ kind: "single", row }))
    };
    const rows: PanelRow[] = [
      section.windowRow,
      ...section.items.map((item) => (item.kind === "single" ? item.row : item.groupRow))
    ];

    const markup = renderVirtualListMarkup({ rows, renderSections: [section], searchActive: true });
    expect(markup).toContain("tab-row__main");
    expect(countRenderedRowsInMarkup(markup)).toBe(3);
  });

  it("slices large groups so a 200-tab group stays below the DOM row budget", () => {
    const childRows = makeTabRows(200, { startId: 700 });
    const section: WindowRenderSection = {
      windowRow: makeWindowRow({ totalCount: 200 }),
      items: [
        {
          kind: "group-block",
          groupRow: makeGroupRow({ groupId: 10, totalCount: 200, tabIds: [701, 702] }),
          childRows
        }
      ]
    };
    const groupItem = section.items[0]!;
    const rows: PanelRow[] = groupItem.kind === "group-block"
      ? [section.windowRow, groupItem.groupRow, ...groupItem.childRows]
      : [section.windowRow, groupItem.row];

    const markup = renderVirtualListMarkup({ rows, renderSections: [section] });
    expect(markup).toContain("group-block__body");
    expect(countRenderedRowsInMarkup(markup)).toBeGreaterThan(1);
    expect(countRenderedRowsInMarkup(markup)).toBeLessThanOrEqual(80);
    expect(parseRenderedRowsAttribute(markup)).toBe(countRenderedRowsInMarkup(markup));
  });
});
