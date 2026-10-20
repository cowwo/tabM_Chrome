import { getRuntimeLocale, translate } from "../shared/i18n";
import type {
  PanelTraceEventPayload,
  TabStoreSnapshot,
  TraceEntryLevel,
  TraceEntryRecord,
  TraceExportBundle,
  TraceSettingsRecord,
  TraceSummaryRecord
} from "../shared/types";

interface PersistedTracePayload {
  entries: TraceEntryRecord[];
  updatedAt: string | null;
  settings: TraceSettingsRecord;
}

const TRACE_STORAGE_KEY = "sidepanelDebugTrace";
const DEFAULT_TRACE_SETTINGS: TraceSettingsRecord = {
  verboseLoggingEnabled: false,
  changedAt: new Date(0).toISOString()
};
const MAX_TRACE_ENTRIES = 400;
const MAX_PERSISTED_TRACE_ENTRIES = 400;
const TRACE_FLUSH_DELAY_MS = 1500;
const traceEntries: TraceEntryRecord[] = [];
const sessionStartMs = Date.now();
const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
let sequence = 0;
let initializePromise: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPersist = false;
let lastLoadedPersistedEntries: TraceEntryRecord[] = [];
let traceSettings: TraceSettingsRecord = { ...DEFAULT_TRACE_SETTINGS };
let updatedAt: string | null = null;

installTraceApi();

export async function initializeTracePersistence(): Promise<void> {
  if (!initializePromise) {
    initializePromise = (async () => {
      const payload = await readPersistedTracePayload();
      lastLoadedPersistedEntries = trimEntries(payload?.entries ?? [], MAX_PERSISTED_TRACE_ENTRIES);
      traceSettings = payload?.settings ?? { ...DEFAULT_TRACE_SETTINGS };
      updatedAt = payload?.updatedAt ?? null;
      replaceEntries(
        traceEntries,
        trimEntries(mergeTraceEntries(lastLoadedPersistedEntries, traceEntries), MAX_TRACE_ENTRIES)
      );
    })().catch((error) => {
      console.warn("failed to initialize sidepanel trace persistence", error);
    });
  }

  await initializePromise;
}

export function traceBackgroundEvent(
  event: string,
  details: Record<string, unknown> = {},
  options: {
    level?: TraceEntryLevel;
    category?: string;
  } = {}
): void {
  if (
    !traceSettings.verboseLoggingEnabled &&
    !isCriticalTraceEvent(event) &&
    inferTraceLevel(event) !== "error"
  ) {
    return;
  }

  appendTraceEntry({
    event,
    details,
    source: "background",
    level: options.level ?? inferTraceLevel(event),
    category: options.category ?? inferTraceCategory(event)
  });
}

export function tracePanelEvent(payload: PanelTraceEventPayload): void {
  if (!traceSettings.verboseLoggingEnabled && !isCriticalTraceEvent(payload.event)) {
    return;
  }

  appendTraceEntry({
    event: payload.event,
    details: payload.details,
    source: "sidepanel",
    level: payload.level ?? inferTraceLevel(payload.event),
    category: payload.category ?? inferTraceCategory(payload.event)
  });
}

export async function getPersistedTraceEntries(): Promise<TraceEntryRecord[]> {
  await initializeTracePersistence();
  await flushPersistedTrace();
  const payload = await readPersistedTracePayload();
  return trimEntries(payload?.entries ?? [], MAX_PERSISTED_TRACE_ENTRIES);
}

export async function getTraceSettings(): Promise<TraceSettingsRecord> {
  await initializeTracePersistence();
  return { ...traceSettings };
}

export async function setVerboseLoggingEnabled(verboseLoggingEnabled: boolean): Promise<TraceSettingsRecord> {
  await initializeTracePersistence();
  traceSettings = createTraceSettings(verboseLoggingEnabled);
  pendingPersist = true;
  await flushPersistedTrace();
  return { ...traceSettings };
}

export async function getTraceState(): Promise<{
  settings: TraceSettingsRecord;
  entryCount: number;
  updatedAt: string | null;
}> {
  await initializeTracePersistence();
  await flushPersistedTrace();
  const entries = await getPersistedTraceEntries();
  return {
    settings: { ...traceSettings },
    entryCount: entries.length,
    updatedAt
  };
}

export async function clearPersistedTrace(): Promise<void> {
  await initializeTracePersistence();
  lastLoadedPersistedEntries = [];
  replaceEntries(traceEntries, []);
  pendingPersist = false;
  updatedAt = new Date().toISOString();
  if (flushTimer != null) {
    globalThis.clearTimeout(flushTimer);
    flushTimer = null;
  }

  await chrome.storage.local.set({
    [TRACE_STORAGE_KEY]: createPersistedTracePayload([], updatedAt, traceSettings)
  });
}

