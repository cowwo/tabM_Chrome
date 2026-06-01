import { describe, expect, it } from "vitest";
import { NO_TAB_GROUP_ID } from "../src/shared/defaults";
import { createSnapshot, createStateFromTabs } from "../src/shared/domain/tabState";
import type { TabRecord } from "../src/shared/types";
import { createInitialPanelControllerState, reducePanelControllerState } from "../src/sidepanel/panelControllerState";

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

function makeSnapshot(tabs: TabRecord[], version = 1) {
  return createSnapshot(createStateFromTabs(tabs, tabs[0]?.windowId ?? null), version);
}

describe("panelControllerState", () => {
  it("uses bootstrap snapshots before any remote state arrives", () => {
    const localSnapshot = makeSnapshot([makeTab({ id: 1, active: true })]);

    let state = createInitialPanelControllerState();
    state = reducePanelControllerState(state, {
      type: "bootstrap/start"
    });
    state = reducePanelControllerState(state, {
      type: "bootstrap/progress",
      loaded: 1,
      total: 1
    });
    state = reducePanelControllerState(state, {
      type: "bootstrap/snapshot",
      snapshot: localSnapshot
    });

    expect(state.snapshot).toEqual(localSnapshot);
    expect(state.bootstrapProgress).toBeNull();
    expect(state.hasReceivedRemoteState).toBe(false);
  });

  it("does not let a late bootstrap snapshot overwrite remote patch state", () => {
    const localSnapshot = makeSnapshot([makeTab({ id: 1, title: "Local tab" })]);

    let state = createInitialPanelControllerState();
    state = reducePanelControllerState(state, {
      type: "background/message",
      message: {
        type: "panel/patch",
        payload: {
          type: "tab/upsert",
          tab: makeTab({ id: 2, title: "Remote tab", active: true })
        }
      }
    });
    state = reducePanelControllerState(state, {
      type: "bootstrap/snapshot",
      snapshot: localSnapshot
    });

    expect(state.hasReceivedRemoteState).toBe(true);
    expect(state.snapshot.tabsById[2]?.title).toBe("Remote tab");
    expect(state.snapshot.tabsById[1]).toBeUndefined();
  });

  it("clears stale errors when remote state resumes", () => {
    let state = createInitialPanelControllerState();
    state = reducePanelControllerState(state, {
      type: "background/message",
      message: {
        type: "panel/error",
        payload: {
          message: "同步失败"
        }
      }
    });
    state = reducePanelControllerState(state, {
      type: "background/message",
      message: {
        type: "panel/patch",
        payload: {
          type: "tab/upsert",
          tab: makeTab({ id: 3, title: "Recovered tab" })
        }
      }
    });

    expect(state.errorMessage).toBeNull();
    expect(state.isInteractive).toBe(true);
    expect(state.snapshot.version).toBe(1);
  });

  it("keeps the panel interactive when only an error message arrives after snapshot", () => {
    let state = createInitialPanelControllerState();
    state = reducePanelControllerState(state, {
      type: "background/message",
      message: {
        type: "panel/snapshot",
        payload: {
          snapshot: makeSnapshot([makeTab({ id: 1, active: true })], 5)
        }
      }
    });
    state = reducePanelControllerState(state, {
      type: "background/message",
      message: {
        type: "panel/error",
        payload: {
          message: "编组同步失败"
        }
      }
    });

    expect(state.isInteractive).toBe(true);
    expect(state.errorMessage).toBe("编组同步失败");
    expect(state.snapshot.version).toBe(5);
  });

  it("marks the panel non-interactive when the port disconnects without surfacing an error", () => {
    let state = createInitialPanelControllerState();
    state = reducePanelControllerState(state, {
      type: "background/message",
      message: {
        type: "panel/snapshot",
        payload: {
          snapshot: makeSnapshot([makeTab({ id: 1, active: true })], 2)
        }
      }
    });
    state = reducePanelControllerState(state, {
      type: "connection/disconnected"
    });

    expect(state.isInteractive).toBe(false);
    expect(state.errorMessage).toBeNull();
    expect(state.snapshot.version).toBe(2);
  });

  it("keeps bootstrap errors from replacing already received remote state", () => {
    let state = createInitialPanelControllerState();
    state = reducePanelControllerState(state, {
      type: "background/message",
      message: {
        type: "panel/snapshot",
        payload: {
          snapshot: makeSnapshot([makeTab({ id: 7, active: true })], 3)
        }
      }
    });
    state = reducePanelControllerState(state, {
      type: "bootstrap/error",
      message: "首屏数据加载失败，正在等待后台同步。"
    });

    expect(state.snapshot.tabsById[7]?.id).toBe(7);
    expect(state.errorMessage).toBeNull();
    expect(state.bootstrapProgress).toBeNull();
  });

  it("starts a resync without discarding the last rendered snapshot", () => {
    let state = createInitialPanelControllerState();
    state = reducePanelControllerState(state, {
      type: "background/message",
      message: {
        type: "panel/snapshot",
        payload: {
          snapshot: makeSnapshot([makeTab({ id: 11, active: true })], 6)
        }
      }
    });

    state = reducePanelControllerState(state, {
      type: "resync/requested"
    });

    expect(state.snapshot.tabsById[11]?.id).toBe(11);
    expect(state.isInteractive).toBe(false);
    expect(state.hasReceivedRemoteState).toBe(false);
    expect(state.bootstrapProgress).toEqual({
      phase: "querying",
      loaded: 0,
      total: null
    });
  });

  it("keeps the last snapshot visible when a resync starts after remote state has arrived", () => {
    let state = createInitialPanelControllerState();
    state = reducePanelControllerState(state, {
      type: "background/message",
      message: {
        type: "panel/snapshot",
        payload: {
          snapshot: makeSnapshot([makeTab({ id: 21, active: true })], 4)
        }
      }
    });

    const next = reducePanelControllerState(state, {
      type: "resync/requested"
    });

    expect(next.snapshot.version).toBe(4);
    expect(next.isInteractive).toBe(false);
  });

  it("tracks trace state from background messages in the reducer", () => {
    let state = createInitialPanelControllerState();
    state = reducePanelControllerState(state, {
      type: "background/message",
      message: {
        type: "debug/trace-state",
        payload: {
          settings: {
            verboseLoggingEnabled: true,
            changedAt: "2026-04-25T00:00:00.000Z"
          },
          entryCount: 7,
          updatedAt: "2026-04-25T00:01:00.000Z"
        }
      }
    });

    expect(state.traceState).toEqual({
      settings: {
        verboseLoggingEnabled: true,
        changedAt: "2026-04-25T00:00:00.000Z"
      },
      entryCount: 7,
      updatedAt: "2026-04-25T00:01:00.000Z"
    });
  });

  it("increments connection epoch when a resync is requested", () => {
    const initial = createInitialPanelControllerState();
    const next = reducePanelControllerState(initial, {
      type: "resync/requested"
    });

    expect(next.connectionEpoch).toBe(initial.connectionEpoch + 1);
  });
});
