import {
  buildWindowRenderSections,
  createSearchResult,
  filterPanelRowsBySearch,
  flattenWindowSections,
  getSearchMatchingTabIds,
  hasRowKey,
  resolveActiveGroupAutoExpand,
  resolveCollapsedWindowIdsForTarget,
  selectCurrentActiveGroupId,
  selectCurrentActiveTabId,
  selectWindowSections,
} from "../src/shared/domain/selectors";
import { NO_TAB_GROUP_ID } from "../src/shared/defaults";
import { createStateFromTabs } from "../src/shared/domain/tabState";
import type { TabGroupRecord, TabRecord } from "../src/shared/types";

function makeTab(overrides: Partial<TabRecord>): TabRecord {
  return {
    id: overrides.id ?? 1,
    windowId: overrides.windowId ?? 1,
    index: overrides.index ?? 0,
    groupId: overrides.groupId ?? NO_TAB_GROUP_ID,
    title: overrides.title ?? "Tab",
    url: overrides.url ?? "https://example.com",
    pinned: overrides.pinned ?? false,
    active: overrides.active ?? false,
    audible: overrides.audible ?? false,
    discarded: overrides.discarded ?? false,
    favIconUrl: overrides.favIconUrl ?? null,
    lastAccessed: overrides.lastAccessed ?? 0,
  };
}

function makeGroup(overrides: Partial<TabGroupRecord>): TabGroupRecord {
  return {
    id: overrides.id ?? 1,
    windowId: overrides.windowId ?? 1,
    title: overrides.title ?? "编组",
    color: overrides.color ?? "blue",
    collapsed: overrides.collapsed ?? false,
  };
}

