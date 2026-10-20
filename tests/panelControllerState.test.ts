import { describe, expect, it } from "vitest";
import { NO_TAB_GROUP_ID } from "../src/shared/defaults";
import { createSnapshot, createStateFromTabs } from "../src/shared/domain/tabState";
import type { StorePatch, TabRecord, TabStoreSnapshot } from "../src/shared/types";
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
    favIconUrl: overrides.favIconUrl ?? null,
    lastAccessed: overrides.lastAccessed ?? 0
  };
}

function makeSnapshot(tabs: TabRecord[], version = 1) {
  return createSnapshot(createStateFromTabs(tabs, tabs[0]?.windowId ?? null), version);
}

function makeBootSnapshot(tabs: TabRecord[], version: number, bootId: string) {
  return {
    ...makeSnapshot(tabs, version),
    bootId
  };
}

function applySnapshot(
  state: ReturnType<typeof createInitialPanelControllerState>,
  snapshot: TabStoreSnapshot
) {
  return reducePanelControllerState(state, {
    type: "background/message",
    message: {
      type: "panel/snapshot",
      payload: {
        snapshot
      }
    }
  });
}

function applyPatchMessage(
  state: ReturnType<typeof createInitialPanelControllerState>,
  payload: StorePatch
) {
  return reducePanelControllerState(state, {
    type: "background/message",
    message: {
      type: "panel/patch",
      payload
    }
  });
}

