import { PANEL_PORT_NAME } from "../shared/defaults";
import type { BackgroundToPanelMessage, PanelToBackgroundMessage } from "../shared/messages";

export type TraceBundlePayload = Extract<BackgroundToPanelMessage, { type: "debug/trace" }>['payload'];

export interface PanelPortAdapter {
  connect(): void;
  disconnect(): void;
  postMessage(message: PanelToBackgroundMessage): boolean;
  requestTraceBundle(): Promise<TraceBundlePayload>;
}

export interface PanelPortAdapterOptions {
  connectPort?: () => chrome.runtime.Port;
  onMessage: (message: BackgroundToPanelMessage) => void;
  onConnectionFailed: () => void;
  onDisconnected: () => void;
  reconnectDelayMs?: number;
}

export function createPanelPortAdapter(options: PanelPortAdapterOptions): PanelPortAdapter {
  const connectPort = options.connectPort ?? (() => chrome.runtime.connect({ name: PANEL_PORT_NAME }));
  const reconnectDelayMs = options.reconnectDelayMs ?? 400;

  let disposed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let activePort: chrome.runtime.Port | null = null;
  let pendingTraceRequest: {
    timeoutId: ReturnType<typeof setTimeout>;
    resolve: (payload: TraceBundlePayload) => void;
    reject: (error: Error) => void;
  } | null = null;

  const clearReconnectTimer = (): void => {
    if (reconnectTimer != null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const rejectPendingTraceRequest = (error: Error): void => {
    if (pendingTraceRequest == null) {
      return;
    }

    const pending = pendingTraceRequest;
    pendingTraceRequest = null;
    clearTimeout(pending.timeoutId);
    pending.reject(error);
  };

  const resolvePendingTraceRequest = (payload: TraceBundlePayload): void => {
    if (pendingTraceRequest == null) {
      return;
    }

    const pending = pendingTraceRequest;
    pendingTraceRequest = null;
    clearTimeout(pending.timeoutId);
    pending.resolve(payload);
  };

  const detachActivePort = (): void => {
    if (activePort == null) {
      return;
    }

    const port = activePort;
    activePort = null;
    port.onMessage.removeListener(handleMessage);
    port.onDisconnect.removeListener(handleDisconnect);
  };

  const handlePortFailure = (error: Error): void => {
    detachActivePort();
    rejectPendingTraceRequest(error);

    if (disposed) {
      return;
    }

    options.onDisconnected();
    scheduleReconnect();
  };

  const handleMessage = (message: BackgroundToPanelMessage): void => {
    if (message.type === "debug/trace") {
      resolvePendingTraceRequest(message.payload);
    }

    options.onMessage(message);
  };

  const scheduleReconnect = (): void => {
    if (disposed || reconnectTimer != null) {
      return;
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelayMs);
  };

  const handleDisconnect = (): void => {
    handlePortFailure(new Error("后台连接已断开"));
  };

  const connect = (): void => {
    if (disposed || activePort) {
      return;
    }

    clearReconnectTimer();

    try {
      activePort = connectPort();
    } catch {
      options.onConnectionFailed();
      scheduleReconnect();
      return;
    }

    activePort.onMessage.addListener(handleMessage);
    activePort.onDisconnect.addListener(handleDisconnect);
  };

  return {
    connect,
    disconnect(): void {
      disposed = true;
      clearReconnectTimer();
      rejectPendingTraceRequest(new Error("后台连接已断开"));

      const port = activePort;
      detachActivePort();
      if (!port) {
        return;
      }

      port.disconnect();
    },
    postMessage(message: PanelToBackgroundMessage): boolean {
      if (!activePort) {
        return false;
      }

      try {
        activePort.postMessage(message);
        return true;
      } catch {
        handlePortFailure(new Error("后台连接已断开"));
        return false;
      }
    },
    async requestTraceBundle(): Promise<TraceBundlePayload> {
      const port = activePort;
      if (!port) {
        throw new Error("后台连接不可用");
      }

      if (pendingTraceRequest != null) {
        throw new Error("调试日志请求正在进行");
      }

      return await new Promise<TraceBundlePayload>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          rejectPendingTraceRequest(new Error("获取调试日志超时"));
        }, 5000);

        pendingTraceRequest = {
          timeoutId,
          resolve,
          reject
        };

        try {
          port.postMessage({
            type: "debug/get-trace"
          } satisfies PanelToBackgroundMessage);
        } catch {
          handlePortFailure(new Error("后台连接已断开"));
        }
      });
    }
  };
}
