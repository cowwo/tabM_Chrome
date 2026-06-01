import { afterEach, describe, expect, it, vi } from "vitest";
import { createPanelPortAdapter } from "../src/sidepanel/panelPortAdapter";

function createPort() {
  const messageListeners = new Set<(message: unknown) => void>();
  const disconnectListeners = new Set<() => void>();

  return {
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: {
      addListener: vi.fn((listener: (message: unknown) => void) => {
        messageListeners.add(listener);
      }),
      removeListener: vi.fn((listener: (message: unknown) => void) => {
        messageListeners.delete(listener);
      })
    },
    onDisconnect: {
      addListener: vi.fn((listener: () => void) => {
        disconnectListeners.add(listener);
      }),
      removeListener: vi.fn((listener: () => void) => {
        disconnectListeners.delete(listener);
      })
    },
    emitMessage(message: unknown) {
      messageListeners.forEach((listener) => listener(message));
    },
    emitDisconnect() {
      disconnectListeners.forEach((listener) => listener());
    }
  };
}

function createTracePayload() {
  return {
    entries: [],
    settings: {
      verboseLoggingEnabled: false,
      changedAt: "2026-05-31T00:00:00.000Z"
    },
    updatedAt: null,
    timelineText: "timeline"
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("panelPortAdapter", () => {
  it("should forward background messages and reconnect after disconnect", () => {
    vi.useFakeTimers();
    const port1 = createPort();
    const port2 = createPort();
    const connectPort = vi.fn()
      .mockReturnValueOnce(port1 as unknown as chrome.runtime.Port)
      .mockReturnValueOnce(port2 as unknown as chrome.runtime.Port);
    const onMessage = vi.fn();
    const onDisconnected = vi.fn();

    const adapter = createPanelPortAdapter({
      connectPort,
      onMessage,
      onConnectionFailed: vi.fn(),
      onDisconnected,
      reconnectDelayMs: 10
    });

    adapter.connect();
    port1.emitMessage({ type: "panel/error", payload: { message: "x" } });
    port1.emitDisconnect();
    vi.advanceTimersByTime(10);

    expect(onMessage).toHaveBeenCalledWith({ type: "panel/error", payload: { message: "x" } });
    expect(onDisconnected).toHaveBeenCalledTimes(1);
    expect(connectPort).toHaveBeenCalledTimes(2);
  });

  it("rejects a second trace request while the first one is still in flight", async () => {
    const port = createPort();
    const connectPort = vi.fn(() => port as unknown as chrome.runtime.Port);
    const adapter = createPanelPortAdapter({
      connectPort,
      onMessage: vi.fn(),
      onConnectionFailed: vi.fn(),
      onDisconnected: vi.fn()
    });

    adapter.connect();
    const first = adapter.requestTraceBundle();

    await expect(adapter.requestTraceBundle()).rejects.toThrow("调试日志请求正在进行");

    const payload = createTracePayload();
    port.emitMessage({
      type: "debug/trace",
      payload
    } as any);

    await expect(first).resolves.toEqual(payload);
  });

  it("clears the pending trace request after a successful response", async () => {
    const port = createPort();
    const connectPort = vi.fn(() => port as unknown as chrome.runtime.Port);
    const adapter = createPanelPortAdapter({
      connectPort,
      onMessage: vi.fn(),
      onConnectionFailed: vi.fn(),
      onDisconnected: vi.fn()
    });

    adapter.connect();

    const firstPayload = createTracePayload();
    const first = adapter.requestTraceBundle();
    port.emitMessage({ type: "debug/trace", payload: firstPayload } as any);
    await expect(first).resolves.toEqual(firstPayload);

    const secondPayload = createTracePayload();
    const second = adapter.requestTraceBundle();
    port.emitMessage({ type: "debug/trace", payload: secondPayload } as any);
    await expect(second).resolves.toEqual(secondPayload);
  });

  it("clears the pending trace request after a timeout", async () => {
    vi.useFakeTimers();
    const port = createPort();
    const connectPort = vi.fn(() => port as unknown as chrome.runtime.Port);
    const adapter = createPanelPortAdapter({
      connectPort,
      onMessage: vi.fn(),
      onConnectionFailed: vi.fn(),
      onDisconnected: vi.fn()
    });

    adapter.connect();

    const first = adapter.requestTraceBundle();
    const firstSettled = first.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(firstSettled).resolves.toMatchObject({ message: "获取调试日志超时" });

    const secondPayload = createTracePayload();
    const second = adapter.requestTraceBundle();
    port.emitMessage({ type: "debug/trace", payload: secondPayload } as any);
    await expect(second).resolves.toEqual(secondPayload);
  });

  it("clears the pending trace request after disconnect", async () => {
    vi.useFakeTimers();
    const port1 = createPort();
    const port2 = createPort();
    const connectPort = vi.fn()
      .mockReturnValueOnce(port1 as unknown as chrome.runtime.Port)
      .mockReturnValueOnce(port2 as unknown as chrome.runtime.Port);

    const adapter = createPanelPortAdapter({
      connectPort,
      onMessage: vi.fn(),
      onConnectionFailed: vi.fn(),
      onDisconnected: vi.fn(),
      reconnectDelayMs: 10
    });

    adapter.connect();

    const first = adapter.requestTraceBundle();
    port1.emitDisconnect();
    await expect(first).rejects.toThrow("后台连接已断开");

    await vi.advanceTimersByTimeAsync(10);

    const secondPayload = createTracePayload();
    const second = adapter.requestTraceBundle();
    port2.emitMessage({ type: "debug/trace", payload: secondPayload } as any);
    await expect(second).resolves.toEqual(secondPayload);
  });

  it("clears the pending trace request and reconnects after postMessage throws", async () => {
    vi.useFakeTimers();
    const port1 = createPort();
    const port2 = createPort();
    port1.postMessage.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const connectPort = vi.fn()
      .mockReturnValueOnce(port1 as unknown as chrome.runtime.Port)
      .mockReturnValueOnce(port2 as unknown as chrome.runtime.Port);
    const onDisconnected = vi.fn();

    const adapter = createPanelPortAdapter({
      connectPort,
      onMessage: vi.fn(),
      onConnectionFailed: vi.fn(),
      onDisconnected,
      reconnectDelayMs: 10
    });

    adapter.connect();

    const first = adapter.requestTraceBundle();
    await expect(first).rejects.toThrow("后台连接已断开");
    expect(onDisconnected).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10);

    const secondPayload = createTracePayload();
    const second = adapter.requestTraceBundle();
    port2.emitMessage({ type: "debug/trace", payload: secondPayload } as any);
    await expect(second).resolves.toEqual(secondPayload);
  });

  it("returns false and reconnects when postMessage throws", async () => {
    vi.useFakeTimers();
    const port1 = createPort();
    const port2 = createPort();
    port1.postMessage.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const connectPort = vi.fn()
      .mockReturnValueOnce(port1 as unknown as chrome.runtime.Port)
      .mockReturnValueOnce(port2 as unknown as chrome.runtime.Port);
    const onDisconnected = vi.fn();

    const adapter = createPanelPortAdapter({
      connectPort,
      onMessage: vi.fn(),
      onConnectionFailed: vi.fn(),
      onDisconnected,
      reconnectDelayMs: 10
    });

    adapter.connect();

    expect(adapter.postMessage({ type: "debug/clear-trace" })).toBe(false);
    expect(onDisconnected).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10);
    expect(connectPort).toHaveBeenCalledTimes(2);
  });

  it("should ignore duplicate connect calls while a port is active", () => {
    const port = createPort();
    const connectPort = vi.fn(() => port as unknown as chrome.runtime.Port);

    const adapter = createPanelPortAdapter({
      connectPort,
      onMessage: vi.fn(),
      onConnectionFailed: vi.fn(),
      onDisconnected: vi.fn()
    });

    adapter.connect();
    adapter.connect();

    expect(connectPort).toHaveBeenCalledTimes(1);
  });

  it("should cancel a pending reconnect when connect is called manually", () => {
    vi.useFakeTimers();
    const port1 = createPort();
    const port2 = createPort();
    const connectPort = vi.fn()
      .mockReturnValueOnce(port1 as unknown as chrome.runtime.Port)
      .mockReturnValueOnce(port2 as unknown as chrome.runtime.Port);

    const adapter = createPanelPortAdapter({
      connectPort,
      onMessage: vi.fn(),
      onConnectionFailed: vi.fn(),
      onDisconnected: vi.fn(),
      reconnectDelayMs: 10
    });

    adapter.connect();
    port1.emitDisconnect();
    adapter.connect();
    vi.advanceTimersByTime(10);

    expect(connectPort).toHaveBeenCalledTimes(2);
  });
});
