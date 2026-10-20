import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidepanelStatus } from "../src/sidepanel/SidepanelStatus";

const baseProps = {
  locale: "zh-CN" as const,
  errorMessage: null,
  isInteractive: true,
  isLoading: false,
  isResyncing: false,
  hasUsableSnapshot: true,
  totalTabCount: 3
};

const toastText = "未发现重复标签";

function renderStatus(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(SidepanelStatus, {
      ...baseProps,
      ...overrides
    } as Parameters<typeof SidepanelStatus>[0])
  );
}

describe("SidepanelStatus 重复标签提示", () => {
  it("无错误且未开详细日志时（正常交互态）仍然渲染重复标签提示", () => {
    const html = renderStatus({ duplicateToast: toastText });

    expect(html).toContain("duplicate-toast");
    expect(html).toContain(toastText);
    expect(html).not.toContain("debug-state");
    expect(html).not.toContain("error-state");
  });

  it("开启详细日志时，调试横幅与重复标签提示同时渲染且互不覆盖", () => {
    const html = renderStatus({ traceEnabled: true, duplicateToast: toastText });

    expect(html).toContain("debug-state");
    expect(html).toContain("duplicate-toast");
    expect(html).toContain(toastText);
  });

  it("错误态下，错误提示与重复标签提示同时渲染", () => {
    const html = renderStatus({ errorMessage: "后台连接已断开", duplicateToast: toastText });

    expect(html).toContain("error-state");
    expect(html).toContain("duplicate-toast");
  });

  it("空列表态下，空状态文案与重复标签提示同时渲染", () => {
    const html = renderStatus({ totalTabCount: 0, duplicateToast: toastText });

    expect(html).toContain("empty-state");
    expect(html).toContain("duplicate-toast");
  });

  it("没有提示时不渲染任何额外节点", () => {
    const html = renderStatus();

    expect(html).toBe("");
  });
});
