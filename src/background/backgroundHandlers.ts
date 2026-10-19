import type { PanelToBackgroundMessage } from "../shared/messages";
import type { BackgroundTabStore } from "./tabStore";
import type { CommandExecutionResult } from "./commandExecutor";
import type { ExtensionSettingsRecord } from "../shared/types";

export type PortMessageHandler<T extends PanelToBackgroundMessage = PanelToBackgroundMessage> = (
  port: chrome.runtime.Port,
  message: T
) => Promise<void>;

export type BackgroundRuntimeDependencies = {
  panelPortHub: {
    broadcastTraceState: (state: Awaited<ReturnType<BackgroundRuntimeDependencies["getTraceState"]>>) => void;
    sendError: (port: chrome.runtime.Port, message: string) => void;
  };
  windowSyncCoordinator: {
    runCommandPhase: (params: {
      cause: string;
      task: () => Promise<CommandExecutionResult>;
    }) => Promise<CommandExecutionResult>;
    scheduleWindowSync: (params: { windowId: number; cause: string }) => Promise<void>;
    scheduleCrossWindowSync: (params: {
      sourceWindowId: number | null;
      targetWindowId: number;
      cause: string;
    }) => Promise<void>;
    runAfterCurrentCycle: (params: {
      cause: string;
      task: () => Promise<void>;
    }) => Promise<void>;
  };
  store: BackgroundTabStore;
  detachedTabWindowIds: Map<number, number>;
  extensionSettings: () => ExtensionSettingsRecord;
  setExtensionSettings: (settings: ExtensionSettingsRecord) => void;
  scheduleActionBadgeUpdate: () => void;
  configureSidePanel: () => Promise<void>;
  ensureInitialized: () => Promise<void>;
  executeTabCommand: (command: Extract<PanelToBackgroundMessage, { type: "command/dispatch" }>['payload']) => Promise<CommandExecutionResult>;
  buildTraceExportBundle: () => Promise<{
    entries: Array<unknown>;
    settings: { verboseLoggingEnabled: boolean; changedAt: string };
    updatedAt: string | null;
  }>;
  formatPersistedTraceTimeline: () => Promise<string>;
  clearPersistedTrace: () => Promise<void>;
  setVerboseLoggingEnabled: (enabled: boolean) => Promise<{ verboseLoggingEnabled: boolean; changedAt: string }>;
  getTraceState: () => Promise<{ settings: { verboseLoggingEnabled: boolean; changedAt: string }; entryCount: number; updatedAt: string | null }>;
  traceBackgroundEvent: (event: string, details?: Record<string, unknown>, options?: { category?: string }) => void;
  tracePanelEvent: (payload: Extract<PanelToBackgroundMessage, { type: "debug/trace-event" }>['payload']) => void;
  summarizeError: (error: unknown) => Record<string, unknown>;
  summarizeSnapshot: (snapshot: ReturnType<BackgroundTabStore["getSnapshot"]>) => Record<string, unknown>;
  queryNormalizedTabsInWindow: (windowId: number) => Promise<Array<{ id: number; groupId: number } & Record<string, unknown>>>;
  queryGroups: (groupIds: number[]) => Promise<Array<Record<string, unknown>>>;
  queryNormalizedTabsInGroup: (groupId: number) => Promise<Array<Record<string, unknown>>>;
  queryNormalizedGroup: (groupId: number, providedGroup?: chrome.tabGroups.TabGroup) => Promise<Record<string, unknown>>;
  syncGroupSnapshot: (params: {
    queryGroup: () => Promise<Record<string, unknown>>;
    queryTabsInGroup: () => Promise<Array<Record<string, unknown>>>;
    upsertGroup: (group: Record<string, unknown>) => void;
    upsertTab: (tab: Record<string, unknown>) => void;
    removeGroup: () => void;
  }) => Promise<void>;
  mergeExtensionSettings: (value: Partial<ExtensionSettingsRecord> | undefined) => ExtensionSettingsRecord;
  extensionSettingsStorageKey: string;
  toErrorMessage: (error: unknown) => string;
};

export function createPortMessageHandlers(deps: Pick<
  BackgroundRuntimeDependencies,
  | "buildTraceExportBundle"
  | "formatPersistedTraceTimeline"
  | "traceBackgroundEvent"
  | "tracePanelEvent"
  | "setVerboseLoggingEnabled"
  | "panelPortHub"
  | "getTraceState"
  | "clearPersistedTrace"
  | "windowSyncCoordinator"
  | "executeTabCommand"
>): {
  "debug/get-trace": PortMessageHandler<Extract<PanelToBackgroundMessage, { type: "debug/get-trace" }>>;
  "debug/trace-event": PortMessageHandler<Extract<PanelToBackgroundMessage, { type: "debug/trace-event" }>>;
  "debug/set-trace-settings": PortMessageHandler<Extract<PanelToBackgroundMessage, { type: "debug/set-trace-settings" }>>;
  "debug/clear-trace": PortMessageHandler<Extract<PanelToBackgroundMessage, { type: "debug/clear-trace" }>>;
  "command/dispatch": PortMessageHandler<Extract<PanelToBackgroundMessage, { type: "command/dispatch" }>>;
  "panel/heartbeat": PortMessageHandler<Extract<PanelToBackgroundMessage, { type: "panel/heartbeat" }>>;
} {
  return {
    "debug/get-trace": async (port) => {
      deps.traceBackgroundEvent("bg/trace-export-requested", { source: "panel" }, { category: "trace" });
      const bundle = await deps.buildTraceExportBundle();
      const timelineText = await deps.formatPersistedTraceTimeline();
      port.postMessage({
        type: "debug/trace",
        payload: {
          entries: bundle.entries,
          settings: bundle.settings,
          updatedAt: bundle.updatedAt,
          timelineText
        }
      });
    },
    "debug/trace-event": async (_port, message) => {
      deps.tracePanelEvent(message.payload);
    },
    "debug/set-trace-settings": async (_port, message) => {
      const settings = await deps.setVerboseLoggingEnabled(message.payload.verboseLoggingEnabled);
      deps.traceBackgroundEvent("bg/trace-setting-changed", {
        verboseLoggingEnabled: settings.verboseLoggingEnabled
      }, { category: "trace" });
      deps.panelPortHub.broadcastTraceState(await deps.getTraceState());
    },
    "debug/clear-trace": async () => {
      await deps.clearPersistedTrace();
      deps.traceBackgroundEvent("bg/trace-cleared", {}, { category: "trace" });
      deps.panelPortHub.broadcastTraceState(await deps.getTraceState());
    },
    "command/dispatch": async (_port, message) => {
      deps.traceBackgroundEvent("command/dispatch", {
        commandType: message.payload.type,
        payload: message.payload
      });

      await deps.windowSyncCoordinator.runCommandPhase({
        cause: `command/${message.payload.type}`,
        task: async () => {
          const commandResult = await deps.executeTabCommand(message.payload);
          deps.traceBackgroundEvent("command/result", {
            commandType: message.payload.type,
            affectedWindowIds: commandResult.affectedWindowIds,
            preferredOrder: commandResult.preferredOrder ?? []
          });
          return commandResult;
        }
      });
    },
    "panel/heartbeat": async () => {
      // 心跳仅用于保持 service worker 存活，后台静默忽略
    }
  };
}
