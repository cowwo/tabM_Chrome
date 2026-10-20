import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTraceExportBundle,
  clearPersistedTrace,
  formatPersistedTraceTimeline,
  getTraceSettings,
  setVerboseLoggingEnabled,
  summarizeSnapshot,
  traceBackgroundEvent,
  tracePanelEvent
} from "../src/background/trace";

const storage = new Map<string, unknown>();

beforeEach(async () => {
  storage.clear();
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
        set: vi.fn(async (payload: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(payload)) {
            storage.set(key, value);
          }
        }),
        remove: vi.fn(async (key: string) => {
          storage.delete(key);
        })
      }
    }
  });
  await clearPersistedTrace();
  await setVerboseLoggingEnabled(false);
});

describe("trace", () => {
  it("persists verbose logging setting", async () => {
    await setVerboseLoggingEnabled(true);
    await expect(getTraceSettings()).resolves.toMatchObject({
      verboseLoggingEnabled: true
    });
  });

  it("records panel events only when verbose logging is enabled", async () => {
    tracePanelEvent({
      event: "panel/search-updated",
      details: {
        searchTerm: "abc"
      }
    });

    let bundle = await buildTraceExportBundle();
    expect(bundle.entries.some((entry) => entry.event === "panel/search-updated")).toBe(false);

    await setVerboseLoggingEnabled(true);
    tracePanelEvent({
      event: "panel/search-updated",
      details: {
        searchTerm: "abc"
      }
    });

    bundle = await buildTraceExportBundle();
    expect(bundle.entries.some((entry) => entry.event === "panel/search-updated")).toBe(true);
  });

  it("records background events only when verbose logging is enabled", async () => {
    traceBackgroundEvent("bg/test-event", {
      foo: "bar"
    });

    let bundle = await buildTraceExportBundle();
    expect(bundle.entries.some((entry) => entry.event === "bg/test-event")).toBe(false);

    await setVerboseLoggingEnabled(true);
    traceBackgroundEvent("bg/test-event", {
      foo: "bar"
    });

    bundle = await buildTraceExportBundle();
    expect(bundle.entries.some((entry) => entry.event === "bg/test-event")).toBe(true);
  });

  it("records critical background events even when verbose logging is disabled", async () => {
    traceBackgroundEvent("syncWindow/error", {
      windowId: 3,
      message: "query failed"
    });
    traceBackgroundEvent("command/error", {
      commandType: "tab/activate"
    });

    const bundle = await buildTraceExportBundle();
    const recordedEvents = bundle.entries
      .filter((entry) => entry.source === "background")
      .map((entry) => entry.event);
    expect(recordedEvents).toContain("syncWindow/error");
    expect(recordedEvents).toContain("command/error");
  });

  it("records inferred error-level background events even when verbose logging is disabled", async () => {
    traceBackgroundEvent("panel/send-snapshot-error", {
      message: "boom"
    });

    const bundle = await buildTraceExportBundle();
    expect(bundle.entries.some((entry) => entry.event === "panel/send-snapshot-error")).toBe(true);
  });

  it("keeps settings after clearing entries", async () => {
    await setVerboseLoggingEnabled(true);
    traceBackgroundEvent("bg/test-event", {
      foo: "bar"
    });

    await clearPersistedTrace();

    const bundle = await buildTraceExportBundle();
    expect(bundle.entries).toEqual([]);
    expect(bundle.settings.verboseLoggingEnabled).toBe(true);
  });

  it("builds timeline text with source and category", async () => {
    await setVerboseLoggingEnabled(true);
    traceBackgroundEvent("bg/test-event", { foo: "bar" }, { category: "trace" });
    tracePanelEvent({
      event: "panel/search-updated",
      details: { searchTerm: "abc" },
      category: "search"
    });

    const timeline = await formatPersistedTraceTimeline();
    expect(timeline).toContain("Side panel debug timeline");
    expect(timeline).toContain("bg/test-event");
    expect(timeline).toContain("panel/search-updated");
    expect(timeline).toContain("[background]");
    expect(timeline).toContain("[sidepanel]");
  });

  it("builds compact snapshot summaries with tab previews", () => {
    expect(
      summarizeSnapshot({
        version: 7,
        focusedWindowId: 3,
        tabsById: Object.fromEntries(
          Array.from({ length: 10 }, (_unused, index) => [
            index + 1,
            {
              id: index + 1,
              windowId: 3,
              index,
              groupId: -1,
              title: `Tab ${index + 1}`,
              url: `https://example.com/${index + 1}`,
              pinned: false,
              active: index === 0,
              audible: false,
              discarded: false,
              favIconUrl: null,
              lastAccessed: 0
            }
          ])
        ),
        windowTabIds: {
          3: Array.from({ length: 10 }, (_unused, index) => index + 1)
        },
        windowOrder: [3],
        groupsById: {}
      })
    ).toEqual({
      version: 7,
      focusedWindowId: 3,
      totalTabs: 10,
      windows: [
        {
          windowId: 3,
          count: 10,
          tabIdsPreview: [1, 2, 3, 4, 5, 6, 7, 8]
        }
      ]
    });
  });

});
