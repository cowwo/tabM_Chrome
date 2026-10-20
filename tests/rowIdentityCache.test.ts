import { describe, expect, it } from "vitest";
import { NO_TAB_GROUP_ID } from "../src/shared/defaults";
import { selectPanelViewModel } from "../src/shared/domain/selectors";
import {
  createStateFromTabs,
  upsertGroupRecord,
  upsertTabRecord,
} from "../src/shared/domain/tabState";
import type {
  PanelRow,
  TabGroupRecord,
  TabRecord,
  TabStoreState,
} from "../src/shared/types";

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

function createBaseState(): TabStoreState {
  return createStateFromTabs(
    [
      makeTab({
        id: 1,
        windowId: 1,
        index: 0,
        groupId: 10,
        title: "Inbox",
        url: "https://mail.example.com",
      }),
      makeTab({
        id: 2,
        windowId: 1,
        index: 1,
        groupId: 10,
        title: "Docs",
        url: "https://docs.example.com",
      }),
      makeTab({
        id: 3,
        windowId: 1,
        index: 2,
        title: "Notes",
        url: "https://notes.example.com",
      }),
      makeTab({ id: 4, windowId: 1, index: 3, title: "Home", active: true }),
      makeTab({ id: 5, windowId: 2, index: 0, title: "Mail", active: true }),
      makeTab({ id: 6, windowId: 2, index: 1, title: "Calendar" }),
    ],
    1,
    [makeGroup({ id: 10, windowId: 1, title: "Work", color: "blue" })],
  );
}

function selectRows(
  state: TabStoreState,
  options: {
    collapsedWindowIds?: readonly number[];
    searchTerm?: string;
    filterMode?: "filter" | "highlight";
    locale?: "en" | "zh-CN";
  } = {},
) {
  return selectPanelViewModel({
    state,
    collapsedWindowIds: options.collapsedWindowIds ?? [],
    searchTerm: options.searchTerm ?? "",
    filterMode: options.filterMode ?? "filter",
    locale: options.locale ?? "zh-CN",
  });
}

function expectSameRowRefs(
  previousRows: readonly PanelRow[],
  nextRows: readonly PanelRow[],
) {
  expect(nextRows).toHaveLength(previousRows.length);
  previousRows.forEach((row, index) => {
    expect(nextRows[index]).toBe(row);
  });
}

function findRow<Kind extends PanelRow["kind"]>(
  rows: readonly PanelRow[],
  kind: Kind,
  predicate: (row: Extract<PanelRow, { kind: Kind }>) => boolean,
): Extract<PanelRow, { kind: Kind }> {
  const row = rows.find(
    (candidate): candidate is Extract<PanelRow, { kind: Kind }> =>
      candidate.kind === kind && predicate(candidate as Extract<PanelRow, { kind: Kind }>),
  );
  if (!row) {
    throw new Error(`row of kind ${kind} not found`);
  }
  return row;
}