describe("selectors", () => {
  const state = createStateFromTabs(
    [
      makeTab({
        id: 1,
        windowId: 1,
        title: "Inbox",
        url: "https://mail.example.com",
      }),
      makeTab({
        id: 2,
        windowId: 2,
        title: "Docs",
        url: "https://docs.example.com",
        active: true,
      }),
      makeTab({
        id: 3,
        windowId: 2,
        title: "Search",
        url: "https://search.example.com",
      }),
    ],
    2,
  );

  it("returns all windows grouped with stable titles and fixed order", () => {
    const sections = selectWindowSections(state, [], "zh-CN");

    expect(sections).toHaveLength(2);
    expect(sections[0].windowId).toBe(1);
    expect(sections[0].title).toBe("窗口 1");
    expect(sections[0].isFocused).toBe(false);
    expect(sections[1].windowId).toBe(2);
    expect(sections[1].title).toBe("窗口 2 - Docs");
    expect(sections[1].isFocused).toBe(true);
  });

  it("uses window numbering and appends the current active tab title when available", () => {
    const multiWindowState = createStateFromTabs(
      [
        makeTab({ id: 1, windowId: 1, active: true, title: "Inbox" }),
        makeTab({ id: 2, windowId: 1, active: false, title: "Other" }),
        makeTab({ id: 3, windowId: 2, active: false, title: "No Active" }),
        makeTab({ id: 4, windowId: 3, active: true, title: "   " }),
      ],
      1,
    );

    const sections = selectWindowSections(multiWindowState, [], "zh-CN");

    expect(sections[0]).toMatchObject({ windowId: 1, title: "窗口 1 - Inbox" });
    expect(sections[1]).toMatchObject({ windowId: 2, title: "窗口 2" });
    expect(sections[2]).toMatchObject({ windowId: 3, title: "窗口 3" });
  });

  it("hides tabs for collapsed windows but keeps the window row", () => {
    const sections = selectWindowSections(state, [1]);
    const rows = flattenWindowSections(sections);

    expect(
      rows.some((row) => row.kind === "window" && row.windowId === 1),
    ).toBe(true);
    expect(rows.some((row) => row.kind === "tab" && row.tab.id === 1)).toBe(
      false,
    );
  });

  it("keeps collapsed window tabs searchable when search rows include collapsed children", () => {
    const collapsedWindowState = createStateFromTabs(
      [
        makeTab({ id: 1, windowId: 1, title: "Inbox" }),
        makeTab({
          id: 2,
          windowId: 1,
          title: "Hidden target",
          url: "https://example.com/hidden-target",
        }),
      ],
      1,
    );

    const rows = flattenWindowSections(
      selectWindowSections(collapsedWindowState, [1]),
      {
        includeCollapsedChildren: true,
      },
    );
    const filteredRows = filterPanelRowsBySearch(rows, "hidden", "filter");

    expect(
      filteredRows.some((row) => row.kind === "window" && row.windowId === 1),
    ).toBe(true);
    expect(
      filteredRows.some((row) => row.kind === "tab" && row.tab.id === 2),
    ).toBe(true);
  });

  it("keeps collapsed group tabs searchable when search rows include collapsed children", () => {
    const collapsedGroupState = createStateFromTabs(
      [
        makeTab({
          id: 1,
          windowId: 1,
          index: 0,
          groupId: 10,
          title: "Hidden group target",
        }),
        makeTab({
          id: 2,
          windowId: 1,
          index: 1,
          groupId: 10,
          title: "Sibling",
        }),
      ],
      1,
      [makeGroup({ id: 10, windowId: 1, title: "工作", collapsed: true })],
    );

    const rows = flattenWindowSections(
      selectWindowSections(collapsedGroupState, []),
      {
        includeCollapsedChildren: true,
      },
    );
    const filteredRows = filterPanelRowsBySearch(rows, "hidden", "filter");

    expect(
      filteredRows.some((row) => row.kind === "group" && row.groupId === 10),
    ).toBe(true);
    expect(
      filteredRows.some((row) => row.kind === "tab" && row.tab.id === 1),
    ).toBe(true);
  });

  it("keeps matching tabs searchable inside collapsed containers in highlight mode", () => {
    const highlightedState = createStateFromTabs(
      [
        makeTab({
          id: 1,
          windowId: 1,
          index: 0,
          groupId: 10,
          title: "Alpha match",
        }),
        makeTab({ id: 2, windowId: 1, index: 1, groupId: 10, title: "Beta" }),
      ],
      1,
      [makeGroup({ id: 10, windowId: 1, collapsed: true })],
    );

    const rows = flattenWindowSections(
      selectWindowSections(highlightedState, [1]),
      {
        includeCollapsedChildren: true,
      },
    );
    const highlightedRows = filterPanelRowsBySearch(rows, "alpha", "highlight");
    const matchingTabRow = highlightedRows.find(
      (row) => row.kind === "tab" && row.tab.id === 1,
    );
    const siblingTabRow = highlightedRows.find(
      (row) => row.kind === "tab" && row.tab.id === 2,
    );

    expect(matchingTabRow).toMatchObject({ kind: "tab", matchesSearch: true });
    expect(siblingTabRow).toMatchObject({ kind: "tab", matchesSearch: false });
  });

  it("removes only the target window from collapsed window ids", () => {
    expect(
      resolveCollapsedWindowIdsForTarget({
        collapsedWindowIds: [1, 2, 3],
        targetWindowId: 2,
      }),
    ).toEqual([1, 3]);
    expect(
      resolveCollapsedWindowIdsForTarget({
        collapsedWindowIds: [1, 3],
        targetWindowId: 2,
      }),
    ).toEqual([1, 3]);
  });

  it("detects whether a row key exists in the current rows", () => {
    const rows = flattenWindowSections(selectWindowSections(state, []));
    expect(hasRowKey(rows, "tab-2")).toBe(true);
    expect(hasRowKey(rows, "tab-999")).toBe(false);
  });

  it("returns the active tab id from the focused window", () => {
    expect(selectCurrentActiveTabId(state)).toBe(2);
  });

  it("computes filtered rows and match count in one pass", () => {
    const rows = flattenWindowSections(selectWindowSections(state, []));

    expect(createSearchResult(rows, "docs", "filter")).toEqual({
      rows: [
        rows[2],
        {
          ...rows[3],
          matchesSearch: true,
        },
      ],
      matchCount: 1,
    });

    expect(
      getSearchMatchingTabIds(createSearchResult(rows, "docs", "filter").rows),
    ).toEqual([2]);

    const highlightResult = createSearchResult(rows, "docs", "highlight");
    expect(highlightResult.matchCount).toBe(1);
    expect(
      highlightResult.rows.find(
        (row) => row.kind === "tab" && row.tab.id === 2,
      ),
    ).toMatchObject({
      kind: "tab",
      matchesSearch: true,
    });
  });

  it("flattens sections into grouped rows", () => {
    const sections = selectWindowSections(state, []);
    const rows = flattenWindowSections(sections);

    expect(rows[0].kind).toBe("window");
    expect(rows[1].kind).toBe("tab");
    expect(rows[2].kind).toBe("window");
    expect(rows[3].kind).toBe("tab");
    expect(rows[4].kind).toBe("tab");
  });

  it("groups grouped tabs into a group row and keeps ungrouped tabs plain", () => {
    const groupedState = createStateFromTabs(
      [
        makeTab({ id: 1, windowId: 1, index: 0 }),
        makeTab({ id: 2, windowId: 1, index: 1, groupId: 10 }),
        makeTab({ id: 3, windowId: 1, index: 2, groupId: 10 }),
      ],
      1,
      [makeGroup({ id: 10, windowId: 1, title: "工作", color: "red" })],
    );

    const rows = flattenWindowSections(selectWindowSections(groupedState, []));

    expect(rows[1]).toMatchObject({ kind: "tab" });
    expect(rows[2]).toMatchObject({
      kind: "group",
      groupId: 10,
      title: "工作",
    });
    expect(rows[3]).toMatchObject({ kind: "tab" });
    expect(rows[4]).toMatchObject({ kind: "tab" });
  });

  it("builds render sections directly from filtered rows", () => {
    const groupedState = createStateFromTabs(
      [
        makeTab({ id: 1, windowId: 1, index: 0 }),
        makeTab({
          id: 2,
          windowId: 1,
          index: 1,
          groupId: 10,
          title: "Alpha match",
        }),
        makeTab({ id: 3, windowId: 1, index: 2, groupId: 10, title: "Beta" }),
      ],
      1,
      [makeGroup({ id: 10, windowId: 1, title: "工作", color: "red" })],
    );

    const rows = filterPanelRowsBySearch(
      flattenWindowSections(selectWindowSections(groupedState, [])),
      "alpha",
      "highlight",
    );

    expect(buildWindowRenderSections(rows)).toEqual([
      {
        windowRow: rows[0],
        items: [
          {
            kind: "single",
            row: rows[1],
          },
          {
            kind: "group-block",
            groupRow: rows[2],
            childRows: [rows[3], rows[4]],
          },
        ],
      },
    ]);
  });

  it("selects the current active group from the focused active tab", () => {
    const groupedState = createStateFromTabs(
      [makeTab({ id: 2, windowId: 1, index: 0, groupId: 10, active: true })],
      1,
      [makeGroup({ id: 10, windowId: 1, collapsed: true })],
    );

    expect(selectCurrentActiveGroupId(groupedState)).toBe(10);
  });

  it("requests auto expand on the initial collapsed active group check", () => {
    expect(
      resolveActiveGroupAutoExpand({
        currentActiveTabId: 2,
        previousActiveTabId: null,
        hasCompletedInitialCheck: false,
        currentActiveGroupId: 10,
        hasCurrentActiveGroupRecord: true,
        isCurrentActiveGroupCollapsed: true,
      }),
    ).toEqual({
      shouldAutoExpand: true,
      shouldConsumeCheck: true,
    });
  });

  it("does not repeat auto expand for the same active tab after the initial check", () => {
    expect(
      resolveActiveGroupAutoExpand({
        currentActiveTabId: 2,
        previousActiveTabId: 2,
        hasCompletedInitialCheck: true,
        currentActiveGroupId: 10,
        hasCurrentActiveGroupRecord: true,
        isCurrentActiveGroupCollapsed: true,
      }),
    ).toEqual({
      shouldAutoExpand: false,
      shouldConsumeCheck: true,
    });
  });

  it("requests auto expand again when the active tab changes into a collapsed group", () => {
    expect(
      resolveActiveGroupAutoExpand({
        currentActiveTabId: 3,
        previousActiveTabId: 2,
        hasCompletedInitialCheck: true,
        currentActiveGroupId: 10,
        hasCurrentActiveGroupRecord: true,
        isCurrentActiveGroupCollapsed: true,
      }),
    ).toEqual({
      shouldAutoExpand: true,
      shouldConsumeCheck: true,
    });
  });

  it("keeps the initial auto-expand check pending while the active group record is still missing", () => {
    expect(
      resolveActiveGroupAutoExpand({
        currentActiveTabId: 3,
        previousActiveTabId: null,
        hasCompletedInitialCheck: false,
        currentActiveGroupId: 10,
        hasCurrentActiveGroupRecord: false,
        isCurrentActiveGroupCollapsed: false,
      }),
    ).toEqual({
      shouldAutoExpand: false,
      shouldConsumeCheck: false,
    });
  });
});
