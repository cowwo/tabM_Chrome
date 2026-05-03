import { describe, expect, it, vi } from "vitest";
import { executeTabCommand } from "../src/background/commandExecutor";

function createChromeApiMocks() {
  return {
    tabsGet: vi.fn(async () => ({ id: 1, windowId: 1, index: 0, groupId: -1, pinned: false })),
    tabsMove: vi.fn(async () => undefined),
    tabsGroup: vi.fn(async () => 88),
    tabsUngroup: vi.fn(async () => undefined),
    tabsUpdate: vi.fn(async () => undefined),
    tabsRemove: vi.fn(async () => undefined),
    tabsCreate: vi.fn(async () => ({ id: 99, windowId: 99, index: 0 } as { id?: number; windowId?: number; index?: number })),
    windowsRemove: vi.fn(async () => undefined),
    windowsUpdate: vi.fn(async () => ({ id: 1 } as { id?: number; focused?: boolean })),
    windowsCreate: vi.fn(async () => ({ id: 99 })),
    tabGroupsGet: vi.fn(async () => ({
      id: 12,
      collapsed: false,
      color: "blue" as chrome.tabGroups.ColorEnum,
      title: "测试组",
      windowId: 1
    })),
    tabGroupsUpdate: vi.fn(async () => undefined)
  };
}

function toChromeApi(mocks: ReturnType<typeof createChromeApiMocks>) {
  return {
    tabs: {
      get: mocks.tabsGet,
      move: mocks.tabsMove,
      group: mocks.tabsGroup,
      ungroup: mocks.tabsUngroup,
      update: mocks.tabsUpdate,
      remove: mocks.tabsRemove,
      create: mocks.tabsCreate
    },
    windows: {
      remove: mocks.windowsRemove,
      update: mocks.windowsUpdate,
      create: mocks.windowsCreate
    },
    tabGroups: {
      get: mocks.tabGroupsGet,
      update: mocks.tabGroupsUpdate
    }
  };
}

