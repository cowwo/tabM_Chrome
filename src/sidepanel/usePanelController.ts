import { useEffect, useReducer, useRef } from "react";
import { translate, type SupportedLocale } from "../shared/i18n";
import type { PanelToBackgroundMessage } from "../shared/messages";
import type {
  PanelTraceEventPayload,
  TabCommand
} from "../shared/types";
import { createPanelBootstrapAdapter } from "./panelBootstrapAdapter";
import { createPanelPortAdapter, type PanelPortAdapter, type TraceBundlePayload } from "./panelPortAdapter";
import { createInitialPanelControllerState, reducePanelControllerState } from "./panelControllerState";

export function usePanelController(locale: SupportedLocale) {
  const [state, dispatchState] = useReducer(
    reducePanelControllerState,
    undefined,
    createInitialPanelControllerState
  );
  const portAdapterRef = useRef<PanelPortAdapter | null>(null);
  const receivedRemoteStateRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    const bootstrapAdapter = createPanelBootstrapAdapter(locale);

    const portAdapter = createPanelPortAdapter({
      onMessage: (message) => {
        if (message.type === "panel/snapshot" || message.type === "panel/patch") {
          receivedRemoteStateRef.current = true;
        }

        dispatchState({
          type: "background/message",
          message
        });
      },
      onConnectionFailed: () => {
        dispatchState({
          type: "connection/failed",
          message: translate(locale, "error.panel.connectionFailed")
        });
      },
      onDisconnected: () => {
        if (disposed) {
          return;
        }

        dispatchState({
          type: "connection/disconnected"
        });
      }
    });

    portAdapterRef.current = portAdapter;
    void bootstrapAdapter.bootstrap({
      onStart: () => {
        dispatchState({
          type: "bootstrap/start"
        });
      },
      onProgress: (loaded, total) => {
        dispatchState({
          type: "bootstrap/progress",
          loaded,
          total
        });
      },
      onSnapshot: (snapshot) => {
        dispatchState({
          type: "bootstrap/snapshot",
          snapshot
        });
      },
      onError: (message) => {
        dispatchState({
          type: "bootstrap/error",
          message
        });
      },
      shouldStop: () => disposed || receivedRemoteStateRef.current
    });
    portAdapter.connect();

    return () => {
      disposed = true;
      portAdapter.disconnect();
      if (portAdapterRef.current === portAdapter) {
        portAdapterRef.current = null;
      }
    };
  }, [locale, state.connectionEpoch]);

  function dispatchCommand(command: TabCommand): void {
    portAdapterRef.current?.postMessage({
      type: "command/dispatch",
      payload: command
    });
  }

  function postTraceEvent(payload: PanelTraceEventPayload): void {
    portAdapterRef.current?.postMessage({
      type: "debug/trace-event",
      payload
    } satisfies PanelToBackgroundMessage);
  }

  async function copyDebugTrace(): Promise<boolean> {
    const bundle = await requestTraceBundle();
    await navigator.clipboard.writeText(buildTraceExportJson(bundle));
    return true;
  }

  async function exportDebugTrace(): Promise<boolean> {
    const bundle = await requestTraceBundle();
    const timestamp = createExportTimestamp();
    downloadTextFile(`sidepanel-trace-${timestamp}.json`, buildTraceExportJson(bundle), "application/json");
    downloadTextFile(`sidepanel-trace-${timestamp}.timeline.txt`, bundle.timelineText, "text/plain;charset=utf-8");
    return true;
  }

  function setVerboseLoggingEnabled(enabled: boolean): void {
    portAdapterRef.current?.postMessage({
      type: "debug/set-trace-settings",
      payload: {
        verboseLoggingEnabled: enabled
      }
    } satisfies PanelToBackgroundMessage);
  }

  function clearDebugTrace(): void {
    portAdapterRef.current?.postMessage({
      type: "debug/clear-trace"
    } satisfies PanelToBackgroundMessage);
  }

  function resyncPanel(): void {
    if (state.bootstrapProgress != null) {
      return;
    }

    postTraceEvent({
      event: "panel/resync-requested",
      details: {
        snapshotVersion: state.snapshot.version
      },
      category: "panel"
    });

    receivedRemoteStateRef.current = false;
    dispatchState({
      type: "resync/requested"
    });
  }

  async function requestTraceBundle() {
    const portAdapter = portAdapterRef.current;
    if (!portAdapter) {
      throw new Error(translate(locale, "error.panel.connectionUnavailable"));
    }

    return await portAdapter.requestTraceBundle();
  }

  const hasUsableSnapshot = state.snapshot.version > 0;

  return {
    snapshot: state.snapshot,
    bootstrapProgress: state.bootstrapProgress,
    errorMessage: state.errorMessage,
    isInteractive: state.isInteractive,
    hasUsableSnapshot,
    isLoading: state.snapshot.version === 0 && state.bootstrapProgress != null,
    isResyncing: state.bootstrapProgress != null,
    traceSettings: state.traceState.settings,
    traceEntryCount: state.traceState.entryCount,
    traceUpdatedAt: state.traceState.updatedAt,
    dispatchCommand,
    postTraceEvent,
    resyncPanel,
    copyDebugTrace,
    requestTraceBundle,
    exportDebugTrace,
    setVerboseLoggingEnabled,
    clearDebugTrace
  };
}

function createExportTimestamp(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
}

function downloadTextFile(fileName: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildTraceExportJson(bundle: TraceBundlePayload): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      settings: bundle.settings,
      updatedAt: bundle.updatedAt,
      entries: bundle.entries
    },
    null,
    2
  );
}
