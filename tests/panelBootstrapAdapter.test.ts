import { afterEach, describe, expect, it, vi } from "vitest";
import { createPanelBootstrapAdapter } from "../src/sidepanel/panelBootstrapAdapter";

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

function stubChrome(query: ReturnType<typeof vi.fn>): void {
  vi.stubGlobal("chrome", {
    tabs: {
      query
    },
    windows: {
      getLastFocused: vi.fn(async () => ({ id: 2 }))
    },
    tabGroups: {
      get: vi.fn()
    },
    runtime: {
      getURL: (path: string) => `chrome-extension://unit-test/${path}`
    }
  });
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

function bootstrapParams(overrides: Partial<Parameters<ReturnType<typeof createPanelBootstrapAdapter>["bootstrap"]>[0]> = {}) {
  return {
    onStart: vi.fn(),
    onProgress: vi.fn(),
    onSnapshot: vi.fn(),
    onError: vi.fn(),
    shouldStop: () => false,
    ...overrides
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("panelBootstrapAdapter", () => {
  it("should emit start, progress, and snapshot callbacks when the snapshot wait times out", async () => {
    stubChrome(
      vi.fn(async () => [
        makeTab({ id: 1, windowId: 2, index: 0, title: "A", url: "data:text/html,A" })
      ])
    );

    const params = bootstrapParams();

    await createPanelBootstrapAdapter("zh-CN", { remoteSnapshotTimeoutMs: 0 }).bootstrap(params);

    expect(params.onStart).toHaveBeenCalledTimes(1);
    expect(params.onProgress).toHaveBeenCalledWith(0, 1);
    expect(params.onProgress).toHaveBeenCalledWith(1, 1);
    expect(params.onSnapshot).toHaveBeenCalledTimes(1);
    expect(params.onError).not.toHaveBeenCalled();
  });

  it("should stop quietly when asked before snapshot emission", async () => {
    stubChrome(
      vi.fn(async () => [
        makeTab({ id: 1, windowId: 2, index: 0, title: "A", url: "data:text/html,A" })
      ])
    );

    const params = bootstrapParams({ shouldStop: () => true });

    await createPanelBootstrapAdapter("zh-CN", { remoteSnapshotTimeoutMs: 0 }).bootstrap(params);

    expect(params.onSnapshot).not.toHaveBeenCalled();
    expect(params.onProgress).not.toHaveBeenCalled();
  });

  it("should report an error when the local fallback tab query fails", async () => {
    stubChrome(
      vi.fn(async () => {
        throw new Error("query failed");
      })
    );

    const params = bootstrapParams();

    await createPanelBootstrapAdapter("zh-CN", { remoteSnapshotTimeoutMs: 0 }).bootstrap(params);

    expect(params.onSnapshot).not.toHaveBeenCalled();
    expect(params.onError).toHaveBeenCalledWith("首屏数据加载失败，正在等待后台同步。");
  });

  it("should not report an error when stopped after a bootstrap failure", async () => {
    stubChrome(
      vi.fn(async () => {
        throw new Error("query failed");
      })
    );

    const params = bootstrapParams({ shouldStop: () => true });

    await createPanelBootstrapAdapter("zh-CN", { remoteSnapshotTimeoutMs: 0 }).bootstrap(params);

    expect(params.onError).not.toHaveBeenCalled();
  });

  it("skips local tab enumeration when the remote snapshot arrives first", async () => {
    const query = vi.fn(async () => [makeTab({ id: 1, windowId: 2, index: 0 })]);
    stubChrome(query);

    const adapter = createPanelBootstrapAdapter("zh-CN", { remoteSnapshotTimeoutMs: 1_500 });
    const params = bootstrapParams();

    const bootstrapPromise = adapter.bootstrap(params);
    expect(params.onStart).toHaveBeenCalledTimes(1);

    adapter.markRemoteSnapshotReceived();
    await bootstrapPromise;

    expect(query).not.toHaveBeenCalled();
    expect(params.onSnapshot).not.toHaveBeenCalled();
    expect(params.onProgress).not.toHaveBeenCalled();
    expect(params.onError).not.toHaveBeenCalled();

    adapter.dispose();
  });

  it("falls back to local enumeration after the remote snapshot timeout", async () => {
    vi.useFakeTimers();
    const query = vi.fn(async () => [makeTab({ id: 1, windowId: 2, index: 0 })]);
    stubChrome(query);

    const adapter = createPanelBootstrapAdapter("zh-CN", { remoteSnapshotTimeoutMs: 1_500 });
    const params = bootstrapParams();

    const bootstrapPromise = adapter.bootstrap(params);
    expect(query).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_500);
    await bootstrapPromise;

    expect(query).toHaveBeenCalledTimes(1);
    expect(params.onSnapshot).toHaveBeenCalledTimes(1);

    adapter.dispose();
  });

  it("runs the local fallback immediately when the port fails before the snapshot", async () => {
    vi.useFakeTimers();
    const query = vi.fn(async () => [makeTab({ id: 1, windowId: 2, index: 0 })]);
    stubChrome(query);

    const adapter = createPanelBootstrapAdapter("zh-CN", { remoteSnapshotTimeoutMs: 1_500 });
    const params = bootstrapParams();

    const bootstrapPromise = adapter.bootstrap(params);
    adapter.markPortFailed();
    await bootstrapPromise;

    expect(query).toHaveBeenCalledTimes(1);
    expect(params.onSnapshot).toHaveBeenCalledTimes(1);

    adapter.dispose();
  });

  it("ignores a late local fallback result once a remote snapshot has arrived", async () => {
    vi.useFakeTimers();
    const deferredQuery = createDeferred<chrome.tabs.Tab[]>();
    const query = vi.fn(() => deferredQuery.promise);
    stubChrome(query);

    const adapter = createPanelBootstrapAdapter("zh-CN", { remoteSnapshotTimeoutMs: 1_500 });
    const params = bootstrapParams();

    const bootstrapPromise = adapter.bootstrap(params);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(query).toHaveBeenCalledTimes(1);

    adapter.markRemoteSnapshotReceived();
    deferredQuery.resolve([makeTab({ id: 1, windowId: 2, index: 0 })]);
    await bootstrapPromise;

    expect(params.onProgress).not.toHaveBeenCalled();
    expect(params.onSnapshot).not.toHaveBeenCalled();
    expect(params.onError).not.toHaveBeenCalled();

    adapter.dispose();
  });

  it("cancels a running local fallback when shouldStop flips to true", async () => {
    vi.useFakeTimers();
    const deferredQuery = createDeferred<chrome.tabs.Tab[]>();
    const query = vi.fn(() => deferredQuery.promise);
    stubChrome(query);

    let stopped = false;
    const adapter = createPanelBootstrapAdapter("zh-CN", { remoteSnapshotTimeoutMs: 0 });
    const params = bootstrapParams({ shouldStop: () => stopped });

    const bootstrapPromise = adapter.bootstrap(params);
    await vi.advanceTimersByTimeAsync(0);
    expect(query).toHaveBeenCalledTimes(1);

    stopped = true;
    deferredQuery.resolve([makeTab({ id: 1, windowId: 2, index: 0 })]);
    await bootstrapPromise;

    expect(params.onSnapshot).not.toHaveBeenCalled();

    adapter.dispose();
  });

  it("cancels the pending snapshot wait when disposed", async () => {
    vi.useFakeTimers();
    const query = vi.fn(async () => [makeTab({ id: 1, windowId: 2, index: 0 })]);
    stubChrome(query);

    const adapter = createPanelBootstrapAdapter("zh-CN", { remoteSnapshotTimeoutMs: 1_500 });
    const params = bootstrapParams();

    const bootstrapPromise = adapter.bootstrap(params);
    adapter.dispose();

    await vi.advanceTimersByTimeAsync(2_000);
    await bootstrapPromise;

    expect(query).not.toHaveBeenCalled();
    expect(params.onSnapshot).not.toHaveBeenCalled();
    expect(params.onError).not.toHaveBeenCalled();
  });
});
