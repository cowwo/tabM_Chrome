import {
  createSnapshot,
  createStateFromTabs,
} from "../src/shared/domain/tabState";
import { NO_TAB_GROUP_ID } from "../src/shared/defaults";
import { selectPanelViewModel } from "../src/shared/domain/panelViewModel";
import type { TabRecord } from "../src/shared/types";

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

describe("selectPanelViewModel", () => {
  it("builds one consistent view model for a collapsed searchable window", () => {
    const snapshot = createSnapshot(
      createStateFromTabs(
        [
          makeTab({
            id: 1,
            windowId: 1,
            index: 0,
            title: "Visible tab",
            active: true,
          }),
          makeTab({
            id: 2,
            windowId: 1,
            index: 1,
            title: "Hidden target",
            url: "https://example.com/hidden-target",
          }),
        ],
        1,
      ),
      7,
    );

    const viewModel = selectPanelViewModel({
      snapshot,
      collapsedWindowIds: [1],
      searchTerm: "hidden",
      filterMode: "filter",
      locale: "en",
    });

    expect(viewModel.sections).toHaveLength(1);
    expect(viewModel.rows).toHaveLength(3);
    expect(viewModel.rows.map((row) => row.kind)).toEqual([
      "window",
      "tab",
      "tab",
    ]);
    expect(viewModel.searchResult).toEqual({
      rows: [
        expect.objectContaining({ kind: "window", windowId: 1 }),
        expect.objectContaining({
          kind: "tab",
          tab: expect.objectContaining({ id: 2 }),
        }),
      ],
      matchCount: 1,
    });
    expect(viewModel.filteredRows).toHaveLength(2);
    expect(viewModel.renderSections).toHaveLength(1);
    expect(viewModel.filteredRowKeySet.has("window-1")).toBe(true);
    expect(viewModel.filteredRowKeySet.has("tab-2")).toBe(true);
    expect(viewModel.currentActiveTabId).toBe(1);
    expect(viewModel.currentActiveGroupId).toBeNull();
    expect(viewModel.searchMatchingTabIds).toEqual([2]);
  });
});
