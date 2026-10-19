export interface BadgeSettingsRecord {
  enabled: boolean;
}

export type LocaleMode = "system" | "zh-CN" | "en";

export type SupportedLocale = "zh-CN" | "en";

export interface LocaleSettingsRecord {
  mode: LocaleMode;
}

export type TabDisplaySize = "large" | "medium" | "small";

export interface DisplaySettingsRecord {
  tabDisplaySize: TabDisplaySize;
  hoveredTabPreviewEnabled: boolean;
}

export type LocalizedTextRecord =
  | {
      key: string;
      values?: Record<string, string | number>;
    }
  | {
      message: string;
    };

export interface ExtensionSettingsRecord {
  badge: BadgeSettingsRecord;
  locale: LocaleSettingsRecord;
  display: DisplaySettingsRecord;
  updatedAt: string;
}

export interface TabRecord {
  id: number;
  windowId: number;
  index: number;
  groupId: number;
  title: string;
  url: string;
  pinned: boolean;
  active: boolean;
  audible: boolean;
  discarded: boolean;
  favIconUrl: string | null;
  lastAccessed: number;
}

export interface TabGroupRecord {
  id: number;
  windowId: number;
  title: string;
  color: chrome.tabGroups.ColorEnum;
  collapsed: boolean;
}

export interface TabStoreState {
  tabsById: Record<number, TabRecord>;
  windowTabIds: Record<number, number[]>;
  windowOrder: number[];
  groupsById: Record<number, TabGroupRecord>;
  focusedWindowId: number | null;
}

export interface TabStoreSnapshot extends TabStoreState {
  version: number;
  bootId?: string;
}

export type TraceEntryLevel = "debug" | "info" | "warn" | "error";

export interface TraceEntryRecord {
  sessionId: string;
  sequence: number;
  at: string;
  sinceStartMs: number;
  event: string;
  details: Record<string, unknown>;
  source?: "background" | "sidepanel";
  level?: TraceEntryLevel;
  category?: string;
}

export interface TraceSettingsRecord {
  verboseLoggingEnabled: boolean;
  changedAt: string;
}

export interface TraceSummaryRecord {
  entryCount: number;
  bySource: Record<string, number>;
  byLevel: Record<string, number>;
  byCategory: Record<string, number>;
}

export interface TraceExportBundle {
  exportedAt: string;
  updatedAt: string | null;
  settings: TraceSettingsRecord;
  summary: TraceSummaryRecord;
  entries: TraceEntryRecord[];
}

export interface PanelTraceEventPayload {
  event: string;
  details: Record<string, unknown>;
  level?: TraceEntryLevel;
  category?: string;
}

export type StorePatch = (
  | {
      type: "tab/upsert";
      tab: TabRecord;
    }
  | {
      type: "group/upsert";
      group: TabGroupRecord;
    }
  | {
      type: "group/remove";
      groupId: number;
    }
  | {
      type: "tab/remove";
      tabId: number;
      windowId: number;
    }
  | {
      type: "window/focus";
      windowId: number | null;
    }
  | {
      type: "window/remove";
      windowId: number;
    }
) & {
  bootId?: string;
};

export type TabCommand = {
  type: "tab/activate";
  tabId: number;
} | {
  type: "tab/set-pinned";
  tabId: number;
  pinned: boolean;
} | {
  type: "tab/close";
  tabId: number;
} | {
  type: "tabs/close";
  tabIds: number[];
} | {
  type: "group/set-collapsed";
  groupId: number;
  collapsed: boolean;
} | {
  type: "tab/move";
  tabId: number;
  targetWindowId: number;
  targetIndex: number;
  targetGroupId: number | null;
} | {
  type: "tabs/move";
  tabIds: number[];
  targetWindowId: number;
  targetIndex: number;
  targetGroupId: number | null;
} | {
  type: "group/move";
  groupId: number;
  tabIds: number[];
  targetWindowId: number;
  targetIndex: number;
  title: string;
  color: chrome.tabGroups.ColorEnum;
  collapsed: boolean;
} | {
  type: "tabs/move-to-new-window";
  tabIds: number[];
};

export type WindowSectionItem =
  | {
      kind: "tab";
      tab: TabRecord;
    }
  | {
      kind: "group";
      group: TabGroupRecord;
      tabs: TabRecord[];
    };

export interface WindowSection {
  windowId: number;
  title: string;
  isFocused: boolean;
  collapsed: boolean;
  totalCount: number;
  firstUnpinnedTabIndex: number;
  items: WindowSectionItem[];
}

export type PanelRow =
  | {
      kind: "window";
      key: string;
      windowId: number;
      title: string;
      isFocused: boolean;
      collapsed: boolean;
      totalCount: number;
      firstUnpinnedTabIndex: number;
      matchesSearch?: boolean;
    }
  | {
      kind: "group";
      key: string;
      windowId: number;
      groupId: number;
      title: string;
      color: chrome.tabGroups.ColorEnum;
      collapsed: boolean;
      totalCount: number;
      tabIds: number[];
      firstTabIndex: number;
      matchesSearch?: boolean;
    }
  | {
      kind: "tab";
      key: string;
      windowId: number;
      tab: TabRecord;
      matchesSearch?: boolean;
    };

export type WindowRenderItem =
  | {
      kind: "single";
      row: Exclude<PanelRow, { kind: "window" }>;
    }
  | {
      kind: "group-block";
      groupRow: Extract<PanelRow, { kind: "group" }>;
      childRows: Array<Extract<PanelRow, { kind: "tab" }> >;
    };

export interface WindowRenderSection {
  windowRow: Extract<PanelRow, { kind: "window" }>;
  items: WindowRenderItem[];
}

export type SearchFilterMode = "filter" | "highlight";
