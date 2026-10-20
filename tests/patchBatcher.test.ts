import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyState, createSnapshot } from "../src/shared/domain/tabState";
import { NO_TAB_GROUP_ID } from "../src/shared/defaults";
import type { BackgroundToPanelMessage } from "../src/shared/messages";
import type { StorePatch, TabRecord } from "../src/shared/types";
import { createPanelPatchBatcher, type PatchFlushScheduler } from "../src/sidepanel/patchBatcher";

function makeTab(id: number, title = `Tab ${id}`): TabRecord {
  return {
    id,
    windowId: 1,
    index: id,
    groupId: NO_TAB_GROUP_ID,
    title,
    url: `https://example.com/${id}`,
    pinned: false,
    active: false,
    audible: false,
    discarded: false,
    favIconUrl: null,
    lastAccessed: 0
  };
}

function patchMessage(tabId: number, title?: string): BackgroundToPanelMessage {
  return {
    type: "panel/patch",
    payload: {
      type: "tab/upsert",
      tab: makeTab(tabId, title)
    }
  };
}

function snapshotMessage(version = 10): BackgroundToPanelMessage {
  return {
    type: "panel/snapshot",
    payload: {
      snapshot: createSnapshot(createEmptyState(), version)
    }
  };
}

function errorMessage(message = "sync failed"): BackgroundToPanelMessage {
  return {
    type: "panel/error",
    payload: {
      message
    }
  };
}

function traceStateMessage(): BackgroundToPanelMessage {
  return {
    type: "debug/trace-state",
    payload: {
      settings: {
        verboseLoggingEnabled: false,
        changedAt: "2026-01-01T00:00:00.000Z"
      },
      entryCount: 0,
      updatedAt: null
    }
  };
}

interface ManualScheduler {
  schedule: PatchFlushScheduler;
  runNext(): void;
  pendingCount(): number;
}

function createManualScheduler(): ManualScheduler {
  const pending: Array<() => void> = [];

  return {
    schedule(callback) {
      pending.push(callback);
      return () => {
        const index = pending.indexOf(callback);
        if (index >= 0) {
          pending.splice(index, 1);
        }
      };
    },
    runNext() {
      const callback = pending.shift();
      callback?.();
    },
    pendingCount() {
      return pending.length;
    }
  };
}