describe("row identity cache", () => {
  it("returns the very same row objects for repeated selections of one state", () => {
    const state = createBaseState();

    const first = selectRows(state);
    const second = selectRows(state);

    expectSameRowRefs(first.rows, second.rows);
    expectSameRowRefs(first.filteredRows, second.filteredRows);
    expectSameRowRefs(first.searchResult.rows, second.searchResult.rows);
    expect(second.renderSections).toHaveLength(first.renderSections.length);
    first.renderSections.forEach((section, index) => {
      expect(second.renderSections[index].windowRow).toBe(section.windowRow);
      expect(second.renderSections[index].items).toHaveLength(section.items.length);
      section.items.forEach((item, itemIndex) => {
        const nextItem = second.renderSections[index].items[itemIndex];
        if (item.kind === "single") {
          expect(nextItem.kind === "single" && nextItem.row).toBe(item.row);
          return;
        }
        expect(nextItem.kind === "group-block" && nextItem.groupRow).toBe(
          item.groupRow,
        );
        if (item.kind === "group-block" && nextItem.kind === "group-block") {
          expect(nextItem.childRows).toHaveLength(item.childRows.length);
          item.childRows.forEach((childRow, childIndex) => {
            expect(nextItem.childRows[childIndex]).toBe(childRow);
          });
        }
      });
    });
  });

  it("replaces only the row of the tab whose TabRecord changed", () => {
    const state = createBaseState();
    const previousTab = state.tabsById[3];
    const nextState = upsertTabRecord(state, {
      ...previousTab,
      title: "Notes updated",
    });

    const before = selectRows(state);
    const after = selectRows(nextState);
    const beforeByKey = new Map(before.rows.map((row) => [row.key, row]));

    const changedKeys = after.rows
      .filter((row) => beforeByKey.get(row.key) !== row)
      .map((row) => row.key);

    expect(changedKeys).toEqual(["tab-3"]);
    const changedRow = findRow(after.rows, "tab", (row) => row.tab.id === 3);
    expect(changedRow.tab).toBe(nextState.tabsById[3]);
    expect(changedRow.tab.title).toBe("Notes updated");
  });

  it("rebuilds the group row and window row when a tab joins a group", () => {
    const state = createBaseState();
    const joinedTab = makeTab({
      id: 7,
      windowId: 1,
      index: 4,
      groupId: 10,
      title: "Extra",
    });
    const nextState = upsertTabRecord(state, joinedTab);

    const before = selectRows(state);
    const after = selectRows(nextState);

    expect(findRow(after.rows, "group", (row) => row.groupId === 10)).not.toBe(
      findRow(before.rows, "group", (row) => row.groupId === 10),
    );
    expect(findRow(after.rows, "group", (row) => row.groupId === 10)).toMatchObject({
      totalCount: 3,
      tabIds: [1, 2, 7],
    });
    expect(findRow(after.rows, "window", (row) => row.windowId === 1)).not.toBe(
      findRow(before.rows, "window", (row) => row.windowId === 1),
    );
    expect(findRow(after.rows, "window", (row) => row.windowId === 2)).toBe(
      findRow(before.rows, "window", (row) => row.windowId === 2),
    );
    expect(findRow(after.rows, "tab", (row) => row.tab.id === 7).tab).toBe(joinedTab);

    before.rows
      .filter((row) => row.kind === "tab")
      .forEach((row) => {
        expect(after.rows.find((candidate) => candidate.key === row.key)).toBe(row);
      });
  });

  it("invalidates the moved tab row when its TabRecord moves to another window", () => {
    const state = createBaseState();
    const previousTab = state.tabsById[6];
    const movedTab: TabRecord = { ...previousTab, windowId: 1, index: 4 };
    const nextState = upsertTabRecord(state, movedTab);

    const before = selectRows(state);
    const after = selectRows(nextState);
    const movedRow = findRow(after.rows, "tab", (row) => row.tab.id === 6);

    expect(movedRow.tab).toBe(movedTab);
    expect(movedRow.windowId).toBe(1);
    expect(movedRow).not.toBe(findRow(before.rows, "tab", (row) => row.tab.id === 6));
    expect(findRow(after.rows, "tab", (row) => row.tab.id === 5)).toBe(
      findRow(before.rows, "tab", (row) => row.tab.id === 5),
    );
  });

  it("keeps filter-mode matching behavior and reuses matched row objects", () => {
    const state = createBaseState();

    const first = selectRows(state, { searchTerm: "docs", filterMode: "filter" });
    const second = selectRows(state, { searchTerm: "docs", filterMode: "filter" });

    expect(first.filteredRows.map((row) => row.key)).toEqual([
      "window-1",
      "group-10",
      "tab-2",
    ]);
    expect(first.matchCount).toBe(1);
    expect(first.searchResult.matchCount).toBe(first.matchCount);
    expectSameRowRefs(first.filteredRows, second.filteredRows);
    expect(findRow(first.filteredRows, "tab", (row) => row.tab.id === 2)).toMatchObject({
      matchesSearch: true,
    });
    expect(
      findRow(first.filteredRows, "window", (row) => row.windowId === 1).matchesSearch,
    ).toBeUndefined();
  });

  it("keeps highlight-mode behavior and reuses rows whose match state did not change", () => {
    const state = createBaseState();

    const docsFirst = selectRows(state, {
      searchTerm: "docs",
      filterMode: "highlight",
    });
    const docsSecond = selectRows(state, {
      searchTerm: "docs",
      filterMode: "highlight",
    });

    expect(docsFirst.filteredRows).toHaveLength(docsFirst.rows.length);
    expectSameRowRefs(docsFirst.filteredRows, docsSecond.filteredRows);
    expect(findRow(docsFirst.filteredRows, "tab", (row) => row.tab.id === 2)).toMatchObject({
      matchesSearch: true,
    });
    expect(findRow(docsFirst.filteredRows, "tab", (row) => row.tab.id === 1)).toMatchObject({
      matchesSearch: false,
    });
    expect(
      findRow(docsFirst.filteredRows, "window", (row) => row.windowId === 1).matchesSearch,
    ).toBe(true);
    expect(
      findRow(docsFirst.filteredRows, "window", (row) => row.windowId === 2).matchesSearch,
    ).toBe(false);

    const notes = selectRows(state, {
      searchTerm: "note",
      filterMode: "highlight",
    });

    expectSameRowRefs(docsFirst.rows, notes.rows);
    // 命中状态未变的派生行继续复用；命中翻转的行才换新对象。
    expect(findRow(notes.filteredRows, "tab", (row) => row.tab.id === 1)).toBe(
      findRow(docsFirst.filteredRows, "tab", (row) => row.tab.id === 1),
    );
    expect(findRow(notes.filteredRows, "tab", (row) => row.tab.id === 2)).not.toBe(
      findRow(docsFirst.filteredRows, "tab", (row) => row.tab.id === 2),
    );
    expect(findRow(notes.filteredRows, "tab", (row) => row.tab.id === 3)).not.toBe(
      findRow(docsFirst.filteredRows, "tab", (row) => row.tab.id === 3),
    );
  });

  it("keeps collapsed window/group behavior and memoizes rows across collapse toggles", () => {
    const state = createBaseState();

    const expanded = selectRows(state);
    const collapsedWindow = selectRows(state, { collapsedWindowIds: [2] });
    const expandedAgain = selectRows(state);

    expect(collapsedWindow.rows.map((row) => row.key)).not.toContain("tab-6");
    expect(findRow(collapsedWindow.rows, "window", (row) => row.windowId === 2)).not.toBe(
      findRow(expanded.rows, "window", (row) => row.windowId === 2),
    );
    expectSameRowRefs(expanded.rows, expandedAgain.rows);

    const collapsedSearch = selectRows(state, {
      collapsedWindowIds: [2],
      searchTerm: "calendar",
      filterMode: "filter",
    });
    expect(collapsedSearch.filteredRows.map((row) => row.key)).toEqual([
      "window-2",
      "tab-6",
    ]);
    expect(
      collapsedSearch.rows.some((row) => row.key === "tab-6"),
    ).toBe(true);
  });

  it("reuses the collapsed group row when a group is collapsed and expanded again", () => {
    const state = createBaseState();
    const group = state.groupsById[10];

    const collapsedState = upsertGroupRecord(state, { ...group, collapsed: true });
    const collapsed = selectRows(collapsedState);
    const collapsedRow = findRow(collapsed.rows, "group", (row) => row.groupId === 10);

    expect(collapsedRow).toMatchObject({ collapsed: true });
    expect(collapsed.rows.some((row) => row.key === "tab-1")).toBe(false);

    const expandedState = upsertGroupRecord(collapsedState, {
      ...collapsedState.groupsById[10],
      collapsed: false,
    });
    const expandedAgain = selectRows(expandedState);

    expect(findRow(expandedAgain.rows, "group", (row) => row.groupId === 10)).toBe(
      findRow(selectRows(state).rows, "group", (row) => row.groupId === 10),
    );
    expect(expandedAgain.rows.some((row) => row.key === "tab-1")).toBe(true);
  });

  it("never serves a cached row for a TabRecord seen under another windowId", () => {
    const consistentState = createStateFromTabs(
      [makeTab({ id: 1, windowId: 1, title: "Shared tab", active: true })],
      1,
    );
    const sharedTab = consistentState.tabsById[1];
    const misplacedState: TabStoreState = {
      ...consistentState,
      windowTabIds: { 2: [1] },
      windowOrder: [2],
      focusedWindowId: 2,
    };

    const misplacedFirst = selectRows(misplacedState);
    const consistent = selectRows(consistentState);
    const misplacedSecond = selectRows(misplacedState);

    expect(findRow(misplacedFirst.rows, "tab", () => true).windowId).toBe(2);
    expect(findRow(consistent.rows, "tab", () => true).windowId).toBe(1);
    expect(findRow(misplacedSecond.rows, "tab", () => true).windowId).toBe(2);
    expect(findRow(misplacedSecond.rows, "tab", () => true).tab).toBe(sharedTab);
    expect(findRow(consistent.rows, "tab", () => true).tab).toBe(sharedTab);
  });
});
