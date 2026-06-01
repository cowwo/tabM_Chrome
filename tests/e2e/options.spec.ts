import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { openSidepanelPage } from "./helpers/sidepanel";

test("options 页面切换到 English 后立即影响侧边栏", async ({ extensionContext, sidepanelPage }) => {
  const { extensionId } = await openSidepanelPage(extensionContext, "dist");

  const optionsPage = await extensionContext.newPage();
  await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "domcontentloaded",
    timeout: 10_000
  });

  await optionsPage.selectOption("#locale-mode", "en");
  await expect(optionsPage).toHaveTitle("Settings");
  await expect(optionsPage.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(optionsPage.getByLabel("Show number badge on the toolbar icon")).toBeVisible();
  await expect(optionsPage.getByLabel("Show hovered tab preview")).toBeVisible();
  await expect(optionsPage.getByLabel("Enable verbose trace")).toBeVisible();
  await expect(optionsPage.getByRole("button", { name: "Export trace" })).toBeVisible();
  await expect(optionsPage.getByRole("button", { name: "Clear trace" })).toBeVisible();

  await sidepanelPage.reload({ waitUntil: "domcontentloaded" });
  await expect(sidepanelPage.getByRole("button", { name: "Settings" })).toBeVisible();
  await expect(sidepanelPage.getByRole("button", { name: "Verbose trace: off" })).toHaveCount(0);
  await expect(sidepanelPage.getByRole("button", { name: "Export trace" })).toHaveCount(0);
  await expect(sidepanelPage.getByRole("button", { name: "Clear trace" })).toHaveCount(0);
  await expect(sidepanelPage.getByLabel("Search tabs")).toBeVisible();

  await optionsPage.close();
});

test("开启悬浮标签预览后侧边栏顶部显示标题和 URL，关闭后隐藏", async ({ extensionContext, sidepanelPage }) => {
  const { extensionId } = await openSidepanelPage(extensionContext, "dist");

  const optionsPage = await extensionContext.newPage();
  await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "domcontentloaded",
    timeout: 10_000
  });

  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const targetTitle = `hover-setting-${uniqueSuffix}`;
  const targetTab = await extensionContext.newPage();
  await targetTab.goto(`data:text/html,<title>${targetTitle}</title><body>${targetTitle}</body>`);
  await targetTab.waitForLoadState("load");

  await sidepanelPage.reload({ waitUntil: "domcontentloaded" });
  await sidepanelPage.bringToFront();

  const tabRow = sidepanelPage.locator(".tab-row__main", {
    has: sidepanelPage.locator(".tab-row__title", { hasText: targetTitle })
  }).first();
  const hoveredPreview = sidepanelPage.locator(".panel-toolbar__hovered-tab");

  await expect(tabRow).toBeVisible();
  await tabRow.hover();
  await expect(hoveredPreview).toHaveCount(0);

  await optionsPage.getByLabel("Show hovered tab preview").click({ force: true });

  await sidepanelPage.reload({ waitUntil: "domcontentloaded" });
  await sidepanelPage.bringToFront();
  await tabRow.hover();
  await expect(hoveredPreview).toContainText(targetTitle);

  await optionsPage.bringToFront();
  await optionsPage.getByLabel("Show hovered tab preview").click({ force: true });

  await sidepanelPage.reload({ waitUntil: "domcontentloaded" });
  await expect(hoveredPreview).toHaveCount(0);

  await sidepanelPage.bringToFront();
  await tabRow.hover();
  await expect(hoveredPreview).toHaveCount(0);

  await optionsPage.close();
});

// ---------------------------------------------------------------------------
// 选项页控制测试
// ---------------------------------------------------------------------------

test("徽标开关控制工具栏标签计数显示", async ({ extensionContext }) => {
  const { extensionId } = await openSidepanelPage(extensionContext, "dist");
  const optionsPage = await extensionContext.newPage();
  await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "domcontentloaded",
    timeout: 10_000
  });

  const badgeCheckbox = optionsPage.locator("#badge-enabled");
  await expect(badgeCheckbox).toBeVisible();

  // Uncheck badge（headless 下 React checkbox 用 force click）
  await badgeCheckbox.click({ force: true });
  await expect(badgeCheckbox).not.toBeChecked();

  // Re-check badge
  await badgeCheckbox.click({ force: true });
  await expect(badgeCheckbox).toBeChecked();

  await optionsPage.close();
});

