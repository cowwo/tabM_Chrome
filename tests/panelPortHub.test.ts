import { describe, expect, it, vi } from "vitest";
import { createPanelPortHub } from "../src/background/panelPortHub";
import { NO_TAB_GROUP_ID } from "../src/shared/defaults";
import { createSnapshot, createStateFromTabs } from "../src/shared/domain/tabState";
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
    lastAccessed: overrides.lastAccessed ?? 0
  };
}

function createFakePort(postMessage: (message: unknown) => void): chrome.runtime.Port {
  return {
    name: "panel",
    postMessage,
    disconnect: vi.fn(),
    onDisconnect: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(),
      hasListeners: vi.fn()
    },
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(),
      hasListeners: vi.fn()
    },
    onMessageExternal: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(),
      hasListeners: vi.fn()
    },
    sender: undefined
  } as unknown as chrome.runtime.Port;
}

describe("panelPortHub", () => {
  it("sends snapshots to a registered port", () => {
    const hub = createPanelPortHub();
    const postMessage = vi.fn();
    const port = createFakePort(postMessage);
    const snapshot = createSnapshot(createStateFromTabs([makeTab({ id: 5, active: true })], 1), 3);

    hub.register(port);
    hub.sendSnapshot(port, snapshot);

    expect(postMessage).toHaveBeenCalledWith({
      type: "panel/snapshot",
      payload: {
        snapshot
      }
    });
  });

  it("broadcasts patches to all registered ports", () => {
    const hub = createPanelPortHub();
    const firstPostMessage = vi.fn();
    const secondPostMessage = vi.fn();

    hub.register(createFakePort(firstPostMessage));
    hub.register(createFakePort(secondPostMessage));
    hub.broadcastPatch({
      type: "window/focus",
      windowId: 2
    });

    expect(firstPostMessage).toHaveBeenCalledWith({
      type: "panel/patch",
      payload: {
        type: "window/focus",
        windowId: 2
      }
    });
    expect(secondPostMessage).toHaveBeenCalledWith({
      type: "panel/patch",
      payload: {
        type: "window/focus",
        windowId: 2
      }
    });
  });

  it("sends trace state to a registered port", () => {
    const hub = createPanelPortHub();
    const postMessage = vi.fn();
    const port = createFakePort(postMessage);

    hub.register(port);
    hub.sendTraceState(port, {
      settings: {
        verboseLoggingEnabled: true,
        changedAt: "2026-04-22T00:00:00.000Z"
      },
      entryCount: 12,
      updatedAt: "2026-04-22T00:00:01.000Z"
    });

    expect(postMessage).toHaveBeenCalledWith({
      type: "debug/trace-state",
      payload: {
        settings: {
          verboseLoggingEnabled: true,
          changedAt: "2026-04-22T00:00:00.000Z"
        },
        entryCount: 12,
        updatedAt: "2026-04-22T00:00:01.000Z"
      }
    });
  });

  it("broadcasts trace state to all registered ports", () => {
    const hub = createPanelPortHub();
    const firstPostMessage = vi.fn();
    const secondPostMessage = vi.fn();

    hub.register(createFakePort(firstPostMessage));
    hub.register(createFakePort(secondPostMessage));
    hub.broadcastTraceState({
      settings: {
        verboseLoggingEnabled: false,
        changedAt: "2026-04-22T00:00:00.000Z"
      },
      entryCount: 3,
      updatedAt: null
    });

    expect(firstPostMessage).toHaveBeenCalledWith({
      type: "debug/trace-state",
      payload: {
        settings: {
          verboseLoggingEnabled: false,
          changedAt: "2026-04-22T00:00:00.000Z"
        },
        entryCount: 3,
        updatedAt: null
      }
    });
    expect(secondPostMessage).toHaveBeenCalledWith({
      type: "debug/trace-state",
      payload: {
        settings: {
          verboseLoggingEnabled: false,
          changedAt: "2026-04-22T00:00:00.000Z"
        },
        entryCount: 3,
        updatedAt: null
      }
    });
  });

  it("removes broken ports after postMessage throws", () => {
    const hub = createPanelPortHub();
    const throwingPostMessage = vi.fn(() => {
      throw new Error("port closed");
    });
    const healthyPostMessage = vi.fn();

    hub.register(createFakePort(throwingPostMessage));
    hub.register(createFakePort(healthyPostMessage));

    hub.broadcastPatch({
      type: "window/focus",
      windowId: 3
    });
    hub.broadcastPatch({
      type: "window/focus",
      windowId: 4
    });

    expect(throwingPostMessage).toHaveBeenCalledTimes(1);
    expect(healthyPostMessage).toHaveBeenCalledTimes(2);
  });
});
