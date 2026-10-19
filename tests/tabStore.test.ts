import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackgroundTabStore } from "../src/background/tabStore";
import { NO_TAB_GROUP_ID } from "../src/shared/defaults";
import type { TabRecord } from "../src/shared/types";

function makeTab(overrides: Partial<TabRecord> = {}): TabRecord {
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("backgroundTabStore bootId", () => {
  it("should expose a non-empty bootId that is stable within one store instance", () => {
    const store = createBackgroundTabStore();

    const bootId = store.getBootId();
    expect(typeof bootId).toBe("string");
    expect(bootId.length).toBeGreaterThan(0);
    expect(store.getBootId()).toBe(bootId);
  });

  it("should use a different bootId for a different store instance", () => {
    const firstStore = createBackgroundTabStore();
    const secondStore = createBackgroundTabStore();

    expect(firstStore.getBootId()).not.toBe(secondStore.getBootId());
  });

  it("should keep the bootId stable across initialize and snapshot mutations", () => {
    const store = createBackgroundTabStore();
    const bootId = store.getBootId();

    store.initialize([makeTab({ id: 1, windowId: 1 })], 1);
    expect(store.getBootId()).toBe(bootId);

    store.upsertTab(makeTab({ id: 2, windowId: 1, index: 1 }));
    expect(store.getBootId()).toBe(bootId);
  });

  it("should include bootId in every snapshot", () => {
    const store = createBackgroundTabStore();
    store.initialize([makeTab({ id: 1, windowId: 1 })], 1);

    const before = store.getSnapshot();
    expect(before.bootId).toBe(store.getBootId());

    store.upsertTab(makeTab({ id: 2, windowId: 1, index: 1 }));
    const after = store.getSnapshot();
    expect(after.bootId).toBe(store.getBootId());
    expect(after.bootId).toBe(before.bootId);
  });

  it("should keep version semantics unchanged (monotonic inside one boot)", () => {
    const store = createBackgroundTabStore();
    expect(store.getSnapshot().version).toBe(0);

    store.initialize([makeTab({ id: 1 })], 1);
    const initialized = store.getSnapshot();
    expect(initialized.version).toBeGreaterThan(0);

    store.upsertTab(makeTab({ id: 2, index: 1 }));
    expect(store.getSnapshot().version).toBe(initialized.version + 1);
  });

  it("should fall back to a time+random bootId when crypto.randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {});

    const store = createBackgroundTabStore();
    const bootId = store.getBootId();

    expect(typeof bootId).toBe("string");
    expect(bootId.length).toBeGreaterThan(0);
  });

  it("should generate different fallback bootIds for different instances", () => {
    vi.stubGlobal("crypto", {});

    const firstStore = createBackgroundTabStore();
    const secondStore = createBackgroundTabStore();

    expect(firstStore.getBootId()).not.toBe(secondStore.getBootId());
  });
});