function applyPatchesBatch(
  state: ReturnType<typeof createInitialPanelControllerState>,
  patches: StorePatch[]
) {
  return reducePanelControllerState(state, {
    type: "panel/patches-batch",
    patches
  });
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

  it("rejects a lower-version snapshot from the same background boot", () => {
    let state = createInitialPanelControllerState();
    state = applySnapshot(
      state,
      makeBootSnapshot([makeTab({ id: 1, active: true })], 5, "boot-a")
    );

    const rejected = applySnapshot(
      state,
      makeBootSnapshot([makeTab({ id: 99, title: "Stale" })], 3, "boot-a")
    );

    expect(rejected).toBe(state);
    expect(rejected.snapshot.version).toBe(5);
    expect(rejected.snapshot.tabsById[99]).toBeUndefined();
  });

  it("accepts a whole snapshot when the background boot id changes even with a lower version", () => {
    let state = createInitialPanelControllerState();
    state = applySnapshot(
      state,
      makeBootSnapshot([makeTab({ id: 1, title: "Old boot tab", active: true })], 9, "boot-a")
    );

    const rebuilt = applySnapshot(
      state,
      makeBootSnapshot([makeTab({ id: 2, title: "New boot tab", active: true })], 2, "boot-b")
    );

    expect(rebuilt.snapshot.version).toBe(2);
    expect(rebuilt.snapshot.bootId).toBe("boot-b");
    expect(rebuilt.snapshot.tabsById[2]?.title).toBe("New boot tab");
    expect(rebuilt.snapshot.tabsById[1]).toBeUndefined();
    expect(rebuilt.hasReceivedRemoteState).toBe(true);
    expect(rebuilt.isInteractive).toBe(true);
    expect(rebuilt.bootstrapProgress).toBeNull();
  });

  it("lets a remote boot-scoped snapshot replace a bootless local bootstrap snapshot", () => {
    let state = createInitialPanelControllerState();
    state = reducePanelControllerState(state, {
      type: "bootstrap/snapshot",
      snapshot: makeSnapshot([makeTab({ id: 1, title: "Local bootstrap tab", active: true })], 1)
    });

    // 后台版本号可能仍是 0（store 从未变更），旧逻辑会因 0 < 1 拒收。
    const rebuilt = applySnapshot(
      state,
      makeBootSnapshot([makeTab({ id: 2, title: "Remote tab", active: true })], 0, "boot-a")
    );

    expect(rebuilt.snapshot.version).toBe(0);
    expect(rebuilt.snapshot.tabsById[2]?.title).toBe("Remote tab");
    expect(rebuilt.snapshot.tabsById[1]).toBeUndefined();
  });

  it("keeps the legacy version comparison when snapshots carry no boot id", () => {
    let state = createInitialPanelControllerState();
    state = applySnapshot(state, makeSnapshot([makeTab({ id: 1, active: true })], 5));

    const rejected = applySnapshot(state, makeSnapshot([makeTab({ id: 3 })], 3));
    expect(rejected.snapshot.version).toBe(5);
    expect(rejected.snapshot.tabsById[3]).toBeUndefined();

    const accepted = applySnapshot(state, makeSnapshot([makeTab({ id: 4 })], 6));
    expect(accepted.snapshot.version).toBe(6);
    expect(accepted.snapshot.tabsById[4]).toBeDefined();
  });

  it("ignores patches from a different background boot and applies matching or legacy ones", () => {
    let state = createInitialPanelControllerState();
    state = applySnapshot(
      state,
      makeBootSnapshot([makeTab({ id: 1, active: true })], 3, "boot-a")
    );

    const mismatched = applyPatchMessage(state, {
      type: "tab/upsert",
      tab: makeTab({ id: 10, title: "Foreign boot tab" }),
      bootId: "boot-b"
    });
    expect(mismatched).toBe(state);
    expect(mismatched.snapshot.version).toBe(3);
    expect(mismatched.snapshot.tabsById[10]).toBeUndefined();

    const matched = applyPatchMessage(state, {
      type: "tab/upsert",
      tab: makeTab({ id: 11, title: "Same boot tab" }),
      bootId: "boot-a"
    });
    expect(matched.snapshot.version).toBe(4);
    expect(matched.snapshot.tabsById[11]?.title).toBe("Same boot tab");
    expect(matched.snapshot.bootId).toBe("boot-a");

    const legacy = applyPatchMessage(matched, {
      type: "tab/upsert",
      tab: makeTab({ id: 12, title: "Legacy patch tab" })
    });
    expect(legacy.snapshot.version).toBe(5);
    expect(legacy.snapshot.tabsById[12]?.title).toBe("Legacy patch tab");
    expect(legacy.snapshot.bootId).toBe("boot-a");
  });

  it("applies a batched patch list sequentially and ends interactive with the last state", () => {
    let state = createInitialPanelControllerState();
    state = applySnapshot(
      state,
      makeBootSnapshot([makeTab({ id: 1, active: true })], 3, "boot-a")
    );

    const batched = applyPatchesBatch(state, [
      { type: "tab/upsert", tab: makeTab({ id: 2, title: "Second tab", active: true }), bootId: "boot-a" },
      { type: "window/focus", windowId: 2, bootId: "boot-a" },
      { type: "tab/remove", tabId: 1, windowId: 1, bootId: "boot-a" }
    ]);

    expect(batched.snapshot.tabsById[1]).toBeUndefined();
    expect(batched.snapshot.tabsById[2]?.title).toBe("Second tab");
    expect(batched.snapshot.focusedWindowId).toBe(2);
    expect(batched.snapshot.version).toBe(6);
    expect(batched.isInteractive).toBe(true);
    expect(batched.hasReceivedRemoteState).toBe(true);
    expect(batched.errorMessage).toBeNull();
  });

  it("treats a batch from another background boot as a no-op", () => {
    let state = createInitialPanelControllerState();
    state = applySnapshot(
      state,
      makeBootSnapshot([makeTab({ id: 1, active: true })], 3, "boot-a")
    );

    const batched = applyPatchesBatch(state, [
      { type: "tab/upsert", tab: makeTab({ id: 10, title: "Foreign" }), bootId: "boot-b" },
      { type: "window/focus", windowId: 2, bootId: "boot-b" }
    ]);

    expect(batched).toBe(state);
    expect(batched.snapshot.version).toBe(3);
    expect(batched.snapshot.tabsById[10]).toBeUndefined();
  });

  it("treats an empty patch batch as a no-op", () => {
    let state = createInitialPanelControllerState();
    state = applySnapshot(
      state,
      makeBootSnapshot([makeTab({ id: 1, active: true })], 2, "boot-a")
    );

    expect(applyPatchesBatch(state, [])).toBe(state);
  });

  it("clears errors and marks the panel interactive when accepting a boot-changed snapshot", () => {
    let state = createInitialPanelControllerState();
    state = applySnapshot(
      state,
      makeBootSnapshot([makeTab({ id: 1, active: true })], 4, "boot-a")
    );
    state = reducePanelControllerState(state, {
      type: "background/message",
      message: {
        type: "panel/error",
        payload: {
          message: "同步失败"
        }
      }
    });
    expect(state.errorMessage).toBe("同步失败");

    const recovered = applySnapshot(
      state,
      makeBootSnapshot([makeTab({ id: 2, active: true })], 1, "boot-b")
    );

    expect(recovered.errorMessage).toBeNull();
    expect(recovered.isInteractive).toBe(true);
    expect(recovered.bootstrapProgress).toBeNull();
    expect(recovered.hasReceivedRemoteState).toBe(true);
    expect(recovered.snapshot.version).toBe(1);
  });
});
