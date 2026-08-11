import { describe, expect, it, vi } from "vitest";
import {
  createTabEventHandlers,
  createTabGroupEventHandlers,
  createWindowEventHandlers
} from "../src/background/backgroundEventHandlers";

function createTabEventDeps() {
  return {
    traceBackgroundEvent: vi.fn(),
    windowSyncCoordinator: {
      scheduleWindowSync: vi.fn(async () => undefined),
      scheduleCrossWindowSync: vi.fn(async () => undefined)
    },
    detachedTabWindowIds: new Map<number, number>(),
    enqueueStoreTask: vi.fn(async (task: () => Promise<void>) => await task()),
    handleActivated: vi.fn(async () => undefined),
    ensureInitialized: vi.fn(async () => undefined),
    handlePatch: vi.fn(),
    syncGroupFromChrome: vi.fn(async () => undefined),
    store: {
      hasTab: vi.fn(() => true),
      getTab: vi.fn(() => undefined as ReturnType<never>),
      getGroup: vi.fn(() => undefined),
      upsertTab: vi.fn((tab) => ({ type: "tab/upsert", tab })),
      removeTab: vi.fn((tabId, windowId) => ({ type: "tab/remove", tabId, windowId }))
    }
  };
}

describe("backgroundEventHandlers", () => {
  it("should patch-first for tab created", async () => {
    const deps = createTabEventDeps();

    const handlers = createTabEventHandlers(deps as never);
    await handlers.onCreated({
      id: 1,
      windowId: 3,
      index: 0,
      url: "https://example.com",
      title: "Example"
    } as chrome.tabs.Tab);

    expect(deps.store.upsertTab).toHaveBeenCalledTimes(1);
    expect(deps.handlePatch).toHaveBeenCalledTimes(1);
    expect(deps.windowSyncCoordinator.scheduleWindowSync).not.toHaveBeenCalled();
  });

  it("should skip non-visual tab updates", async () => {
    const deps = createTabEventDeps();
    const handlers = createTabEventHandlers(deps as never);

    await handlers.onUpdated(
      1,
      { mutedInfo: { muted: true } },
      {
        id: 1,
        windowId: 3,
        index: 0,
        url: "https://example.com",
        title: "Example"
      } as chrome.tabs.Tab
    );

    expect(deps.enqueueStoreTask).not.toHaveBeenCalled();
    expect(deps.store.upsertTab).not.toHaveBeenCalled();
    expect(deps.handlePatch).not.toHaveBeenCalled();
    expect(deps.windowSyncCoordinator.scheduleWindowSync).not.toHaveBeenCalled();
  });


  it("should patch-first when tab updated changes index", async () => {
    const deps = createTabEventDeps();
    deps.store.getTab = vi.fn(() => ({
      id: 1,
      windowId: 3,
      index: 0,
      groupId: -1,
      title: "Old",
      url: "https://example.com",
      pinned: false,
      active: false,
      audible: false,
      discarded: false,
      favIconUrl: null
    }));

    const handlers = createTabEventHandlers(deps as never);
    await handlers.onUpdated(
      1,
      { title: "New" },
      {
        id: 1,
        windowId: 3,
        index: 2,
        url: "https://example.com",
        title: "New"
      } as chrome.tabs.Tab
    );

    expect(deps.store.upsertTab).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, windowId: 3, index: 2 })
    );
    expect(deps.handlePatch).toHaveBeenCalledWith({
      type: "tab/upsert",
      tab: expect.objectContaining({ id: 1, index: 2 })
    });
    expect(deps.windowSyncCoordinator.scheduleWindowSync).not.toHaveBeenCalled();
    expect(deps.windowSyncCoordinator.scheduleCrossWindowSync).not.toHaveBeenCalled();
  });

  it("should patch-first migration when tab updated changes window", async () => {
    const deps = createTabEventDeps();
    deps.store.getTab = vi.fn(() => ({
      id: 1,
      windowId: 3,
      index: 0,
      groupId: -1,
      title: "Old",
      url: "https://example.com",
      pinned: false,
      active: false,
      audible: false,
      discarded: false,
      favIconUrl: null
    }));

    const handlers = createTabEventHandlers(deps as never);
    await handlers.onUpdated(
      1,
      { title: "New" },
      {
        id: 1,
        windowId: 5,
        index: 0,
        url: "https://example.com",
        title: "New"
      } as chrome.tabs.Tab
    );

    expect(deps.store.upsertTab).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, windowId: 5, index: 0 })
    );
    expect(deps.handlePatch).toHaveBeenCalledWith({
      type: "tab/upsert",
      tab: expect.objectContaining({ id: 1, windowId: 5 })
    });
    expect(deps.windowSyncCoordinator.scheduleCrossWindowSync).not.toHaveBeenCalled();
    expect(deps.windowSyncCoordinator.scheduleWindowSync).not.toHaveBeenCalled();
  });

  it("should patch-first for tab removed even when window is closing", async () => {
    const deps = createTabEventDeps();
    deps.store.hasTab = vi.fn(() => true);

    const handlers = createTabEventHandlers(deps as never);
    await handlers.onRemoved(7, { windowId: 9, isWindowClosing: true } as chrome.tabs.TabRemoveInfo);

    expect(deps.store.removeTab).toHaveBeenCalledWith(7, 9);
    expect(deps.handlePatch).toHaveBeenCalledWith({
      type: "tab/remove",
      tabId: 7,
      windowId: 9
    });
    expect(deps.windowSyncCoordinator.scheduleWindowSync).not.toHaveBeenCalled();
  });

  it("should patch-first for tab removed when tab exists", async () => {
    const deps = createTabEventDeps();
    deps.store.hasTab = vi.fn(() => true);

    const handlers = createTabEventHandlers(deps as never);
    await handlers.onRemoved(7, { windowId: 9, isWindowClosing: false } as chrome.tabs.TabRemoveInfo);

    expect(deps.store.removeTab).toHaveBeenCalledWith(7, 9);
    expect(deps.handlePatch).toHaveBeenCalledWith({
      type: "tab/remove",
      tabId: 7,
      windowId: 9
    });
    expect(deps.windowSyncCoordinator.scheduleWindowSync).not.toHaveBeenCalled();
  });

  it("should fall back to window sync when removed tab is missing", async () => {
    const deps = createTabEventDeps();
    deps.store.hasTab = vi.fn(() => false);

    const handlers = createTabEventHandlers(deps as never);
    await handlers.onRemoved(7, { windowId: 9, isWindowClosing: false } as chrome.tabs.TabRemoveInfo);

    expect(deps.store.removeTab).not.toHaveBeenCalled();
    expect(deps.handlePatch).not.toHaveBeenCalled();
    expect(deps.windowSyncCoordinator.scheduleWindowSync).toHaveBeenCalledWith({
      windowId: 9,
      cause: "autocorrect/tabs/onRemoved"
    });
  });

  it("should patch-first migration when attached tab exists in store", async () => {
    const deps = createTabEventDeps();
    deps.store.getTab = vi.fn(() => ({
      id: 7,
      windowId: 2,
      index: 4,
      groupId: -1,
      title: "T",
      url: "https://example.com",
      pinned: false,
      active: false,
      audible: false,
      discarded: false,
      favIconUrl: null
    }));
    deps.detachedTabWindowIds.set(7, 2);

    const handlers = createTabEventHandlers(deps as never);
    await handlers.onAttached(7, { newWindowId: 9, newPosition: 0 });

    expect(deps.store.upsertTab).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, windowId: 9, index: 0 })
    );
    expect(deps.handlePatch).toHaveBeenCalledWith({
      type: "tab/upsert",
      tab: expect.objectContaining({ id: 7, windowId: 9, index: 0 })
    });
    expect(deps.windowSyncCoordinator.scheduleCrossWindowSync).not.toHaveBeenCalled();
    expect(deps.detachedTabWindowIds.has(7)).toBe(false);
  });

  it("should schedule cross-window sync for tab attached when tab missing from store", async () => {
    const deps = createTabEventDeps();
    deps.detachedTabWindowIds.set(7, 2);

    const handlers = createTabEventHandlers(deps as never);
    await handlers.onAttached(7, { newWindowId: 9, newPosition: 0 });

    expect(deps.store.upsertTab).not.toHaveBeenCalled();
    expect(deps.handlePatch).not.toHaveBeenCalled();
    expect(deps.windowSyncCoordinator.scheduleCrossWindowSync).toHaveBeenCalledWith({
      sourceWindowId: 2,
      targetWindowId: 9,
      cause: "tabs/onAttached"
    });
  });

  it("should patch-first index update when moved tab exists in store", async () => {
    const deps = createTabEventDeps();
    deps.store.getTab = vi.fn(() => ({
      id: 7,
      windowId: 9,
      index: 1,
      groupId: -1,
      title: "T",
      url: "https://example.com",
      pinned: false,
      active: false,
      audible: false,
      discarded: false,
      favIconUrl: null
    }));

    const handlers = createTabEventHandlers(deps as never);
    await handlers.onMoved(7, { windowId: 9, fromIndex: 1, toIndex: 3 });

    expect(deps.store.upsertTab).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, windowId: 9, index: 3 })
    );
    expect(deps.handlePatch).toHaveBeenCalledWith({
      type: "tab/upsert",
      tab: expect.objectContaining({ id: 7, windowId: 9, index: 3 })
    });
    expect(deps.windowSyncCoordinator.scheduleWindowSync).not.toHaveBeenCalled();
  });

  it("should schedule window sync for tab moved when tab missing from store", async () => {
    const deps = createTabEventDeps();

    const handlers = createTabEventHandlers(deps as never);
    await handlers.onMoved(7, { windowId: 9, fromIndex: 1, toIndex: 3 });

    expect(deps.store.upsertTab).not.toHaveBeenCalled();
    expect(deps.handlePatch).not.toHaveBeenCalled();
    expect(deps.windowSyncCoordinator.scheduleWindowSync).toHaveBeenCalledWith({
      windowId: 9,
      cause: "tabs/onMoved"
    });
  });

  it("should patch-first for group updated", async () => {
    const taskQueue = vi.fn(async (task: () => Promise<void>) => await task());
    const deps = {
      enqueueStoreTask: taskQueue,
      syncGroupFromChrome: vi.fn(async () => undefined),
      ensureInitialized: vi.fn(async () => undefined),
      store: {
        getGroup: vi.fn(() => ({
          id: 5,
          windowId: 8,
          color: "blue",
          collapsed: false,
          title: "旧组"
        })),
        upsertGroup: vi.fn((group) => ({ type: "group/upsert", group }))
      },
      handlePatch: vi.fn(),
      syncWindowFromChrome: vi.fn(async () => undefined),
      traceBackgroundEvent: vi.fn()
    };

    const handlers = createTabGroupEventHandlers(deps as never);
    await handlers.onUpdated({
      id: 5,
      windowId: 8,
      color: "blue",
      collapsed: true,
      title: "工作"
    } as chrome.tabGroups.TabGroup);

    expect(deps.store.upsertGroup).toHaveBeenCalledWith({
      id: 5,
      windowId: 8,
      color: "blue",
      collapsed: true,
      title: "工作"
    });
    expect(deps.handlePatch).toHaveBeenCalledWith({
      type: "group/upsert",
      group: {
        id: 5,
        windowId: 8,
        color: "blue",
        collapsed: true,
        title: "工作"
      }
    });
    expect(deps.syncGroupFromChrome).not.toHaveBeenCalled();
    expect(deps.syncWindowFromChrome).not.toHaveBeenCalled();
  });

  it("should resync the group when updated group membership is uncertain", async () => {
    const taskQueue = vi.fn(async (task: () => Promise<void>) => await task());
    const deps = {
      enqueueStoreTask: taskQueue,
      syncGroupFromChrome: vi.fn(async () => undefined),
      ensureInitialized: vi.fn(async () => undefined),
      store: {
        getGroup: vi.fn(() => undefined),
        upsertGroup: vi.fn((group) => ({ type: "group/upsert", group }))
      },
      handlePatch: vi.fn(),
      syncWindowFromChrome: vi.fn(async () => undefined),
      traceBackgroundEvent: vi.fn()
    };

    const handlers = createTabGroupEventHandlers(deps as never);
    await handlers.onUpdated({
      id: 5,
      windowId: 8,
      color: "blue",
      collapsed: true,
      title: "工作"
    } as chrome.tabGroups.TabGroup);

    expect(deps.handlePatch).toHaveBeenCalledTimes(1);
    expect(deps.syncGroupFromChrome).toHaveBeenCalledWith(5, expect.objectContaining({ id: 5, windowId: 8 }));
  });

  it("should enqueue group removal reconciliation", async () => {
    const taskQueue = vi.fn(async (task: () => Promise<void>) => await task());
    const deps = {
      enqueueStoreTask: taskQueue,
      syncGroupFromChrome: vi.fn(async () => undefined),
      ensureInitialized: vi.fn(async () => undefined),
      store: {
        removeGroup: vi.fn(() => ({ type: "group/remove", groupId: 5 }))
      },
      handlePatch: vi.fn(),
      syncWindowFromChrome: vi.fn(async () => undefined),
      traceBackgroundEvent: vi.fn()
    };

    const handlers = createTabGroupEventHandlers(deps as never);
    await handlers.onRemoved({ id: 5, windowId: 8 } as chrome.tabGroups.TabGroup);

    expect(deps.handlePatch).toHaveBeenCalledWith({ type: "group/remove", groupId: 5 });
    expect(deps.syncWindowFromChrome).toHaveBeenCalledWith(8);
  });

  it("should ignore WINDOW_ID_NONE focus changes", () => {
    const deps = {
      enqueueStoreTask: vi.fn(),
      ensureInitialized: vi.fn(async () => undefined),
      store: {
        removeWindow: vi.fn(),
        focusWindow: vi.fn()
      },
      handlePatch: vi.fn(),
      windowSyncCoordinator: {
        runAfterCurrentCycle: vi.fn(async () => undefined)
      },
      windowIdNone: -1
    };

    const handlers = createWindowEventHandlers(deps as never);
    handlers.onFocusChanged(deps.windowIdNone);

    expect(deps.windowSyncCoordinator.runAfterCurrentCycle).not.toHaveBeenCalled();
  });
});