test("标签显示尺寸设置保存到存储", async ({ extensionContext }) => {
  const { extensionId } = await openSidepanelPage(extensionContext, "dist");
  const optionsPage = await extensionContext.newPage();
  await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "domcontentloaded",
    timeout: 10_000
  });

  // Click "Small" radio and verify
  const smallRadio = optionsPage.getByRole("radio", { name: "Small" });
  await smallRadio.click();
  await expect(smallRadio).toBeChecked();

  let storageSize = await optionsPage.evaluate(() =>
    chrome.storage.local.get("sidepanelExtensionSettings").then(
      (r) => (r.sidepanelExtensionSettings as Record<string, unknown>)?.display as Record<string, unknown>
    )
  );
  expect(storageSize?.tabDisplaySize).toBe("small");

  // Click "Large" and verify
  const largeRadio = optionsPage.getByRole("radio", { name: "Large" });
  await largeRadio.click();
  await expect(largeRadio).toBeChecked();

  storageSize = await optionsPage.evaluate(() =>
    chrome.storage.local.get("sidepanelExtensionSettings").then(
      (r) => (r.sidepanelExtensionSettings as Record<string, unknown>)?.display as Record<string, unknown>
    )
  );
  expect(storageSize?.tabDisplaySize).toBe("large");

  await optionsPage.close();
});

test("详细日志开关控制侧边栏调试横幅", async ({ extensionContext, sidepanelPage }) => {
  const { extensionId } = await openSidepanelPage(extensionContext, "dist");
  const optionsPage = await extensionContext.newPage();
  await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "domcontentloaded",
    timeout: 10_000
  });

  // Wait for trace state to load (checkbox becomes enabled)
  const verboseCheckbox = optionsPage.locator("#debug-verbose-logging");
  await expect(verboseCheckbox).not.toBeDisabled({ timeout: 10_000 });

  // Enable verbose logging（headless 下 React checkbox 用 force click）
  await verboseCheckbox.click({ force: true });

  // Reload sidepanel and check debug banner
  await sidepanelPage.reload({ waitUntil: "domcontentloaded" });
  await sidepanelPage.bringToFront();
  await expect(sidepanelPage.getByText("详细日志记录中")).toBeVisible({ timeout: 5_000 });

  // Disable verbose logging
  await optionsPage.bringToFront();
  await verboseCheckbox.click({ force: true });

  await sidepanelPage.reload({ waitUntil: "domcontentloaded" });
  await expect(sidepanelPage.getByText("详细日志记录中")).toHaveCount(0);

  await optionsPage.close();
});

test("导出日志按钮可点击且无崩溃", async ({ extensionContext }) => {
  const { extensionId } = await openSidepanelPage(extensionContext, "dist");
  const optionsPage = await extensionContext.newPage();
  await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "domcontentloaded",
    timeout: 10_000
  });

  // Wait for trace state to load
  const verboseCheckbox = optionsPage.locator("#debug-verbose-logging");
  await expect(verboseCheckbox).not.toBeDisabled({ timeout: 10_000 });

  // Enable verbose logging, then click export
  await verboseCheckbox.click({ force: true });
  const exportBtn = optionsPage.getByRole("button", { name: "导出日志" });
  await expect(exportBtn).not.toBeDisabled();
  await exportBtn.click();

  await optionsPage.close();
});

test("清空日志后日志条目归零", async ({ extensionContext }) => {
  const { extensionId } = await openSidepanelPage(extensionContext, "dist");
  const optionsPage = await extensionContext.newPage();
  await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "domcontentloaded",
    timeout: 10_000
  });

  // Wait for trace state, clear, verify 0
  await expect(optionsPage.locator("#debug-verbose-logging")).not.toBeDisabled({ timeout: 10_000 });
  await optionsPage.getByRole("button", { name: "清空日志" }).click();
  await expect(optionsPage.getByText("条目数：0")).toBeVisible();

  await optionsPage.close();
});

test("恢复默认设置后设置重置", async ({ extensionContext }) => {
  const { extensionId } = await openSidepanelPage(extensionContext, "dist");
  const optionsPage = await extensionContext.newPage();
  await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "domcontentloaded",
    timeout: 10_000
  });

  // Switch to English to change a setting
  await optionsPage.selectOption("#locale-mode", "en");
  await expect(optionsPage).toHaveTitle("Settings");

  // Also change badge setting
  const badgeCheckbox = optionsPage.locator("#badge-enabled");
  await badgeCheckbox.click({ force: true });

  // Click reset
  const resetBtn = optionsPage.getByRole("button", { name: "Reset to defaults" });
  await expect(resetBtn).toBeVisible();
  await resetBtn.click();

  // After reset, locale should be back to "auto" and badge enabled
  await expect(optionsPage.locator("#locale-mode")).toHaveValue("auto");
  await expect(badgeCheckbox).toBeChecked();

  await optionsPage.close();
});
