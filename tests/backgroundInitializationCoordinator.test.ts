import { describe, expect, it, vi } from "vitest";
import { createBackgroundInitializationCoordinator } from "../src/background/backgroundInitializationCoordinator";

function makeTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: overrides.id,
    windowId: overrides.windowId,
    index: overrides.index,
    title: overrides.title,
    url: overrides.url,
    groupId: overrides.groupId
  } as chrome.tabs.Tab;
}

describe("backgroundInitializationCoordinator", () => {
  it("should initialize once and schedule badge update", async () => {
    const queryTabs = vi.fn(async () => [
      makeTab({ id: 1, windowId: 2, index: 0, title: "A", url: "data:text/html,A" })
    ]);
    const queryFocusedWindowId = vi.fn(async () => 2);
    const queryAllTabGroupsForTabs = vi.fn(async () => []);

    const setInitialStore = vi.fn();
    const scheduleActionBadgeUpdate = vi.fn();
    const coordinator = createBackgroundInitializationCoordinator({
      initializeTracePersistence: vi.fn(async () => undefined),
      initializeExtensionSettings: vi.fn(async () => undefined),
      configureActionBadge: vi.fn(),
      configureSidePanel: vi.fn(async () => undefined),
      scheduleActionBadgeUpdate,
      setInitialStore,
      queryTabs,
      queryFocusedWindowId,
      queryAllTabGroupsForTabs
    });

    await coordinator.ensureInitialized();
    await coordinator.ensureInitialized();

    expect(queryTabs).toHaveBeenCalledTimes(1);
    expect(queryFocusedWindowId).toHaveBeenCalledTimes(1);
    expect(queryAllTabGroupsForTabs).toHaveBeenCalledTimes(1);
    expect(setInitialStore).toHaveBeenCalledTimes(1);
    expect(scheduleActionBadgeUpdate).toHaveBeenCalledTimes(1);
  });

  it("should retry initialization after a rejected attempt", async () => {
    const queryTabs = vi.fn(async () => [
      makeTab({ id: 1, windowId: 2, index: 0, title: "A", url: "data:text/html,A" })
    ]);
    const queryFocusedWindowId = vi.fn(async () => 2);
    const queryAllTabGroupsForTabs = vi.fn(async () => []);
    const setInitialStore = vi.fn().mockImplementationOnce(() => {
      throw new Error("init failed");
    });
    const scheduleActionBadgeUpdate = vi.fn();
    const coordinator = createBackgroundInitializationCoordinator({
      initializeTracePersistence: vi.fn(async () => undefined),
      initializeExtensionSettings: vi.fn(async () => undefined),
      configureActionBadge: vi.fn(),
      configureSidePanel: vi.fn(async () => undefined),
      scheduleActionBadgeUpdate,
      setInitialStore,
      queryTabs,
      queryFocusedWindowId,
      queryAllTabGroupsForTabs
    });

    await expect(coordinator.ensureInitialized()).rejects.toThrow("init failed");
    await coordinator.ensureInitialized();

    expect(queryTabs).toHaveBeenCalledTimes(2);
    expect(queryFocusedWindowId).toHaveBeenCalledTimes(2);
    expect(queryAllTabGroupsForTabs).toHaveBeenCalledTimes(2);
    expect(setInitialStore).toHaveBeenCalledTimes(2);
    expect(scheduleActionBadgeUpdate).toHaveBeenCalledTimes(1);
  });

  it("should boot trace, settings, badge and side panel", async () => {
    const initializeTracePersistence = vi.fn(async () => undefined);
    const initializeExtensionSettings = vi.fn(async () => undefined);
    const configureActionBadge = vi.fn();
    const configureSidePanel = vi.fn(async () => undefined);
    const coordinator = createBackgroundInitializationCoordinator({
      initializeTracePersistence,
      initializeExtensionSettings,
      configureActionBadge,
      configureSidePanel,
      scheduleActionBadgeUpdate: vi.fn(),
      setInitialStore: vi.fn(),
      queryTabs: vi.fn(async () => []),
      queryFocusedWindowId: vi.fn(async () => null),
      queryAllTabGroupsForTabs: vi.fn(async () => [])
    });

    await coordinator.boot();

    expect(initializeTracePersistence).toHaveBeenCalledTimes(1);
    expect(initializeExtensionSettings).toHaveBeenCalledTimes(1);
    expect(configureActionBadge).toHaveBeenCalledTimes(1);
    expect(configureSidePanel).toHaveBeenCalledTimes(1);
  });
});
