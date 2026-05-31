import { applyPatch, createStateFromTabs, removeTabRecord, upsertTabRecord } from "../src/shared/domain/tabState";
import { NO_TAB_GROUP_ID } from "../src/shared/defaults";
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
    favIconUrl: overrides.favIconUrl ?? null
  };
}

describe("tab state", () => {
  it("groups tabs by window and keeps windows sorted by window id", () => {
    const state = createStateFromTabs(
      [
        makeTab({ id: 3, windowId: 2, index: 1 }),
        makeTab({ id: 1, windowId: 1, index: 2 }),
        makeTab({ id: 2, windowId: 1, index: 0 })
      ],
      2
    );

    expect(state.windowOrder).toEqual([1, 2]);
    expect(state.windowTabIds[1]).toEqual([2, 1]);
    expect(state.windowTabIds[2]).toEqual([3]);
  });

  it("keeps window order stable when adding tabs into a new window", () => {
    const initial = createStateFromTabs(
      [
        makeTab({ id: 1, windowId: 1, index: 0 }),
        makeTab({ id: 2, windowId: 3, index: 0 })
      ],
      1
    );

    const next = upsertTabRecord(
      initial,
      makeTab({
        id: 3,
        windowId: 2,
        index: 0
      })
    );

    expect(next.windowTabIds[1]).toEqual([1]);
    expect(next.windowTabIds[2]).toEqual([3]);
    expect(next.windowTabIds[3]).toEqual([2]);
    expect(next.windowOrder).toEqual([1, 2, 3]);
  });

  it("moves an existing tab into a new window and keeps that window visible", () => {
    const initial = createStateFromTabs(
      [
        makeTab({ id: 1, windowId: 1, index: 0 }),
        makeTab({ id: 2, windowId: 2, index: 0 }),
        makeTab({ id: 3, windowId: 2, index: 1 })
      ],
      1
    );

    const next = upsertTabRecord(
      initial,
      makeTab({
        id: 2,
        windowId: 4,
        index: 0
      })
    );

    expect(next.windowTabIds[2]).toEqual([3]);
    expect(next.windowTabIds[4]).toEqual([2]);
    expect(next.windowOrder).toEqual([1, 2, 4]);
  });

  it("keeps a tab in the list when its index changes within the same window", () => {
    const initial = createStateFromTabs(
      [
        makeTab({ id: 1, windowId: 2, index: 0 }),
        makeTab({ id: 2, windowId: 2, index: 1 }),
        makeTab({ id: 3, windowId: 2, index: 2 })
      ],
      2
    );

    const next = upsertTabRecord(
      initial,
      makeTab({
        id: 1,
        windowId: 2,
        index: 2
      })
    );

    expect(next.windowTabIds[2]).toEqual([2, 3, 1]);
  });

  it("keeps window tab order stable when only the active flag changes", () => {
    const initial = createStateFromTabs(
      [
        makeTab({ id: 1, windowId: 2, index: 0, active: false }),
        makeTab({ id: 2, windowId: 2, index: 1, active: true }),
        makeTab({ id: 3, windowId: 2, index: 2, active: false })
      ],
      2
    );

    const next = upsertTabRecord(
      initial,
      makeTab({
        id: 2,
        windowId: 2,
        index: 1,
        active: false
      })
    );

    expect(next.windowTabIds[2]).toEqual([1, 2, 3]);
  });

  it("updates focusedWindowId without reordering windows", () => {
    const initial = createStateFromTabs(
      [
        makeTab({ id: 1, windowId: 1, index: 0 }),
        makeTab({ id: 2, windowId: 2, index: 0 })
      ],
      1
    );

    const focused = applyPatch(initial, {
      type: "window/focus",
      windowId: 2
    });

    expect(focused.windowOrder).toEqual([1, 2]);
    expect(focused.focusedWindowId).toBe(2);
  });

  it("keeps remaining windows sorted after removing a window", () => {
    const initial = createStateFromTabs(
      [
        makeTab({ id: 1, windowId: 1, index: 0 }),
        makeTab({ id: 2, windowId: 2, index: 0 }),
        makeTab({ id: 3, windowId: 3, index: 0 })
      ],
      2
    );

    const removed = removeTabRecord(initial, 2, 2);

    expect(removed.windowOrder).toEqual([1, 3]);
    expect(removed.focusedWindowId).toBe(1);
    expect(removed.tabsById[2]).toBeUndefined();
  });

  it("preserves an explicit focused window during initialization even before tabs exist", () => {
    const state = createStateFromTabs([], 7);

    expect(state.focusedWindowId).toBe(7);
    expect(state.windowOrder).toEqual([]);
  });

  it("records a focus event before tabs for that window arrive", () => {
    const state = createStateFromTabs(
      [makeTab({ id: 1, windowId: 1, index: 0 })],
      1
    );

    const next = applyPatch(state, {
      type: "window/focus",
      windowId: 2
    });

    expect(next.focusedWindowId).toBe(2);
    expect(next.windowOrder).toEqual([1]);
  });

  it("preserves a pending focused window across unrelated tab upserts", () => {
    const initial = createStateFromTabs(
      [makeTab({ id: 1, windowId: 1, index: 0 })],
      1
    );

    const pendingFocus = applyPatch(initial, {
      type: "window/focus",
      windowId: 2
    });

    const next = upsertTabRecord(
      pendingFocus,
      makeTab({ id: 2, windowId: 1, index: 1 })
    );

    expect(next.focusedWindowId).toBe(2);
    expect(next.windowOrder).toEqual([1]);
  });

  it("falls back to the first remaining window when the focused window is removed", () => {
    const state = createStateFromTabs(
      [
        makeTab({ id: 1, windowId: 1, index: 0 }),
        makeTab({ id: 2, windowId: 2, index: 0 }),
        makeTab({ id: 3, windowId: 3, index: 0 })
      ],
      2
    );

    const next = removeTabRecord(state, 2, 2);

    expect(next.windowOrder).toEqual([1, 3]);
    expect(next.focusedWindowId).toBe(1);
    expect(next.tabsById[2]).toBeUndefined();
  });
});