function titlesOf(patches: StorePatch[]): string[] {
  return patches.map((patch) => (patch.type === "tab/upsert" ? patch.tab.title : patch.type));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("patch batcher", () => {
  it("batches patches received in the same frame into a single ordered flush", () => {
    const scheduler = createManualScheduler();
    const flushes: StorePatch[][] = [];
    const batcher = createPanelPatchBatcher({
      onFlush: (patches) => flushes.push(patches),
      onImmediate: () => {
        throw new Error("unexpected immediate message");
      },
      schedule: scheduler.schedule
    });

    batcher.accept(patchMessage(1));
    batcher.accept(patchMessage(2));
    batcher.accept(patchMessage(3));

    expect(flushes).toHaveLength(0);
    expect(batcher.pendingPatchCount()).toBe(3);
    expect(scheduler.pendingCount()).toBe(1);

    scheduler.runNext();

    expect(flushes).toHaveLength(1);
    expect(titlesOf(flushes[0])).toEqual(["Tab 1", "Tab 2", "Tab 3"]);
    expect(batcher.pendingPatchCount()).toBe(0);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("schedules exactly one frame per batch and a fresh frame after the flush", () => {
    const scheduler = createManualScheduler();
    const flushes: StorePatch[][] = [];
    const batcher = createPanelPatchBatcher({
      onFlush: (patches) => flushes.push(patches),
      onImmediate: () => {},
      schedule: scheduler.schedule
    });

    batcher.accept(patchMessage(1));
    expect(scheduler.pendingCount()).toBe(1);

    batcher.accept(patchMessage(2));
    batcher.accept(patchMessage(3));
    expect(scheduler.pendingCount()).toBe(1);

    scheduler.runNext();
    expect(flushes).toHaveLength(1);

    batcher.accept(patchMessage(4));
    expect(scheduler.pendingCount()).toBe(1);
    scheduler.runNext();

    expect(flushes).toHaveLength(2);
    expect(titlesOf(flushes[1])).toEqual(["Tab 4"]);
  });

  it("flushes queued patches before an immediate snapshot so order never flips", () => {
    const scheduler = createManualScheduler();
    const events: string[] = [];
    const batcher = createPanelPatchBatcher({
      onFlush: (patches) => events.push(`flush:${titlesOf(patches).join(",")}`),
      onImmediate: (message) => events.push(`immediate:${message.type}`),
      schedule: scheduler.schedule
    });

    batcher.accept(patchMessage(1));
    batcher.accept(patchMessage(2));
    batcher.accept(snapshotMessage());

    expect(events).toEqual(["flush:Tab 1,Tab 2", "immediate:panel/snapshot"]);
    expect(scheduler.pendingCount()).toBe(0);
    expect(batcher.pendingPatchCount()).toBe(0);

    // 快照之后到达的 patch 属于下一帧，不会被并进快照之前。
    batcher.accept(patchMessage(3));
    expect(events).toHaveLength(2);
    scheduler.runNext();
    expect(events).toEqual([
      "flush:Tab 1,Tab 2",
      "immediate:panel/snapshot",
      "flush:Tab 3"
    ]);
  });

  it("flushes queued patches before panel/error and trace messages", () => {
    const scheduler = createManualScheduler();
    const events: string[] = [];
    const batcher = createPanelPatchBatcher({
      onFlush: (patches) => events.push(`flush:${titlesOf(patches).join(",")}`),
      onImmediate: (message) => events.push(`immediate:${message.type}`),
      schedule: scheduler.schedule
    });

    batcher.accept(patchMessage(1));
    batcher.accept(errorMessage());
    batcher.accept(patchMessage(2));
    batcher.accept(traceStateMessage());

    expect(events).toEqual([
      "flush:Tab 1",
      "immediate:panel/error",
      "flush:Tab 2",
      "immediate:debug/trace-state"
    ]);
  });

  it("delivers an immediate message without a flush when no patch is queued", () => {
    const scheduler = createManualScheduler();
    const flushes: StorePatch[][] = [];
    const immediateTypes: string[] = [];
    const batcher = createPanelPatchBatcher({
      onFlush: (patches) => flushes.push(patches),
      onImmediate: (message) => immediateTypes.push(message.type),
      schedule: scheduler.schedule
    });

    batcher.accept(errorMessage());

    expect(flushes).toHaveLength(0);
    expect(immediateTypes).toEqual(["panel/error"]);
  });

  it("flushNow applies pending patches synchronously and cancels the scheduled frame", () => {
    const scheduler = createManualScheduler();
    const flushes: StorePatch[][] = [];
    const batcher = createPanelPatchBatcher({
      onFlush: (patches) => flushes.push(patches),
      onImmediate: () => {},
      schedule: scheduler.schedule
    });

    batcher.accept(patchMessage(1));
    expect(scheduler.pendingCount()).toBe(1);

    batcher.flushNow();

    expect(flushes).toHaveLength(1);
    expect(batcher.pendingPatchCount()).toBe(0);
    expect(scheduler.pendingCount()).toBe(0);

    // 已取消的帧回调不会再触发第二次 flush。
    scheduler.runNext();
    expect(flushes).toHaveLength(1);
  });

  it("does not loop when a patch is enqueued from inside onFlush", () => {
    const scheduler = createManualScheduler();
    const flushes: string[][] = [];
    const batcher = createPanelPatchBatcher({
      onFlush: (patches) => {
        flushes.push(titlesOf(patches));
        if (flushes.length === 1) {
          batcher.accept(patchMessage(9));
        }
      },
      onImmediate: () => {},
      schedule: scheduler.schedule
    });

    batcher.accept(patchMessage(1));
    scheduler.runNext();

    expect(flushes).toEqual([["Tab 1"]]);
    expect(batcher.pendingPatchCount()).toBe(1);
    expect(scheduler.pendingCount()).toBe(1);

    scheduler.runNext();
    expect(flushes).toEqual([["Tab 1"], ["Tab 9"]]);
  });

  it("drops pending patches and cancels the frame on dispose", () => {
    const scheduler = createManualScheduler();
    const flushes: StorePatch[][] = [];
    const immediateTypes: string[] = [];
    const batcher = createPanelPatchBatcher({
      onFlush: (patches) => flushes.push(patches),
      onImmediate: (message) => immediateTypes.push(message.type),
      schedule: scheduler.schedule
    });

    batcher.accept(patchMessage(1));
    batcher.dispose();

    expect(batcher.pendingPatchCount()).toBe(0);
    expect(scheduler.pendingCount()).toBe(0);

    batcher.accept(patchMessage(2));
    batcher.accept(errorMessage());
    scheduler.runNext();

    expect(flushes).toHaveLength(0);
    expect(immediateTypes).toEqual([]);
  });

  it("falls back to a setTimeout scheduler when requestAnimationFrame is unavailable", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.stubGlobal("cancelAnimationFrame", undefined);
    vi.useFakeTimers();

    const flushes: StorePatch[][] = [];
    const batcher = createPanelPatchBatcher({
      onFlush: (patches) => flushes.push(patches),
      onImmediate: () => {}
    });

    batcher.accept(patchMessage(1));
    expect(flushes).toHaveLength(0);

    vi.runOnlyPendingTimers();

    expect(flushes).toHaveLength(1);
    expect(titlesOf(flushes[0])).toEqual(["Tab 1"]);
  });

  it("uses requestAnimationFrame when the environment provides it", () => {
    const frames: Array<() => void> = [];
    const cancelledFrameIds: number[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (frameId: number) => {
      cancelledFrameIds.push(frameId);
    });

    const flushes: StorePatch[][] = [];
    const batcher = createPanelPatchBatcher({
      onFlush: (patches) => flushes.push(patches),
      onImmediate: () => {}
    });

    batcher.accept(patchMessage(1));
    expect(frames).toHaveLength(1);
    expect(flushes).toHaveLength(0);

    frames[0]();
    expect(flushes).toHaveLength(1);

    batcher.accept(patchMessage(2));
    expect(frames).toHaveLength(2);

    batcher.dispose();
    expect(cancelledFrameIds).toEqual([2]);
    expect(batcher.pendingPatchCount()).toBe(0);
  });
});