describe("commandExecutor", () => {
  it("skips missing tab ids when moving selected tabs to a new window", async () => {
    const mocks = createChromeApiMocks();
    mocks.tabsGet
      .mockRejectedValueOnce(new Error("No tab with id: 999."))
      .mockResolvedValueOnce({ id: 12, windowId: 4, index: 1, groupId: -1, pinned: false });
    mocks.windowsCreate.mockResolvedValueOnce({ id: 9 });

    const result = await executeTabCommand(
      {
        type: "tabs/move-to-new-window",
        tabIds: [999, 12]
      },
      toChromeApi(mocks)
    );

    expect(mocks.tabsMove).toHaveBeenCalledWith([12], {
      windowId: 9,
      index: 0
    });
    expect(result.affectedWindowIds).toEqual([4, 9]);
  });

  it("returns source and new window ids when moving tabs to a new window", async () => {
    const mocks = createChromeApiMocks();
    mocks.tabsGet
      .mockResolvedValueOnce({ id: 11, windowId: 4, index: 0, groupId: -1, pinned: false })
      .mockResolvedValueOnce({ id: 12, windowId: 4, index: 1, groupId: -1, pinned: false });
    mocks.windowsCreate.mockResolvedValueOnce({ id: 9 });

    const result = await executeTabCommand(
      {
        type: "tabs/move-to-new-window",
        tabIds: [11, 12]
      },
      toChromeApi(mocks)
    );

    expect(mocks.windowsCreate).toHaveBeenCalledWith({});
    expect(mocks.tabsMove).toHaveBeenCalledWith([11, 12], {
      windowId: 9,
      index: 0
    });
    expect(result.affectedWindowIds).toEqual([4, 9]);
    expect(result.preferredOrder).toEqual([9, 4]);
  });

  it("returns affected windows for cross-window single-tab move", async () => {
    const mocks = createChromeApiMocks();
    mocks.tabsGet.mockResolvedValueOnce({ id: 7, windowId: 3, index: 5, groupId: -1, pinned: false });

    const result = await executeTabCommand(
      {
        type: "tab/move",
        tabId: 7,
        targetWindowId: 4,
        targetIndex: 2,
        targetGroupId: 66
      },
      toChromeApi(mocks)
    );

    expect(result.affectedWindowIds).toEqual([3, 4]);
  });

  it("activates a tab and focuses its window", async () => {
    const mocks = createChromeApiMocks();
    mocks.tabsGet.mockResolvedValueOnce({ id: 5, windowId: 9, index: 0, groupId: -1, pinned: false });

    await executeTabCommand(
      {
        type: "tab/activate",
        tabId: 5
      },
      toChromeApi(mocks)
    );

    expect(mocks.tabsGet).toHaveBeenCalledWith(5);
    expect(mocks.tabsUpdate).toHaveBeenCalledWith(5, {
      active: true
    });
    expect(mocks.windowsUpdate).toHaveBeenCalledWith(9, {
      focused: true
    });
    expect(mocks.tabGroupsUpdate).not.toHaveBeenCalled();
  });

  it("updates pinned state for tabs", async () => {
    const mocks = createChromeApiMocks();

    await executeTabCommand(
      {
        type: "tab/set-pinned",
        tabId: 5,
        pinned: true
      },
      toChromeApi(mocks)
    );

    expect(mocks.tabsUpdate).toHaveBeenCalledWith(5, {
      pinned: true
    });
    expect(mocks.tabsRemove).not.toHaveBeenCalled();
  });

  it("closes tabs", async () => {
    const mocks = createChromeApiMocks();

    await executeTabCommand(
      {
        type: "tab/close",
        tabId: 5
      },
      toChromeApi(mocks)
    );

    expect(mocks.tabsRemove).toHaveBeenCalledWith(5);
    expect(mocks.tabsUpdate).not.toHaveBeenCalledWith(5, {
      active: true
    });
  });

  it("closes multiple tabs in one command", async () => {
    const mocks = createChromeApiMocks();

    await executeTabCommand(
      {
        type: "tabs/close",
        tabIds: [5, 6, 7]
      },
      toChromeApi(mocks)
    );

    expect(mocks.tabsRemove).toHaveBeenCalledWith([5, 6, 7]);
  });

  it("returns the owning window when updating collapsed state for tab groups", async () => {
    const mocks = createChromeApiMocks();
    mocks.tabGroupsGet.mockResolvedValueOnce({
      id: 12,
      collapsed: false,
      color: "blue" as chrome.tabGroups.ColorEnum,
      title: "测试组",
      windowId: 7
    });

    const result = await executeTabCommand(
      {
        type: "group/set-collapsed",
        groupId: 12,
        collapsed: true
      },
      toChromeApi(mocks)
    );

    expect(mocks.tabGroupsGet).toHaveBeenCalledWith(12);
    expect(mocks.tabGroupsUpdate).toHaveBeenCalledWith(12, {
      collapsed: true
    });
    expect(result.affectedWindowIds).toEqual([7]);
    expect(mocks.tabsGet).not.toHaveBeenCalled();
    expect(mocks.tabsUpdate).not.toHaveBeenCalled();
    expect(mocks.windowsUpdate).not.toHaveBeenCalled();
  });

  it("moves a tab into another group", async () => {
    const mocks = createChromeApiMocks();
    mocks.tabsGet.mockResolvedValueOnce({ id: 7, windowId: 3, index: 5, groupId: -1, pinned: false });

    await executeTabCommand(
      {
        type: "tab/move",
        tabId: 7,
        targetWindowId: 4,
        targetIndex: 2,
        targetGroupId: 66
      },
      toChromeApi(mocks)
    );

    expect(mocks.tabsMove).toHaveBeenCalledWith(7, {
      windowId: 4,
      index: 2
    });
    expect(mocks.tabsGroup).toHaveBeenCalledWith({
      groupId: 66,
      tabIds: 7
    });
    expect(mocks.tabsUngroup).not.toHaveBeenCalled();
  });

  it("moves a tab out of a group", async () => {
    const mocks = createChromeApiMocks();
    mocks.tabsGet.mockResolvedValueOnce({ id: 8, windowId: 3, index: 5, groupId: 66, pinned: false });

    await executeTabCommand(
      {
        type: "tab/move",
        tabId: 8,
        targetWindowId: 4,
        targetIndex: 0,
        targetGroupId: null
      },
      toChromeApi(mocks)
    );

    expect(mocks.tabsMove).toHaveBeenCalledWith(8, {
      windowId: 4,
      index: 0
    });
    expect(mocks.tabsUngroup).toHaveBeenCalledWith(8);
    expect(mocks.tabsGroup).not.toHaveBeenCalled();
  });

  it("moves multiple selected tabs as one block and regroups them together", async () => {
    const mocks = createChromeApiMocks();
    mocks.tabsGet
      .mockResolvedValueOnce({ id: 7, windowId: 4, index: 2, groupId: -1, pinned: false })
      .mockResolvedValueOnce({ id: 8, windowId: 4, index: 5, groupId: 66, pinned: false })
      .mockResolvedValueOnce({ id: 9, windowId: 5, index: 1, groupId: -1, pinned: false });

    await executeTabCommand(
      {
        type: "tabs/move",
        tabIds: [7, 8, 9],
        targetWindowId: 4,
        targetIndex: 6,
        targetGroupId: 88
      },
      toChromeApi(mocks)
    );

    expect(mocks.tabsMove).toHaveBeenCalledWith([7, 8, 9], {
      windowId: 4,
      index: 4
    });
    expect(mocks.tabsGroup).toHaveBeenCalledWith({
      groupId: 88,
      tabIds: [7, 8, 9]
    });
    expect(mocks.tabsUngroup).not.toHaveBeenCalled();
  });

  it("keeps same-window multi-tab moves contiguous after normalization", async () => {
    const mocks = createChromeApiMocks();
    mocks.tabsGet
      .mockResolvedValueOnce({ id: 1, windowId: 4, index: 0, groupId: -1, pinned: false })
      .mockResolvedValueOnce({ id: 2, windowId: 4, index: 1, groupId: -1, pinned: false });
    mocks.tabsGet
      .mockResolvedValueOnce({ id: 1, windowId: 4, index: 5, groupId: -1, pinned: false })
      .mockResolvedValueOnce({ id: 2, windowId: 4, index: 6, groupId: -1, pinned: false });

    await executeTabCommand(
      {
        type: "tabs/move",
        tabIds: [1, 2],
        targetWindowId: 4,
        targetIndex: 4,
        targetGroupId: null
      },
      toChromeApi(mocks)
    );

    expect(mocks.tabsMove).toHaveBeenNthCalledWith(1, 1, {
      windowId: 4,
      index: -1
    });
    expect(mocks.tabsMove).toHaveBeenNthCalledWith(2, 2, {
      windowId: 4,
      index: -1
    });
    expect(mocks.tabsMove).toHaveBeenNthCalledWith(3, 1, {
      windowId: 4,
      index: 2
    });
    expect(mocks.tabsMove).toHaveBeenNthCalledWith(4, 2, {
      windowId: 4,
      index: 3
    });
    expect(mocks.tabsUngroup).toHaveBeenCalledWith([1, 2]);
  });

  it("keeps cross-window multi-tab targetIndex unchanged before regrouping", async () => {
    const mocks = createChromeApiMocks();
    mocks.tabsGet
      .mockResolvedValueOnce({ id: 7, windowId: 4, index: 2, groupId: -1, pinned: false })
      .mockResolvedValueOnce({ id: 8, windowId: 4, index: 5, groupId: 66, pinned: false })
      .mockResolvedValueOnce({ id: 9, windowId: 5, index: 1, groupId: -1, pinned: false });

    await executeTabCommand(
      {
        type: "tabs/move",
        tabIds: [7, 8, 9],
        targetWindowId: 4,
        targetIndex: 6,
        targetGroupId: 88
      },
      toChromeApi(mocks)
    );

    expect(mocks.tabsMove).toHaveBeenCalledWith([7, 8, 9], {
      windowId: 4,
      index: 4
    });
    expect(mocks.tabsGroup).toHaveBeenCalledWith({
      groupId: 88,
      tabIds: [7, 8, 9]
    });
  });

  it("moves a whole group within the same window and re-adds only ungrouped tabs", async () => {
    const mocks = createChromeApiMocks();
    mocks.tabGroupsGet.mockResolvedValueOnce({
      id: 66,
      collapsed: false,
      color: "pink",
      title: "66",
      windowId: 2
    });
    // 1st query: tabs at [4,5]
    mocks.tabsGet
      .mockResolvedValueOnce({ id: 101, windowId: 2, index: 4, groupId: 66, pinned: false })
      .mockResolvedValueOnce({ id: 102, windowId: 2, index: 5, groupId: 66, pinned: false });
    // 2nd query (after move to end): tabs at [6,7]
    mocks.tabsGet
      .mockResolvedValueOnce({ id: 101, windowId: 2, index: 6, groupId: 66, pinned: false })
      .mockResolvedValueOnce({ id: 102, windowId: 2, index: 7, groupId: 66, pinned: false });
    // 3rd query (after move to target, leak check): tab 102 leaked
    mocks.tabsGet
      .mockResolvedValueOnce({ id: 101, windowId: 2, index: 1, groupId: 66, pinned: false })
      .mockResolvedValueOnce({ id: 102, windowId: 2, index: 2, groupId: -1, pinned: false });

    await executeTabCommand(
      {
        type: "group/move",
        groupId: 66,
        tabIds: [101, 102],
        targetWindowId: 2,
        targetIndex: 1,
        title: "66",
        color: "pink",
        collapsed: false
      },
      toChromeApi(mocks)
    );

    // 先逐个移到末尾
    expect(mocks.tabsMove).toHaveBeenNthCalledWith(1, 101, { windowId: 2, index: -1 });
    expect(mocks.tabsMove).toHaveBeenNthCalledWith(2, 102, { windowId: 2, index: -1 });
    // 再逐个移到目标索引
    expect(mocks.tabsMove).toHaveBeenNthCalledWith(3, 101, { windowId: 2, index: 1 });
    expect(mocks.tabsMove).toHaveBeenNthCalledWith(4, 102, { windowId: 2, index: 2 });
    // 泄露修复
    expect(mocks.tabsGroup).toHaveBeenCalledWith({
      groupId: 66,
      tabIds: [102]
    });
    expect(mocks.tabGroupsUpdate).not.toHaveBeenCalled();
  });

  it("moves a whole group across windows and rebuilds the group metadata", async () => {
    const mocks = createChromeApiMocks();
    mocks.tabGroupsGet.mockResolvedValueOnce({
      id: 66,
      collapsed: true,
      color: "pink",
      title: "66",
      windowId: 2
    });
    mocks.tabsGet
      .mockResolvedValueOnce({ id: 101, windowId: 2, index: 4, groupId: 66, pinned: false })
      .mockResolvedValueOnce({ id: 102, windowId: 2, index: 5, groupId: 66, pinned: false });
    mocks.tabsGroup.mockResolvedValueOnce(77);

    await executeTabCommand(
      {
        type: "group/move",
        groupId: 66,
        tabIds: [101, 102],
        targetWindowId: 9,
        targetIndex: 3,
        title: "66",
        color: "pink",
        collapsed: true
      },
      toChromeApi(mocks)
    );

    expect(mocks.tabsMove).toHaveBeenCalledWith([101, 102], {
      windowId: 9,
      index: 3
    });
    expect(mocks.tabsGroup).toHaveBeenCalledWith({
      createProperties: {
        windowId: 9
      },
      tabIds: [101, 102]
    });
    expect(mocks.tabGroupsUpdate).toHaveBeenCalledWith(77, {
      title: "66",
      color: "pink",
      collapsed: true
    });
  });

  it("rejects pinned tabs for drag move commands", async () => {
    const mocks = createChromeApiMocks();
    mocks.tabsGet.mockResolvedValueOnce({ id: 7, windowId: 3, index: 5, groupId: -1, pinned: true });

    await expect(
      executeTabCommand(
        {
          type: "tab/move",
          tabId: 7,
          targetWindowId: 4,
          targetIndex: 2,
          targetGroupId: null
        },
        toChromeApi(mocks)
      )
    ).rejects.toThrow("Pinned tabs cannot be dragged yet");

    expect(mocks.tabsMove).not.toHaveBeenCalled();
  });

  it("rejects pinned tabs inside a multi-tab drag move", async () => {
    const mocks = createChromeApiMocks();
    mocks.tabsGet
      .mockResolvedValueOnce({ id: 7, windowId: 3, index: 5, groupId: -1, pinned: false })
      .mockResolvedValueOnce({ id: 8, windowId: 3, index: 6, groupId: -1, pinned: true });

    await expect(
      executeTabCommand(
        {
          type: "tabs/move",
          tabIds: [7, 8],
          targetWindowId: 4,
          targetIndex: 2,
          targetGroupId: null
        },
        toChromeApi(mocks)
      )
    ).rejects.toThrow("Pinned tabs cannot be dragged yet");

    expect(mocks.tabsMove).not.toHaveBeenCalled();
  });
});
