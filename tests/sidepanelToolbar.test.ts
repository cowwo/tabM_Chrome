import { createElement, createRef, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidepanelToolbar } from "../src/sidepanel/SidepanelToolbar";

function renderSidepanelToolbarMarkup(overrides: Partial<ComponentProps<typeof SidepanelToolbar>> = {}): string {
  return renderToStaticMarkup(
    createElement(SidepanelToolbar, {
      hoveredTabPreview: null,
      locale: "zh-CN",
      appShellRef: createRef<HTMLDivElement>(),
      selectedCount: 2,
      hasCollapsedWindows: false,
      hasCollapsedGroups: false,
      disabled: false,
      onResync: () => undefined,
      onSelectDuplicates: () => undefined,
      onLocateCurrentPage: () => undefined,
      canLocateCurrentPage: true,
      locateCurrentPageDisabledReasonKey: null,
      onOpenSettings: () => undefined,
      onExpandAll: () => undefined,
      onCollapseAll: () => undefined,
      onCloseSelected: () => undefined,
      moveToNewWindowCount: 0,
      onMoveToNewWindow: () => undefined,
      selectionMode: true,
      onToggleSelectionMode: () => undefined,
      ...overrides
    })
  );
}

describe("SidepanelToolbar", () => {
  it("renders the close selected toolbar button with the delete icon", () => {
    const markup = renderSidepanelToolbarMarkup();

    expect(markup).toContain('aria-label="关闭已选（2）"');
    expect(markup).toMatch(/aria-label="关闭已选（2）"[^>]*><span class="i-icon i-icon-delete">/);
  });

  it("renders the selection toggle as cancel multi-select when selection mode is active", () => {
    const markup = renderSidepanelToolbarMarkup({
      selectionMode: true,
      selectedCount: 0
    });

    expect(markup).toContain('aria-label="取消多选"');
    expect(markup).toMatch(/aria-label="取消多选"[^>]*><span class="i-icon i-icon-close-small">/);
  });
});

