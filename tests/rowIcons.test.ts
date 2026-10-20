import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NO_TAB_GROUP_ID } from "../src/shared/defaults";
import type { PanelRow, TabRecord } from "../src/shared/types";
import { RowShell, type RowShellProps } from "../src/sidepanel/components/listRows";

function makeTab(overrides: Partial<TabRecord> = {}): TabRecord {
  return {
    id: overrides.id ?? 1,
    windowId: overrides.windowId ?? 1,
    index: overrides.index ?? 0,
    groupId: overrides.groupId ?? NO_TAB_GROUP_ID,
    title: overrides.title ?? `Tab ${overrides.id ?? 1}`,
    url: overrides.url ?? "https://example.com",
    pinned: overrides.pinned ?? false,
    active: overrides.active ?? false,
    audible: overrides.audible ?? false,
    discarded: overrides.discarded ?? false,
    favIconUrl: overrides.favIconUrl ?? null,
    lastAccessed: overrides.lastAccessed ?? 0
  };
}

function makeTabRow(pinned = false): Extract<PanelRow, { kind: "tab" }> {
  const tab = makeTab({ pinned });
  return {
    kind: "tab",
    key: `tab-${tab.id}`,
    windowId: tab.windowId,
    tab
  };
}

function makeWindowRow(): Extract<PanelRow, { kind: "window" }> {
  return {
    kind: "window",
    key: "window-1",
    windowId: 1,
    title: "Window 1",
    isFocused: true,
    collapsed: false,
    totalCount: 1,
    firstUnpinnedTabIndex: 0
  };
}

function makeGroupRow(): Extract<PanelRow, { kind: "group" }> {
  return {
    kind: "group",
    key: "group-10",
    windowId: 1,
    groupId: 10,
    title: "Group 10",
    color: "blue",
    collapsed: false,
    totalCount: 1,
    tabIds: [1],
    firstTabIndex: 0
  };
}

const noop = () => undefined;

function makeRowShellProps(overrides: Partial<RowShellProps> = {}): RowShellProps {
  return {
    locale: "zh-CN",
    row: overrides.row ?? makeTabRow(),
    rowRefs: { current: new Map<string, HTMLDivElement>() },
    onCaptureManualToggleAnchor: noop,
    disabled: false,
    onClearSelection: noop,
    onToggleWindow: noop,
    onToggleGroup: noop,
    onActivateTab: noop,
    onTogglePinned: noop,
    onCloseTab: noop,
    selectionMode: false,
    onPointerDown: noop,
    onPointerEnter: noop,
    onPointerMove: noop,
    onPointerUp: noop,
    onPointerCancel: noop,
    ...overrides
  };
}

function renderRowShell(overrides: Partial<RowShellProps> = {}): string {
  return renderToStaticMarkup(createElement(RowShell, makeRowShellProps(overrides)));
}

describe("行内轻量图标与操作按钮 testid", () => {
  it("标签行渲染本地 svg 图标并给操作按钮加 data-testid", () => {
    const markup = renderRowShell();

    expect(markup).toContain('data-testid="tab-pin"');
    expect(markup).toContain('data-testid="tab-close"');
    expect(markup).toContain('class="i-icon i-icon-pin"');
    expect(markup).toContain('class="i-icon i-icon-close-small"');
    expect((markup.match(/<svg /g) ?? []).length).toBe(2);
    expect(markup).toContain('viewBox="0 0 48 48"');
    expect(markup).toContain("M10.6963 17.5042");
    expect(markup).toContain('d="M14 14L34 34"');
    expect(markup).toContain('d="M14 34L34 14"');
    // 本地图标不再经过 icon-park 的随机 clipPath id
    expect(markup).not.toContain("clip-path");
  });

  it("未固定与已固定时图标主题、aria-label 与 aria-pressed 保持不变", () => {
    const unpinned = renderRowShell({ row: makeTabRow(false) });
    expect(unpinned).toContain('aria-label="固定标签"');
    expect(unpinned).toContain('aria-pressed="false"');
    expect(unpinned).toMatch(/<path d="M10\.6963[^"]*" fill="none"/);

    const pinned = renderRowShell({ row: makeTabRow(true) });
    expect(pinned).toContain('aria-label="取消固定标签"');
    expect(pinned).toContain('aria-pressed="true"');
    expect(pinned).toContain("tab-row__action--active");
    expect(pinned).toMatch(/<path d="M10\.6963[^"]*" fill="currentColor"/);
  });

  it("窗口行与组行不渲染行内图标和操作按钮 testid", () => {
    for (const markup of [
      renderRowShell({ row: makeWindowRow() }),
      renderRowShell({ row: makeGroupRow() })
    ]) {
      expect(markup).not.toContain("data-testid=");
      expect(markup).not.toContain("<svg");
    }
  });
});