export async function buildTraceExportBundle(): Promise<TraceExportBundle> {
  const entries = await getPersistedTraceEntries();
  const settings = await getTraceSettings();

  return {
    exportedAt: new Date().toISOString(),
    updatedAt,
    settings,
    summary: summarizeTraceEntries(entries),
    entries
  };
}

export async function formatPersistedTraceTimeline(): Promise<string> {
  const bundle = await buildTraceExportBundle();
  return formatTraceTimeline(bundle.entries, bundle.settings, bundle.summary, bundle.updatedAt);
}

export function formatTraceTimeline(
  entries: TraceEntryRecord[],
  settings: TraceSettingsRecord,
  summary: TraceSummaryRecord = summarizeTraceEntries(entries),
  exportedUpdatedAt: string | null = updatedAt
): string {
  const locale = getRuntimeLocale();
  const header = [
    translate(locale, "trace.timeline.header"),
    translate(locale, "trace.timeline.updatedAt", {
      value: exportedUpdatedAt ?? "unknown"
    }),
    translate(locale, "trace.timeline.verbose", {
      value: settings.verboseLoggingEnabled
        ? translate(locale, "trace.timeline.verbose.enabled")
        : translate(locale, "trace.timeline.verbose.disabled")
    }),
    translate(locale, "trace.timeline.entryCount", {
      count: summary.entryCount
    }),
    translate(locale, "trace.timeline.bySource", {
      value: JSON.stringify(summary.bySource)
    }),
    translate(locale, "trace.timeline.byLevel", {
      value: JSON.stringify(summary.byLevel)
    }),
    translate(locale, "trace.timeline.byCategory", {
      value: JSON.stringify(summary.byCategory)
    }),
    "",
    translate(locale, "trace.timeline.label")
  ];

  return [...header, ...entries.map(formatTraceTimelineEntry)].join("\n");
}

export function summarizeSnapshot(snapshot: TabStoreSnapshot): Record<string, unknown> {
  return {
    version: snapshot.version,
    focusedWindowId: snapshot.focusedWindowId,
    totalTabs: Object.keys(snapshot.tabsById).length,
    windows: snapshot.windowOrder.map((windowId) => ({
      windowId,
      count: snapshot.windowTabIds[windowId]?.length ?? 0,
      tabIdsPreview: (snapshot.windowTabIds[windowId] ?? []).slice(0, 8)
    }))
  };
}

export function summarizeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    };
  }

  return {
    message: String(error)
  };
}

function appendTraceEntry(params: {
  event: string;
  details: Record<string, unknown>;
  source: "background" | "sidepanel";
  level: TraceEntryLevel;
  category: string;
}): void {
  const entry = createTraceEntry(params);
  replaceEntries(traceEntries, appendEntry(traceEntries, entry, MAX_TRACE_ENTRIES));

  if (shouldLogToConsole(entry)) {
    const consoleMethod = resolveConsoleMethod(entry.level ?? "info");
    consoleMethod(`[sidepanel-trace ${entry.source} #${entry.sequence} +${entry.sinceStartMs}ms] ${entry.event}`, entry.details);
  }

  pendingPersist = true;
  if (isCriticalTraceEvent(params.event)) {
    void flushPersistedTrace();
    return;
  }

  if (flushTimer != null) {
    return;
  }

  flushTimer = globalThis.setTimeout(() => {
    flushTimer = null;
    void flushPersistedTrace();
  }, TRACE_FLUSH_DELAY_MS);
}

async function flushPersistedTrace(): Promise<void> {
  if (!pendingPersist) {
    return;
  }

  await initializeTracePersistence();
  pendingPersist = false;

  const mergedEntries = mergeTraceEntries(lastLoadedPersistedEntries, traceEntries);
  updatedAt = new Date().toISOString();

  await chrome.storage.local.set({
    [TRACE_STORAGE_KEY]: createPersistedTracePayload(mergedEntries, updatedAt, traceSettings)
  });
  lastLoadedPersistedEntries = mergedEntries;
}

async function readPersistedTracePayload(): Promise<PersistedTracePayload | null> {
  const result = await chrome.storage.local.get(TRACE_STORAGE_KEY);
  return (result[TRACE_STORAGE_KEY] as PersistedTracePayload | undefined) ?? null;
}

function summarizeTraceEntries(entries: TraceEntryRecord[]): TraceSummaryRecord {
  return entries.reduce<TraceSummaryRecord>(
    (summary, entry) => {
      const source = entry.source ?? "unknown";
      const level = entry.level ?? "info";
      const category = entry.category ?? "uncategorized";

      return {
        entryCount: summary.entryCount + 1,
        bySource: incrementSummaryCount(summary.bySource, source),
        byLevel: incrementSummaryCount(summary.byLevel, level),
        byCategory: incrementSummaryCount(summary.byCategory, category)
      };
    },
    {
      entryCount: 0,
      bySource: {},
      byLevel: {},
      byCategory: {}
    }
  );
}

