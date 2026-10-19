import { describe, expect, it, vi } from "vitest";
import { backfillMissingGroupForTab, syncGroupSnapshot } from "../src/background/groupSync";
import { NO_TAB_GROUP_ID } from "../src/shared/defaults";
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
    lastAccessed: overrides.lastAccessed ?? 0
  };
}

function makeGroup(overrides: Partial<TabGroupRecord> = {}): TabGroupRecord {
  return {
    id: overrides.id ?? 10,
    windowId: overrides.windowId ?? 1,
    title: overrides.title ?? "编组",
    color: overrides.color ?? "blue",
    collapsed: overrides.collapsed ?? false
  };
}

describe("groupSync", () => {
  it("backfills missing group metadata only for grouped tabs without a known group", async () => {
    const queryGroup = vi.fn(async () => makeGroup({ id: 10 }));
    const upsertGroup = vi.fn();
    const removeGroup = vi.fn();

    await backfillMissingGroupForTab(makeTab({ groupId: 10 }), {
      hasKnownGroup: () => false,
      queryGroup,
      upsertGroup,
      removeGroup
    });

    expect(queryGroup).toHaveBeenCalledTimes(1);
    expect(upsertGroup).toHaveBeenCalledWith(expect.objectContaining({ id: 10 }));
    expect(removeGroup).not.toHaveBeenCalled();
  });

  it("skips missing-group backfill when the tab is ungrouped or the group is already known", async () => {
    const queryGroup = vi.fn(async () => makeGroup());
    const upsertGroup = vi.fn();
    const removeGroup = vi.fn();

    await backfillMissingGroupForTab(makeTab({ groupId: NO_TAB_GROUP_ID }), {
      hasKnownGroup: () => false,
      queryGroup,
      upsertGroup,
      removeGroup
    });
    await backfillMissingGroupForTab(makeTab({ groupId: 10 }), {
      hasKnownGroup: () => true,
      queryGroup,
      upsertGroup,
      removeGroup
    });

    expect(queryGroup).not.toHaveBeenCalled();
    expect(upsertGroup).not.toHaveBeenCalled();
    expect(removeGroup).not.toHaveBeenCalled();
  });

  it("syncs group snapshots by updating group metadata once and then each tab", async () => {
    const calls: string[] = [];

    await syncGroupSnapshot({
      queryGroup: async () => {
        calls.push("query-group");
        return makeGroup({ id: 10 });
      },
      queryTabsInGroup: async () => {
        calls.push("query-tabs");
        return [makeTab({ id: 1, groupId: 10 }), makeTab({ id: 2, groupId: 10 })];
      },
      upsertGroup: (group) => {
        calls.push(`upsert-group:${group.id}`);
      },
      upsertTab: (tab) => {
        calls.push(`upsert-tab:${tab.id}`);
      },
      removeGroup: () => {
        calls.push("remove-group");
      }
    });

    expect(calls).toEqual([
      "query-group",
      "upsert-group:10",
      "query-tabs",
      "upsert-tab:1",
      "upsert-tab:2"
    ]);
  });

  it("allows consecutive group syncs to complete independently", async () => {
    const upsertGroup = vi.fn();
    const upsertTab = vi.fn();

    await syncGroupSnapshot({
      queryGroup: async () => makeGroup({ id: 10 }),
      queryTabsInGroup: async () => [makeTab({ id: 1, groupId: 10 })],
      upsertGroup,
      upsertTab,
      removeGroup: vi.fn()
    });
    await syncGroupSnapshot({
      queryGroup: async () => makeGroup({ id: 11 }),
      queryTabsInGroup: async () => [makeTab({ id: 2, groupId: 11 })],
      upsertGroup,
      upsertTab,
      removeGroup: vi.fn()
    });

    expect(upsertGroup).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 10 }));
    expect(upsertGroup).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 11 }));
    expect(upsertTab).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 1 }));
    expect(upsertTab).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 2 }));
  });

  it("keeps the group when only the tab query fails", async () => {
    const upsertGroup = vi.fn();
    const upsertTab = vi.fn();
    const removeGroup = vi.fn();

    await syncGroupSnapshot({
      queryGroup: async () => makeGroup({ id: 10 }),
      queryTabsInGroup: async () => {
        throw new Error("tabs failed");
      },
      upsertGroup,
      upsertTab,
      removeGroup
    });

    expect(upsertGroup).toHaveBeenCalledWith(expect.objectContaining({ id: 10 }));
    expect(upsertTab).not.toHaveBeenCalled();
    expect(removeGroup).not.toHaveBeenCalled();
  });
});
