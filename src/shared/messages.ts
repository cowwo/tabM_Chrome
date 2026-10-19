import type {
  PanelTraceEventPayload,
  StorePatch,
  TabCommand,
  TabStoreSnapshot,
  TraceEntryRecord,
  TraceSettingsRecord
} from "./types";

export type BackgroundToPanelMessage =
  | {
      type: "panel/snapshot";
      payload: {
        snapshot: TabStoreSnapshot;
      };
    }
  | {
      type: "panel/patch";
      payload: StorePatch;
    }
  | {
      type: "panel/error";
      payload: {
        message: string;
      };
    }
  | {
      type: "debug/trace";
      payload: {
        entries: TraceEntryRecord[];
        settings: TraceSettingsRecord;
        updatedAt: string | null;
        timelineText: string;
      };
    }
  | {
      type: "debug/trace-state";
      payload: {
        settings: TraceSettingsRecord;
        entryCount: number;
        updatedAt: string | null;
      };
    };

export type PanelToBackgroundMessage =
  | {
      type: "command/dispatch";
      payload: TabCommand;
    }
  | {
      type: "debug/get-trace";
    }
  | {
      type: "debug/trace-event";
      payload: PanelTraceEventPayload;
    }
  | {
      type: "debug/set-trace-settings";
      payload: {
        verboseLoggingEnabled: boolean;
      };
    }
  | {
      type: "debug/clear-trace";
    }
  | {
      type: "panel/heartbeat";
    };