function createTraceEntry(params: {
  event: string;
  details: Record<string, unknown>;
  source: "background" | "sidepanel";
  level: TraceEntryLevel;
  category: string;
}): TraceEntryRecord {
  return {
    sessionId,
    sequence: ++sequence,
    at: new Date().toISOString(),
    sinceStartMs: Date.now() - sessionStartMs,
    event: params.event,
    details: params.details,
    source: params.source,
    level: params.level,
    category: params.category
  };
}

function createTraceSettings(verboseLoggingEnabled: boolean): TraceSettingsRecord {
  return {
    verboseLoggingEnabled,
    changedAt: new Date().toISOString()
  };
}

function appendEntry(
  entries: readonly TraceEntryRecord[],
  entry: TraceEntryRecord,
  maxEntries: number
): TraceEntryRecord[] {
  return trimEntries([...entries, entry], maxEntries);
}

function mergeTraceEntries(
  persistedEntries: readonly TraceEntryRecord[],
  sessionEntries: readonly TraceEntryRecord[]
): TraceEntryRecord[] {
  return trimEntries([...persistedEntries, ...sessionEntries], MAX_PERSISTED_TRACE_ENTRIES);
}

function createPersistedTracePayload(
  entries: TraceEntryRecord[],
  nextUpdatedAt: string | null,
  settings: TraceSettingsRecord
): PersistedTracePayload {
  return {
    entries,
    updatedAt: nextUpdatedAt,
    settings
  };
}

function replaceEntries(target: TraceEntryRecord[], nextEntries: readonly TraceEntryRecord[]): void {
  target.splice(0, target.length, ...nextEntries);
}

function incrementSummaryCount(summary: Record<string, number>, key: string): Record<string, number> {
  return {
    ...summary,
    [key]: (summary[key] ?? 0) + 1
  };
}

function trimEntries(entries: readonly TraceEntryRecord[], maxEntries: number): TraceEntryRecord[] {
  return entries.slice(Math.max(0, entries.length - maxEntries));
}

function isCriticalTraceEvent(event: string): boolean {
  return event === "queue/error" || event === "syncWindow/error" || event === "command/error" || event.endsWith("/error");
}

function inferTraceLevel(event: string): TraceEntryLevel {
  if (event.endsWith("/error") || event.includes("error")) {
    return "error";
  }
  if (event.includes("warn")) {
    return "warn";
  }
  return "info";
}

function inferTraceCategory(event: string): string {
  if (event.startsWith("bg/") || event.startsWith("tabs/") || event.startsWith("windows/")) {
    return "background";
  }
  if (event.startsWith("panel/search") || event.startsWith("search/")) {
    return "search";
  }
  if (event.includes("drag") || event.includes("drop")) {
    return "drag";
  }
  if (event.includes("select")) {
    return "selection";
  }
  if (event.includes("command")) {
    return "command";
  }
  if (event.includes("trace")) {
    return "trace";
  }
  return "ui";
}

function shouldLogToConsole(entry: TraceEntryRecord): boolean {
  if (entry.level === "error" || entry.level === "warn") {
    return true;
  }

  if (!traceSettings.verboseLoggingEnabled) {
    return false;
  }

  return entry.event.startsWith("command/")
    || entry.event.startsWith("panel/")
    || entry.event.startsWith("syncWindow/")
    || entry.event.startsWith("coordinator/")
    || entry.category === "trace";
}

function resolveConsoleMethod(level: TraceEntryLevel): typeof console.info {
  if (level === "error") {
    return console.error;
  }
  if (level === "warn") {
    return console.warn;
  }
  return console.info;
}

function formatTraceTimelineEntry(entry: TraceEntryRecord): string {
  const source = entry.source ?? "unknown";
  const level = entry.level ?? "info";
  const category = entry.category ?? "uncategorized";
  const details = Object.entries(entry.details)
    .map(([key, value]) => `${key}=${formatTraceValue(value)}`)
    .join(" ");

  return `[${entry.at}] +${entry.sinceStartMs}ms [${source}][${level}][${category}] ${entry.event}${details ? ` ${details}` : ""}`;
}

function formatTraceValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function installTraceApi(): void {
  const scope = globalThis as typeof globalThis & {
    __SIDE_PANEL_TRACE__?: {
      clear: () => Promise<void>;
      getEntries: () => TraceEntryRecord[];
      getPersistedEntries: () => Promise<TraceEntryRecord[]>;
    };
  };

  scope.__SIDE_PANEL_TRACE__ = {
    clear: () => clearPersistedTrace(),
    getEntries: () => traceEntries.map(cloneTraceEntry),
    getPersistedEntries: () => getPersistedTraceEntries()
  };
}

function cloneTraceEntry(entry: TraceEntryRecord): TraceEntryRecord {
  return {
    ...entry,
    details: { ...entry.details }
  };
}
