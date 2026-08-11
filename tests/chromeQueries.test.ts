import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLastFocusedWindowId,
  queryAllTabGroupsForTabs,
  queryAllWindowIds,
  queryGroups,
  queryNormalizedGroup,
  queryNormalizedTabsInGroup,
  queryNormalizedTabsInWindow
} from "../src/background/chromeQueries";
import { NO_TAB_GROUP_ID } from "../src/shared/defaults";

function makeChromeTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: overrides.id,
    windowId: overrides.windowId,
    index: overrides.index,
    groupId: overrides.groupId,
    title: overrides.title,
    url: overrides.url,
    pendingUrl: overrides.pendingUrl,
    pinned: overrides.pinned,
    active: overrides.active,
    audible: overrides.audible,
    discarded: overrides.discarded,
    favIconUrl: overrides.favIconUrl
  } as chrome.tabs.Tab;
}

describe("chromeQueries", () => {
  beforeEach(() => {
    vi.stubGlobal("chrome", {
      runtime: {
        getURL: (path: string) => `chrome-extension://unit-test/${path}`
      }
    });
  });

  it("should return null when last focused window lookup fails", async () => {
    await expect(
      getLastFocusedWindowId({
        windows: {
          getLastFocused: vi.fn(async () => {
            throw new Error("boom");
          }),
          getAll: vi.fn(async () => [])
        }
      })
    ).resolves.toBeNull();
  });

  it("should return window ids from getAll", async () => {
    await expect(
      queryAllWindowIds({
        windows: {
          getLastFocused: vi.fn(),
          getAll: vi.fn(async () => [{ id: 1 }, { id: 2 }, { id: 3 }])
        }
      })
    ).resolves.toEqual([1, 2, 3]);
  });

  it("should return empty array when getAll fails", async () => {
    await expect(
      queryAllWindowIds({
        windows: {
          getLastFocused: vi.fn(),
          getAll: vi.fn(async () => {
            throw new Error("boom");
          })
        }
      })
    ).resolves.toEqual([]);
  });

  it("should deduplicate group ids before querying", async () => {
    const tabGroupsGet = vi
      .fn(async (groupId: number) => ({
        id: groupId,
        windowId: 1,
        title: `G${groupId}`,
        color: "blue",
        collapsed: false
      }) as chrome.tabGroups.TabGroup)
      .mockName("tabGroups.get");

    const groups = await queryAllTabGroupsForTabs(
      [
        makeChromeTab({ groupId: NO_TAB_GROUP_ID }),
        makeChromeTab({ groupId: 12 }),
        makeChromeTab({ groupId: 12 }),
        makeChromeTab({ groupId: 18 })
      ],
      {
        tabGroups: {
          get: tabGroupsGet
        }
      }
    );

    expect(tabGroupsGet).toHaveBeenCalledTimes(2);
    expect(tabGroupsGet).toHaveBeenNthCalledWith(1, 12);
    expect(tabGroupsGet).toHaveBeenNthCalledWith(2, 18);
    expect(groups).toEqual([
      { id: 12, windowId: 1, title: "G12", color: "blue", collapsed: false },
      { id: 18, windowId: 1, title: "G18", color: "blue", collapsed: false }
    ]);
  });

  it("should skip groups that fail to load", async () => {
    const tabGroupsGet = vi.fn(async (groupId: number) => {
      if (groupId === 13) {
        throw new Error("missing group");
      }

      return {
        id: groupId,
        windowId: 2,
        title: `G${groupId}`,
        color: "red",
        collapsed: true
      } as chrome.tabGroups.TabGroup;
    });

    await expect(
      queryGroups([11, 13, 17], {
        tabGroups: {
          get: tabGroupsGet
        }
      })
    ).resolves.toEqual([
      { id: 11, windowId: 2, title: "G11", color: "red", collapsed: true },
      { id: 17, windowId: 2, title: "G17", color: "red", collapsed: true }
    ]);
  });

  it("should normalize a provided group without querying chrome", async () => {
    const tabGroupsGet = vi.fn();

    await expect(
      queryNormalizedGroup(
        8,
        {
          id: 8,
          windowId: 3,
          title: "  工作  ",
          color: "green",
          collapsed: 1 as unknown as boolean
        } as chrome.tabGroups.TabGroup,
        {
          tabGroups: {
            get: tabGroupsGet
          }
        }
      )
    ).resolves.toEqual({
      id: 8,
      windowId: 3,
      title: "工作",
      color: "green",
      collapsed: true
    });
    expect(tabGroupsGet).not.toHaveBeenCalled();
  });

  it("should normalize queried tabs in a window and drop invalid tabs", async () => {
    const tabsQuery = vi.fn(async () => [
      makeChromeTab({
        id: 1,
        windowId: 4,
        index: 0,
        groupId: 9,
        title: " Window tab ",
        url: "https://example.com/window",
        favIconUrl: "https://example.com/icon.ico"
      }),
      makeChromeTab({
        id: undefined,
        windowId: 4,
        index: 1,
        title: "Invalid"
      })
    ]);

    await expect(
      queryNormalizedTabsInWindow(4, {
        tabs: {
          query: tabsQuery
        }
      })
    ).resolves.toEqual([
      {
        id: 1,
        windowId: 4,
        index: 0,
        groupId: 9,
        title: "Window tab",
        url: "https://example.com/window",
        pinned: false,
        active: false,
        audible: false,
        discarded: false,
        favIconUrl: "https://example.com/icon.ico",
        lastAccessed: 0
      }
    ]);
    expect(tabsQuery).toHaveBeenCalledWith({ windowId: 4 });
  });

  it("should normalize queried tabs in a group using pendingUrl and default group id", async () => {
    const tabsQuery = vi.fn(async () => [
      makeChromeTab({
        id: 5,
        windowId: 6,
        index: 2,
        title: "Pending",
        pendingUrl: "https://example.com/pending"
      })
    ]);

    await expect(
      queryNormalizedTabsInGroup(99, {
        tabs: {
          query: tabsQuery
        }
      })
    ).resolves.toEqual([
      {
        id: 5,
        windowId: 6,
        index: 2,
        groupId: NO_TAB_GROUP_ID,
        title: "Pending",
        url: "https://example.com/pending",
        pinned: false,
        active: false,
        audible: false,
        discarded: false,
        favIconUrl: null,
        lastAccessed: 0
      }
    ]);
    expect(tabsQuery).toHaveBeenCalledWith({ groupId: 99 });
  });
});
