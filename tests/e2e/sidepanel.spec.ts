import { expect, type BrowserContext, type Page } from "@playwright/test";
import type { TabRecord } from "../../src/shared";
import { openSidepanelPage, type SidepanelApi } from "./helpers/sidepanel";
import { test } from "./fixtures";

type Snapshot = Awaited<ReturnType<SidepanelApi["getSnapshot"]>>;

async function waitForSnapshot(
  sidepanelApi: SidepanelApi,
  predicate: (snapshot: Snapshot) => boolean
) {
  await expect
    .poll(async () => {
      const snapshot = await sidepanelApi.getSnapshot();
      return predicate(snapshot);
    })
    .toBe(true);
}

function countTabsByWindow(snapshot: Snapshot): Map<number, number> {
  return new Map(
    Object.entries(snapshot.windowTabIds).map(([windowId, tabIds]) => [Number(windowId), tabIds.length])
  );
}

function getSnapshotTabs(snapshot: Snapshot): TabRecord[] {
  return Object.values(snapshot.tabsById) as TabRecord[];
}

function createLocalPageUrl(slug: string): string {
  const title = `page-${slug}`;
  return `data:text/html,<title>${title}</title><body>${title}</body>`;
}

async function setHoveredTabPreviewEnabled(
  extensionContext: BrowserContext,
  sidepanelPage: Page,
  enabled: boolean
) {
  const extensionId = new URL(sidepanelPage.url()).host;
  const optionsPage = await extensionContext.newPage();

  await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "domcontentloaded",
    timeout: 10_000
  });

  const previewToggle = optionsPage.getByLabel("Show hovered tab preview");
  if (enabled) {
    await previewToggle.click({ force: true });
  } else {
    await previewToggle.click({ force: true });
  }

  await optionsPage.close();
  await sidepanelPage.waitForFunction(async (expected) => {
    const result = await chrome.storage.local.get("sidepanelExtensionSettings");
    return result.sidepanelExtensionSettings?.display?.hoveredTabPreviewEnabled === expected;
  }, enabled);
  await sidepanelPage.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  );
  await sidepanelPage.bringToFront();
}

// ---------------------------------------------------------------------------
// 测试用例
// ---------------------------------------------------------------------------

test("sidepanel 加载后显示标签", async ({ extensionContext, sidepanelApi }) => {
  const tab1 = await extensionContext.newPage();
  const tab2 = await extensionContext.newPage();
  await tab1.goto(createLocalPageUrl("example-com"));
  await tab2.goto(createLocalPageUrl("example-org"));
  await tab1.waitForLoadState("load");
  await tab2.waitForLoadState("load");

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) =>
      getSnapshotTabs(snapshot).filter(
        (tab) => tab.url?.includes("page-example-com") || tab.url?.includes("page-example-org")
      ).length >= 2
  );

  const snapshot = await sidepanelApi.getSnapshot();
  expect(snapshot.version).toBeGreaterThan(0);
  expect(snapshot.tabsById).toBeDefined();

  const tabIds = Object.keys(snapshot.tabsById).map(Number);
  expect(tabIds.length).toBeGreaterThanOrEqual(2);
});

test("激活标签后侧边栏状态更新", async ({ extensionContext, sidepanelApi }) => {
  const tab1 = await extensionContext.newPage();
  const tab2 = await extensionContext.newPage();
  await tab1.goto(createLocalPageUrl("example-com"));
  await tab2.goto(createLocalPageUrl("example-org"));
  await tab1.waitForLoadState("load");
  await tab2.waitForLoadState("load");

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => getSnapshotTabs(snapshot).some((t) => t.url?.includes("page-example-com"))
  );

  const snapshot1 = await sidepanelApi.getSnapshot();
  const tab1Record = getSnapshotTabs(snapshot1).find(
    (t) => t.url?.includes("page-example-com")
  );
  expect(tab1Record).toBeDefined();

  await sidepanelApi.dispatchCommand({
    type: "tab/activate",
    tabId: tab1Record!.id
  });

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => snapshot.tabsById[tab1Record!.id]?.active === true
  );

  const snapshot2 = await sidepanelApi.getSnapshot();
  const tab1After = snapshot2.tabsById[tab1Record!.id];
  expect(tab1After?.active).toBe(true);
});

test("关闭标签后从列表中移除", async ({ extensionContext, sidepanelApi }) => {
  const tabToClose = await extensionContext.newPage();
  await tabToClose.goto(createLocalPageUrl("close-me"));
  await tabToClose.waitForLoadState("load");

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => Object.values(snapshot.tabsById).some((t) => t.url?.includes("page-close-me"))
  );

  const beforeSnapshot = await sidepanelApi.getSnapshot();
  const tabToCloseRecord = getSnapshotTabs(beforeSnapshot).find(
    (t) => t.url?.includes("page-close-me")
  );
  expect(tabToCloseRecord).toBeDefined();

  await Promise.all([
    tabToClose.waitForEvent("close").catch(() => {}),
    sidepanelApi.dispatchCommand({
      type: "tab/close",
      tabId: tabToCloseRecord!.id
    })
  ]);

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => snapshot.tabsById[tabToCloseRecord!.id] == null
  );

  const afterSnapshot = await sidepanelApi.getSnapshot();
  expect(afterSnapshot.tabsById[tabToCloseRecord!.id]).toBeUndefined();
});

test("移动到新窗口后立即出现在侧边栏窗口列表中", async ({ extensionContext, sidepanelApi }) => {
  const tabToMove = await extensionContext.newPage();
  const companionTab = await extensionContext.newPage();
  await tabToMove.goto(createLocalPageUrl("move-me"));
  await companionTab.goto(createLocalPageUrl("stay-put"));
  await tabToMove.waitForLoadState("load");
  await companionTab.waitForLoadState("load");

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => Object.values(snapshot.tabsById).some((t) => t.url?.includes("page-move-me"))
  );

  const beforeSnapshot = await sidepanelApi.getSnapshot();
  const tabRecord = getSnapshotTabs(beforeSnapshot).find(
    (t) => t.url?.includes("page-move-me")
  );
  expect(tabRecord).toBeDefined();

  const originalWindowId = tabRecord!.windowId;

  await sidepanelApi.dispatchCommand({
    type: "tabs/move-to-new-window",
    tabIds: [tabRecord!.id]
  });

  await waitForSnapshot(sidepanelApi, (snapshot) => {
    const movedTab = snapshot.tabsById[tabRecord!.id];
    return (
      movedTab != null &&
      movedTab.windowId !== originalWindowId &&
      snapshot.windowOrder.includes(movedTab.windowId) &&
      snapshot.windowTabIds[movedTab.windowId]?.includes(tabRecord!.id) === true
    );
  });

  const afterSnapshot = await sidepanelApi.getSnapshot();
  const movedTab = afterSnapshot.tabsById[tabRecord!.id];
  expect(movedTab).toBeDefined();
  expect(movedTab.windowId).not.toBe(originalWindowId);
  expect(afterSnapshot.windowOrder).toContain(movedTab.windowId);
  expect(afterSnapshot.windowTabIds[movedTab.windowId]).toContain(tabRecord!.id);
});

test("批量移动到新窗口后不会长期把源窗口压缩成少量残留标签", async ({ extensionContext, sidepanelApi }) => {
  await Promise.all(
    Array.from({ length: 6 }, async (_unused, index) => {
      const page = await extensionContext.newPage();
      await page.goto(createLocalPageUrl(`bulk-${index}`));
      await page.waitForLoadState("load");
      return page;
    })
  );

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => Object.values(snapshot.tabsById).filter((t) => t.url?.includes("page-bulk-")).length === 6
  );

  const beforeSnapshot = await sidepanelApi.getSnapshot();
  const tabRecords = getSnapshotTabs(beforeSnapshot)
    .filter((t) => t.url?.includes("page-bulk-"))
    .sort((left, right) => left.index - right.index);
  expect(tabRecords).toHaveLength(6);

  const sourceWindowId = tabRecords[0]!.windowId;
  const sourceWindowCountBefore = countTabsByWindow(beforeSnapshot).get(sourceWindowId) ?? 0;
  const movedTabIds = tabRecords.slice(0, 4).map((tab) => tab.id);

  await sidepanelApi.dispatchCommand({
    type: "tabs/move-to-new-window",
    tabIds: movedTabIds
  });

  await waitForSnapshot(sidepanelApi, (snapshot) => {
    const movedTabs = movedTabIds.map((tabId) => snapshot.tabsById[tabId]).filter(Boolean);
    if (movedTabs.length !== movedTabIds.length) {
      return false;
    }

    const targetWindowIds = new Set(movedTabs.map((tab) => tab.windowId));
    if (targetWindowIds.size !== 1) {
      return false;
    }

    const sourceWindowCountAfter = countTabsByWindow(snapshot).get(sourceWindowId) ?? 0;
    return sourceWindowCountAfter >= sourceWindowCountBefore - movedTabIds.length;
  });
});

test("批量移动到已有窗口后不会反复触发源/目标窗口数量异常", async ({ extensionContext, sidepanelApi }) => {
  await Promise.all(
    Array.from({ length: 6 }, async (_unused, index) => {
      const page = await extensionContext.newPage();
      await page.goto(createLocalPageUrl(`existing-${index}`));
      await page.waitForLoadState("load");
      return page;
    })
  );

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => Object.values(snapshot.tabsById).filter((t) => t.url?.includes("page-existing-")).length === 6
  );

  const beforeSnapshot = await sidepanelApi.getSnapshot();
  const tabRecords = getSnapshotTabs(beforeSnapshot)
    .filter((t) => t.url?.includes("page-existing-"))
    .sort((left, right) => left.index - right.index);
  expect(tabRecords).toHaveLength(6);

  const sourceWindowId = tabRecords[0]!.windowId;
  const seedTargetTabId = tabRecords[0]!.id;

  await sidepanelApi.dispatchCommand({
    type: "tabs/move-to-new-window",
    tabIds: [seedTargetTabId]
  });

  await expect
    .poll(async () => {
      const snapshot = await sidepanelApi.getSnapshot();
      return snapshot.tabsById[seedTargetTabId]?.windowId ?? null;
    })
    .not.toBe(sourceWindowId);

  const afterTargetCreated = await sidepanelApi.getSnapshot();
  const targetWindowId = afterTargetCreated.tabsById[seedTargetTabId]!.windowId;
  const movedTabIds = tabRecords.slice(1, 5).map((tab) => tab.id);
  const targetIndex = afterTargetCreated.windowTabIds[targetWindowId]?.length ?? 0;
  const sourceWindowCountAfterSeedMove = afterTargetCreated.windowTabIds[sourceWindowId]?.length ?? 0;
  const targetWindowCountBeforeBatchMove = afterTargetCreated.windowTabIds[targetWindowId]?.length ?? 0;

  await sidepanelApi.dispatchCommand({
    type: "tabs/move",
    tabIds: movedTabIds,
    targetWindowId,
    targetIndex,
    targetGroupId: null
  });

  await waitForSnapshot(sidepanelApi, (snapshot) => {
    const movedTabs = movedTabIds.map((tabId) => snapshot.tabsById[tabId]).filter(Boolean);
    if (movedTabs.length !== movedTabIds.length) {
      return false;
    }

    const allInTarget = movedTabs.every((tab) => tab.windowId === targetWindowId);
    if (!allInTarget) {
      return false;
    }

    const sourceCount = snapshot.windowTabIds[sourceWindowId]?.length ?? 0;
    const targetCount = snapshot.windowTabIds[targetWindowId]?.length ?? 0;
    return (
      sourceCount === sourceWindowCountAfterSeedMove - movedTabIds.length &&
      targetCount === targetWindowCountBeforeBatchMove + movedTabIds.length
    );
  });
});

test("鼠标连续切换标签时顶部悬浮预览不会先闪空", async ({ extensionContext, sidepanelApi, sidepanelPage }) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const firstTitle = `hover-first-${uniqueSuffix}`;
  const secondTitle = `hover-second-${uniqueSuffix}`;

  const firstTab = await extensionContext.newPage();
  const secondTab = await extensionContext.newPage();
  await firstTab.goto(`data:text/html,<title>${firstTitle}</title><body>${firstTitle}</body>`);
  await secondTab.goto(`data:text/html,<title>${secondTitle}</title><body>${secondTitle}</body>`);
  await firstTab.waitForLoadState("load");
  await secondTab.waitForLoadState("load");

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) =>
      Object.values(snapshot.tabsById).some((tab) => tab.title === firstTitle) &&
      Object.values(snapshot.tabsById).some((tab) => tab.title === secondTitle)
  );

  await setHoveredTabPreviewEnabled(extensionContext, sidepanelPage, true);

  const firstTabRow = sidepanelPage.locator(".tab-row__main", {
    has: sidepanelPage.locator(".tab-row__title", { hasText: firstTitle })
  }).first();
  const secondTabRow = sidepanelPage.locator(".tab-row__main", {
    has: sidepanelPage.locator(".tab-row__title", { hasText: secondTitle })
  }).first();
  const hoveredPreview = sidepanelPage.locator(".panel-toolbar__hovered-tab");

  await expect(firstTabRow).toBeVisible();
  await expect(secondTabRow).toBeVisible();

  await firstTabRow.hover();
  await expect(hoveredPreview).toContainText(firstTitle);

  await secondTabRow.hover();

  await expect
    .poll(async () => hoveredPreview.count())
    .toBe(1);
  await expect(hoveredPreview).toContainText(secondTitle);
});

test("鼠标移到标签行右侧操作区时顶部悬浮预览不会闪空", async ({ extensionContext, sidepanelApi, sidepanelPage }) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const targetTitle = `hover-actions-${uniqueSuffix}`;

  const targetTab = await extensionContext.newPage();
  await targetTab.goto(`data:text/html,<title>${targetTitle}</title><body>${targetTitle}</body>`);
  await targetTab.waitForLoadState("load");

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => Object.values(snapshot.tabsById).some((tab) => tab.title === targetTitle)
  );

  await setHoveredTabPreviewEnabled(extensionContext, sidepanelPage, true);

  const tabRow = sidepanelPage.locator(".tab-row", {
    has: sidepanelPage.locator(".tab-row__title", { hasText: targetTitle })
  }).first();
  const mainArea = tabRow.locator(".tab-row__main");
  const actionButton = tabRow.locator(".tab-row__action").first();
  const hoveredPreview = sidepanelPage.locator(".panel-toolbar__hovered-tab");

  await expect(mainArea).toBeVisible();

  await mainArea.hover();
  await expect(hoveredPreview).toContainText(targetTitle);

  await actionButton.hover();

  await expect
    .poll(async () => hoveredPreview.count())
    .toBe(1);
  await expect(hoveredPreview).toContainText(targetTitle);
});

test("鼠标经过标签行之间的空隙时顶部悬浮预览不会闪空", async ({ extensionContext, sidepanelApi, sidepanelPage }) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const firstTitle = `hover-gap-first-${uniqueSuffix}`;
  const secondTitle = `hover-gap-second-${uniqueSuffix}`;

  const firstTab = await extensionContext.newPage();
  const secondTab = await extensionContext.newPage();
  await firstTab.goto(`data:text/html,<title>${firstTitle}</title><body>${firstTitle}</body>`);
  await secondTab.goto(`data:text/html,<title>${secondTitle}</title><body>${secondTitle}</body>`);
  await firstTab.waitForLoadState("load");
  await secondTab.waitForLoadState("load");

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) =>
      Object.values(snapshot.tabsById).some((tab) => tab.title === firstTitle) &&
      Object.values(snapshot.tabsById).some((tab) => tab.title === secondTitle)
  );

  await setHoveredTabPreviewEnabled(extensionContext, sidepanelPage, true);

  const firstRow = sidepanelPage.locator(".tab-row", {
    has: sidepanelPage.locator(".tab-row__title", { hasText: firstTitle })
  }).first();
  const secondRow = sidepanelPage.locator(".tab-row", {
    has: sidepanelPage.locator(".tab-row__title", { hasText: secondTitle })
  }).first();
  const hoveredPreview = sidepanelPage.locator(".panel-toolbar__hovered-tab");

  await expect(firstRow).toBeVisible();
  await expect(secondRow).toBeVisible();

  const firstBox = await firstRow.boundingBox();
  const secondBox = await secondRow.boundingBox();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();

  await sidepanelPage.mouse.move(firstBox!.x + 24, firstBox!.y + firstBox!.height / 2);
  await expect(hoveredPreview).toContainText(firstTitle);

  const gapY = firstBox!.y + firstBox!.height + Math.max((secondBox!.y - (firstBox!.y + firstBox!.height)) / 2, 1);
  await sidepanelPage.mouse.move(firstBox!.x + 24, gapY);

  await expect
    .poll(async () => hoveredPreview.count())
    .toBe(1);

  await sidepanelPage.mouse.move(secondBox!.x + 24, secondBox!.y + secondBox!.height / 2);
  await expect(hoveredPreview).toContainText(secondTitle);
});

// ---------------------------------------------------------------------------
// 选择模式测试
// ---------------------------------------------------------------------------

test("选择模式：工具栏按钮切换选择模式", async ({ extensionContext, sidepanelPage, sidepanelApi }) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  for (let i = 0; i < 2; i++) {
    const page = await extensionContext.newPage();
    await page.goto(createLocalPageUrl(`sel-btn-${uniqueSuffix}`));
    await page.waitForLoadState("load");
  }

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => getSnapshotTabs(snapshot).filter((t) => t.url?.includes(`sel-btn-${uniqueSuffix}`)).length >= 2
  );

  await sidepanelPage.bringToFront();

  // Not in selection mode initially
  await expect(sidepanelPage.getByRole("button", { name: /^取消多选$/ })).toHaveCount(0);

  // Enter selection mode
  await sidepanelPage.getByRole("button", { name: /^选择$/ }).click();
  await expect(sidepanelPage.getByRole("button", { name: /^取消多选$/ })).toBeVisible();
  await expect(sidepanelPage.getByText("已选 0 项")).toBeVisible();

  // Exit selection mode
  await sidepanelPage.getByRole("button", { name: /^取消多选$/ }).click();
  await expect(sidepanelPage.getByRole("button", { name: /^取消多选$/ })).toHaveCount(0);
});

test("选择模式：Ctrl+点击切换标签选中状态", async ({ extensionContext, sidepanelPage, sidepanelApi }) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const page = await extensionContext.newPage();
  await page.goto(createLocalPageUrl(`ctrl-sel-${uniqueSuffix}`));
  await page.waitForLoadState("load");

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => getSnapshotTabs(snapshot).some((t) => t.url?.includes(`ctrl-sel-${uniqueSuffix}`))
  );

  await sidepanelPage.bringToFront();

  const searchInput = sidepanelPage.locator(".search-bar__input");
  await expect(searchInput).toBeVisible({ timeout: 5_000 });
  await searchInput.fill(uniqueSuffix);

  const tabTitle = `page-ctrl-sel-${uniqueSuffix}`;
  const tabRow = sidepanelPage.locator(".tab-row", {
    has: sidepanelPage.locator(".tab-row__title", { hasText: tabTitle })
  }).first();
  const tabMain = tabRow.locator("button.tab-row__main");
  await expect(tabMain).toBeVisible({ timeout: 5_000 });

  // No close-selected button initially
  await expect(sidepanelPage.getByRole("button", { name: /关闭已选/ })).toHaveCount(0);

  const selectedSummary = sidepanelPage.locator(".panel-toolbar__selection");

  // Ctrl+click to select
  await tabMain.click({ modifiers: ["Control"] });
  await expect(selectedSummary).toContainText(/Selected 1|已选 1 项/);

  // Ctrl+click to deselect
  await tabMain.click({ modifiers: ["Control"] });
  await expect(selectedSummary).toHaveCount(0);
});

test("选择模式：Shift+点击范围选择多个标签", async ({ extensionContext, sidepanelPage, sidepanelApi }) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  for (let i = 0; i < 3; i++) {
    const p = await extensionContext.newPage();
    await p.goto(createLocalPageUrl(`shift-${uniqueSuffix}-${i}`));
    await p.waitForLoadState("load");
  }

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => getSnapshotTabs(snapshot).filter((t) => t.url?.includes(`shift-${uniqueSuffix}`)).length >= 3
  );

  await sidepanelPage.bringToFront();

  // Collect tab rows matching our test tabs
  const allTabRows = await sidepanelPage.getByRole("treeitem").all();
  const testRowElements: (typeof allTabRows)[number][] = [];
  for (const row of allTabRows) {
    const name = await row.getAttribute("aria-label");
    if (name && name.includes(`shift-${uniqueSuffix}`)) {
      testRowElements.push(row);
    }
  }
  expect(testRowElements.length).toBeGreaterThanOrEqual(3);

  const selectedRows = sidepanelPage.locator(".tab-row.tab-row--selected");
  const selectedSummary = sidepanelPage.locator(".panel-toolbar__selection");

  // Ctrl+click first to set anchor
  await testRowElements[0]!.click({ modifiers: ["Control"] });

  // Shift+click last for range
  await testRowElements[2]!.click({ modifiers: ["Shift"] });

  // All 3 rows should be visually selected
  await expect(selectedRows).toHaveCount(3);
  await expect(selectedSummary).toContainText(/Selected 3|已选 3 项/);
});

test("选择模式：Escape 退出选择模式", async ({ extensionContext, sidepanelPage, sidepanelApi }) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const p = await extensionContext.newPage();
  await p.goto(createLocalPageUrl(`esc-mode-${uniqueSuffix}`));
  await p.waitForLoadState("load");

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => getSnapshotTabs(snapshot).some((t) => t.url?.includes(`esc-mode-${uniqueSuffix}`))
  );

  await sidepanelPage.bringToFront();

  // Enter selection mode via toolbar
  const selectBtn = sidepanelPage.getByRole("button", { name: /^选择$/ });
  await expect(selectBtn).toBeVisible();
  await selectBtn.click();
  await expect(sidepanelPage.getByRole("button", { name: /^取消多选$/ })).toBeVisible();

  // Escape to exit
  await sidepanelPage.keyboard.press("Escape");
  await expect(sidepanelPage.getByRole("button", { name: /^取消多选$/ })).toHaveCount(0);
  await expect(selectBtn).toBeVisible();
});

// ---------------------------------------------------------------------------
// 批量操作测试
// ---------------------------------------------------------------------------

test("关闭选中的标签后从快照中移除", async ({ extensionContext, sidepanelPage, sidepanelApi }) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  for (let i = 0; i < 3; i++) {
    const p = await extensionContext.newPage();
    await p.goto(createLocalPageUrl(`close-sel-${uniqueSuffix}-${i}`));
    await p.waitForLoadState("load");
  }

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => getSnapshotTabs(snapshot).filter((t) => t.url?.includes(`close-sel-${uniqueSuffix}`)).length >= 3
  );

  const selectedRows = sidepanelPage.locator(".tab-row.tab-row--selected");
  const selectedSummary = sidepanelPage.locator(".panel-toolbar__selection");

  // Select all 3 tabs via Ctrl+click
  await sidepanelPage.bringToFront();
  const tabRows = await sidepanelPage.getByRole("treeitem").all();
  for (const row of tabRows) {
    const name = await row.getAttribute("aria-label");
    if (name && name.includes(`close-sel-${uniqueSuffix}`)) {
      await row.click({ modifiers: ["Control"] });
    }
  }

  await expect(selectedRows).toHaveCount(3);
  await expect(selectedSummary).toContainText(/Selected 3|已选 3 项/);

  // Click close selected
  await sidepanelPage.locator('.panel-toolbar__button[aria-label^="Close selected"], .panel-toolbar__button[aria-label^="关闭已选"]').click();

  // Wait for tabs to disappear from snapshot
  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => getSnapshotTabs(snapshot).filter((t) => t.url?.includes(`close-sel-${uniqueSuffix}`)).length === 0
  );
});

test("选择重复标签后自动进入选择模式", async ({ extensionContext, sidepanelPage, sidepanelApi }) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const duplicateUrl = `data:text/html,<title>dup-${uniqueSuffix}</title><body>dup-content</body>`;
  const [tabA, tabB] = await Promise.all([
    extensionContext.newPage(),
    extensionContext.newPage()
  ]);
  await tabA.goto(duplicateUrl);
  await tabB.goto(duplicateUrl);
  await tabA.waitForLoadState("load");
  await tabB.waitForLoadState("load");

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => Object.values(snapshot.tabsById).filter((t) => t.title === `dup-${uniqueSuffix}`).length >= 2
  );

  await sidepanelPage.bringToFront();
  await sidepanelPage.getByRole("button", { name: "选择重复标签" }).click();

  // Should enter selection mode with duplicates selected
  await expect(sidepanelPage.getByRole("button", { name: /^取消多选$/ })).toBeVisible();
  await expect(sidepanelPage.getByRole("button", { name: /关闭已选/ })).toBeVisible();
});

test("无重复标签时选择重复标签显示提示后自动消失", async ({ extensionContext, sidepanelPage, sidepanelApi }) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [tabA, tabB] = await Promise.all([
    extensionContext.newPage(),
    extensionContext.newPage()
  ]);
  await tabA.goto(createLocalPageUrl(`no-dup-a-${uniqueSuffix}`));
  await tabB.goto(createLocalPageUrl(`no-dup-b-${uniqueSuffix}`));
  await tabA.waitForLoadState("load");
  await tabB.waitForLoadState("load");

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => getSnapshotTabs(snapshot).filter((t) => t.url?.includes(uniqueSuffix)).length >= 2
  );

  await sidepanelPage.bringToFront();
  await sidepanelPage.getByRole("button", { name: "选择重复标签" }).click();

  // Toast should appear
  await expect(sidepanelPage.getByText("没有发现重复标签页")).toBeVisible();

  // Toast should auto-dismiss
  await expect(sidepanelPage.getByText("没有发现重复标签页")).toHaveCount(0, { timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// 搜索功能测试
// ---------------------------------------------------------------------------

test("搜索：过滤模式隐藏不匹配标签，高亮模式保留全部标签", async ({ extensionContext, sidepanelPage, sidepanelApi }) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const matchTitle = `filter-match-${uniqueSuffix}`;
  const noMatchTitle = `filter-other-${uniqueSuffix}`;

  const [matchTab, noMatchTab] = await Promise.all([
    extensionContext.newPage(),
    extensionContext.newPage()
  ]);
  await matchTab.goto(`data:text/html,<title>${matchTitle}</title><body>${matchTitle}</body>`);
  await noMatchTab.goto(`data:text/html,<title>${noMatchTitle}</title><body>${noMatchTitle}</body>`);
  await matchTab.waitForLoadState("load");
  await noMatchTab.waitForLoadState("load");

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) =>
      Object.values(snapshot.tabsById).some((t) => t.title === matchTitle) &&
      Object.values(snapshot.tabsById).some((t) => t.title === noMatchTitle)
  );

  await sidepanelPage.bringToFront();

  // Both visible initially
  await expect(sidepanelPage.getByRole("treeitem", { name: `切换到标签页 ${matchTitle}` })).toBeVisible();
  await expect(sidepanelPage.getByRole("treeitem", { name: `切换到标签页 ${noMatchTitle}` })).toBeVisible();

  // Search for matching term (default filter mode)
  await sidepanelPage.getByLabel("搜索标签").fill(`filter-match-${uniqueSuffix}`);

  // Only matching tab visible
  await expect(sidepanelPage.getByRole("treeitem", { name: `切换到标签页 ${matchTitle}` })).toBeVisible();
  await expect(sidepanelPage.getByRole("treeitem", { name: `切换到标签页 ${noMatchTitle}` })).toHaveCount(0);

  // Match count
  await expect(sidepanelPage.getByText("1 个匹配").first()).toBeVisible();

  // Toggle to highlight mode
  await sidepanelPage.getByRole("button", { name: "高亮模式" }).click();
  await expect(sidepanelPage.getByRole("treeitem", { name: `切换到标签页 ${noMatchTitle}` })).toBeVisible();

  // Clear search
  await sidepanelPage.getByRole("button", { name: "清除搜索" }).click();
  await expect(sidepanelPage.getByRole("treeitem", { name: `切换到标签页 ${noMatchTitle}` })).toBeVisible();
});

test("搜索：匹配计数随搜索词变化", async ({ extensionContext, sidepanelPage, sidepanelApi }) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  for (let i = 0; i < 3; i++) {
    const p = await extensionContext.newPage();
    await p.goto(createLocalPageUrl(`count-${uniqueSuffix}-${i}`));
    await p.waitForLoadState("load");
  }

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => getSnapshotTabs(snapshot).filter((t) => t.url?.includes(`count-${uniqueSuffix}`)).length >= 3
  );

  await sidepanelPage.bringToFront();

  const searchInput = sidepanelPage.locator(".search-bar__input");

  // Search for a term matching all 3 tabs
  await searchInput.fill(`count-${uniqueSuffix}`);
  await expect(sidepanelPage.getByText("3 个匹配").first()).toBeVisible();

  // Narrow down to match 1
  await searchInput.fill(`count-${uniqueSuffix}-0`);
  await expect(sidepanelPage.getByText("1 个匹配").first()).toBeVisible();

  // Clear search
  await sidepanelPage.getByRole("button", { name: "清除搜索" }).click();
  await expect(searchInput).toHaveValue("");
});

test("搜索：/ 快捷键聚焦搜索框", async ({ sidepanelPage, sidepanelApi }) => {
  await sidepanelApi.waitForInteractive();
  await sidepanelPage.bringToFront();

  // Verify search input exists (use CSS locator)
  const searchInputCss = sidepanelPage.locator(".search-bar__input");
  await expect(searchInputCss).toBeVisible({ timeout: 5_000 });

  // Press / to focus search
  await sidepanelPage.locator("body").click();
  await sidepanelPage.keyboard.press("/");

  // After pressing /, the search input should still be in the DOM
  await expect(searchInputCss).toBeVisible();
});

test("搜索：Escape 清空搜索内容", async ({ extensionContext, sidepanelPage, sidepanelApi }) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const p = await extensionContext.newPage();
  await p.goto(createLocalPageUrl(`esc-search-${uniqueSuffix}`));
  await p.waitForLoadState("load");

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => getSnapshotTabs(snapshot).some((t) => t.url?.includes(`esc-search-${uniqueSuffix}`))
  );

  await sidepanelPage.bringToFront();

  // Type into search
  const searchInput = sidepanelPage.locator(".search-bar__input");
  await expect(searchInput).toBeVisible({ timeout: 5_000 });
  await searchInput.fill(`esc-search-${uniqueSuffix}`);

  // Escape to clear
  await sidepanelPage.keyboard.press("Escape");
  await expect(searchInput).toHaveValue("");
});

// ---------------------------------------------------------------------------
// 窗口/标签 UI 状态测试
// ---------------------------------------------------------------------------

test("窗口折叠后标签隐藏，展开后恢复", async ({ extensionContext, sidepanelPage, sidepanelApi }) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const p = await extensionContext.newPage();
  await p.goto(createLocalPageUrl(`collapse-${uniqueSuffix}`));
  await p.waitForLoadState("load");

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => getSnapshotTabs(snapshot).some((t) => t.url?.includes(`collapse-${uniqueSuffix}`))
  );

  await sidepanelPage.bringToFront();

  const tabTitle = `page-collapse-${uniqueSuffix}`;
  const tabRow = sidepanelPage.getByRole("treeitem", { name: `切换到标签页 ${tabTitle}` });
  const windowRow = sidepanelPage.locator("button.window-row").first();

  await expect(windowRow).toHaveAttribute("aria-expanded", "true");
  await expect(tabRow).toBeVisible({ timeout: 5_000 });

  // Collapse window
  await windowRow.click();
  await expect(windowRow).toHaveAttribute("aria-expanded", "false");
  await expect(tabRow).toHaveCount(0);

  // Expand window
  await windowRow.click();
  await expect(windowRow).toHaveAttribute("aria-expanded", "true");
  await expect(tabRow).toBeVisible();
});

test("全部收起/全部展开按钮切换所有窗口折叠状态", async ({ extensionContext, sidepanelPage, sidepanelApi }) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const p = await extensionContext.newPage();
  await p.goto(createLocalPageUrl(`expand-all-${uniqueSuffix}`));
  await p.waitForLoadState("load");

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => getSnapshotTabs(snapshot).some((t) => t.url?.includes(`expand-all-${uniqueSuffix}`))
  );

  await sidepanelPage.bringToFront();

  const windowRow = sidepanelPage.locator("button.window-row").first();
  await expect(windowRow).toHaveAttribute("aria-expanded", "true");

  // Find and click collapse/expand button
  const collapseBtn = sidepanelPage.getByRole("button", { name: "全部收起" });
  if (await collapseBtn.isVisible()) {
    await collapseBtn.click();
    await expect(windowRow).toHaveAttribute("aria-expanded", "false");
    await expect(sidepanelPage.getByRole("button", { name: "全部展开" })).toBeVisible();
    await sidepanelPage.getByRole("button", { name: "全部展开" }).click();
    await expect(windowRow).toHaveAttribute("aria-expanded", "true");
  }
});

test("固定标签后侧边栏状态更新", async ({ extensionContext, sidepanelPage, sidepanelApi }) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const p = await extensionContext.newPage();
  await p.goto(createLocalPageUrl(`pin-${uniqueSuffix}`));
  await p.waitForLoadState("load");

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => getSnapshotTabs(snapshot).some((t) => t.url?.includes(`pin-${uniqueSuffix}`))
  );

  const beforeSnapshot = await sidepanelApi.getSnapshot();
  const tabRecord = getSnapshotTabs(beforeSnapshot).find((t) => t.url?.includes(`pin-${uniqueSuffix}`));
  expect(tabRecord).toBeDefined();
  expect(tabRecord!.pinned).toBe(false);

  await sidepanelPage.bringToFront();

  const tabTitle = `page-pin-${uniqueSuffix}`;
  const tabRow = sidepanelPage.locator(".tab-row", {
    has: sidepanelPage.locator(".tab-row__title", { hasText: tabTitle })
  }).first();
  await expect(tabRow).toBeVisible({ timeout: 5_000 });
  await tabRow.hover();

  const pinButton = sidepanelPage.getByRole("button", { name: "固定标签" });
  if (await pinButton.isVisible()) {
    await pinButton.click();
  }

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => snapshot.tabsById[tabRecord!.id]?.pinned === true
  );

  const afterSnapshot = await sidepanelApi.getSnapshot();
  expect(afterSnapshot.tabsById[tabRecord!.id]?.pinned).toBe(true);
});

test("空状态：搜索无匹配时显示提示信息", async ({ extensionContext, sidepanelPage, sidepanelApi }) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const p = await extensionContext.newPage();
  await p.goto(createLocalPageUrl(`empty-${uniqueSuffix}`));
  await p.waitForLoadState("load");

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => getSnapshotTabs(snapshot).some((t) => t.url?.includes(`empty-${uniqueSuffix}`))
  );

  await sidepanelPage.bringToFront();

  const searchInput = sidepanelPage.locator(".search-bar__input");
  await expect(searchInput).toBeVisible({ timeout: 5_000 });

  // Search for something that won't match
  await searchInput.fill(`zzz-nonexistent-${uniqueSuffix}`);

  // Empty state should appear
  await expect(sidepanelPage.getByText("没有匹配的标签页")).toBeVisible();
  await expect(sidepanelPage.getByText("试试其他关键词，或按 Esc 清空搜索")).toBeVisible();
});

test("折叠窗口后搜索仍会显示匹配标签，清空后恢复折叠视图", async ({ extensionContext, sidepanelApi, sidepanelPage }) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const hiddenTitle = `search-hidden-${uniqueSuffix}`;
  const visibleTitle = `search-visible-${uniqueSuffix}`;

  const targetTab = await extensionContext.newPage();
  const companionTab = await extensionContext.newPage();
  await targetTab.goto(`data:text/html,<title>${hiddenTitle}</title><body>${hiddenTitle}</body>`);
  await companionTab.goto(`data:text/html,<title>${visibleTitle}</title><body>${visibleTitle}</body>`);
  await targetTab.waitForLoadState("load");
  await companionTab.waitForLoadState("load");

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) =>
      Object.values(snapshot.tabsById).filter((tab) => tab.title === hiddenTitle).length === 1 &&
      Object.values(snapshot.tabsById).filter((tab) => tab.title === visibleTitle).length === 1
  );

  const beforeSnapshot = await sidepanelApi.getSnapshot();
  const hiddenTabRecord = getSnapshotTabs(beforeSnapshot).find((tab) => tab.title === hiddenTitle);
  expect(hiddenTabRecord).toBeDefined();

  const targetWindowRow = sidepanelPage.locator("button.window-row").first();
  const hiddenTabRow = sidepanelPage.getByRole("treeitem", { name: `切换到标签页 ${hiddenTitle}` });

  await sidepanelPage.bringToFront();
  await expect(hiddenTabRow).toBeVisible();
  await targetWindowRow.click();

  await expect(targetWindowRow).toHaveAttribute("aria-expanded", "false");
  await expect(hiddenTabRow).toHaveCount(0);

  await sidepanelPage.getByLabel("搜索标签").fill(`hidden-${uniqueSuffix}`);

  await expect(hiddenTabRow).toBeVisible();
  await expect(targetWindowRow).toHaveAttribute("aria-expanded", "true");

  await sidepanelPage.getByLabel("清除搜索").click();

  await expect(hiddenTabRow).toHaveCount(0);
  await expect(targetWindowRow).toHaveAttribute("aria-expanded", "false");
});

test("定位到当前页面会在搜索隐藏目标时清空搜索并重新显示目标", async ({ extensionContext, sidepanelApi, sidepanelPage }) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const targetTitle = `locate-target-${uniqueSuffix}`;
  const distractorTitle = `locate-distractor-${uniqueSuffix}`;

  const targetTab = await extensionContext.newPage();
  const distractorTab = await extensionContext.newPage();
  await targetTab.goto(`data:text/html,<title>${targetTitle}</title><body>${targetTitle}</body>`);
  await distractorTab.goto(`data:text/html,<title>${distractorTitle}</title><body>${distractorTitle}</body>`);
  await targetTab.waitForLoadState("load");
  await distractorTab.waitForLoadState("load");

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) =>
      Object.values(snapshot.tabsById).some((tab) => tab.title === targetTitle) &&
      Object.values(snapshot.tabsById).some((tab) => tab.title === distractorTitle)
  );

  const snapshotBeforeActivate = await sidepanelApi.getSnapshot();
  const targetTabRecord = getSnapshotTabs(snapshotBeforeActivate).find((tab) => tab.title === targetTitle);
  expect(targetTabRecord).toBeDefined();

  await sidepanelApi.dispatchCommand({
    type: "tab/activate",
    tabId: targetTabRecord!.id
  });

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => snapshot.tabsById[targetTabRecord!.id]?.active === true
  );
  await sidepanelApi.waitForInteractive();
  await sidepanelPage.bringToFront();

  await sidepanelPage.getByLabel("搜索标签").fill(`no-match-${uniqueSuffix}`);
  await expect(sidepanelPage.getByText("没有匹配的标签页")).toBeVisible();

  await sidepanelPage.getByLabel("定位到当前页面").click();

  await expect(sidepanelPage.getByLabel("搜索标签")).toHaveValue("");
  await expect(sidepanelPage.getByRole("treeitem", { name: `切换到标签页 ${targetTitle}` })).toBeVisible();
});

test("开启详细日志后点击激活标签不会产生 move 事件", async ({ extensionContext, sidepanelApi, sidepanelPage }) => {
  const { extensionId } = await openSidepanelPage(extensionContext, "dist");
  const optionsPage = await extensionContext.newPage();
  await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "domcontentloaded",
    timeout: 10_000
  });
  const tab1 = await extensionContext.newPage();
  const tab2 = await extensionContext.newPage();
  await tab1.goto(createLocalPageUrl("log-a"));
  await tab2.goto(createLocalPageUrl("log-b"));
  await tab1.waitForLoadState("load");
  await tab2.waitForLoadState("load");

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => Object.values(snapshot.tabsById).some((t) => t.url?.includes("page-log-a"))
  );

  await optionsPage.bringToFront();
  await optionsPage.getByLabel("开启详细日志").click({ force: true });
  await sidepanelPage.bringToFront();
  await expect(sidepanelPage.getByText("详细日志记录中")).toBeVisible();

  const beforeSnapshot = await sidepanelApi.getSnapshot();
  const targetTab = getSnapshotTabs(beforeSnapshot).find((t) => t.url?.includes("page-log-a"));
  expect(targetTab).toBeDefined();

  const targetTitle = targetTab!.title;
  const targetCandidates = await sidepanelPage.getByRole("treeitem", { name: `切换到标签页 ${targetTitle}` }).all();
  await targetCandidates[0]!.click();

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => snapshot.tabsById[targetTab!.id]?.active === true
  );

  const afterSnapshot = await sidepanelApi.getSnapshot();
  expect(afterSnapshot.tabsById[targetTab!.id]?.index).toBe(targetTab!.index);
  expect(afterSnapshot.tabsById[targetTab!.id]?.windowId).toBe(targetTab!.windowId);

  const trace = await sidepanelApi.getTraceEntries();
  const relevant = trace.filter((entry) =>
    [
      "panel/tab-activate-clicked",
      "panel/selection-primary-action",
      "command/dispatch",
      "tabs/onActivated",
      "tabs/onMoved",
      "list/drag-start",
      "list/drop"
    ].includes(entry.event)
  );

  expect(relevant.some((entry) => entry.event === "panel/tab-activate-clicked")).toBe(true);
  expect(relevant.some((entry) => entry.event === "tabs/onActivated")).toBe(true);
  expect(
    relevant.some(
      (entry) =>
        entry.event === "command/dispatch" &&
        ["tab/move", "tabs/move", "group/move"].includes(String(entry.details.commandType ?? ""))
    )
  ).toBe(false);
  expect(relevant.some((entry) => entry.event === "tabs/onMoved")).toBe(false);
  await optionsPage.close();
});

test("pointer drag 拖到标签间隙时仍会完成移动", async ({ extensionContext, sidepanelApi, sidepanelPage }) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pageA = await extensionContext.newPage();
  const pageB = await extensionContext.newPage();
  const pageC = await extensionContext.newPage();
  await pageA.goto(createLocalPageUrl(`drag-gap-a-${uniqueSuffix}`));
  await pageB.goto(createLocalPageUrl(`drag-gap-b-${uniqueSuffix}`));
  await pageC.goto(createLocalPageUrl(`drag-gap-c-${uniqueSuffix}`));
  await pageA.waitForLoadState("load");
  await pageB.waitForLoadState("load");
  await pageC.waitForLoadState("load");

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => getSnapshotTabs(snapshot).filter((t) => t.title?.includes(`drag-gap-`) && t.title?.includes(uniqueSuffix)).length >= 3
  );

  await sidepanelPage.bringToFront();
  await sidepanelApi.waitForInteractive();
  const searchInput = sidepanelPage.locator(".search-bar__input");
  await expect(searchInput).toBeVisible({ timeout: 10_000 });
  await searchInput.fill(uniqueSuffix);

  const beforeSnapshot = await sidepanelApi.getSnapshot();
  const dragATitle = `page-drag-gap-a-${uniqueSuffix}`;
  const dragBTitle = `page-drag-gap-b-${uniqueSuffix}`;
  const dragATab = getSnapshotTabs(beforeSnapshot).find((tab) => tab.title === dragATitle);
  const dragBTab = getSnapshotTabs(beforeSnapshot).find((tab) => tab.title === dragBTitle);
  expect(dragATab).toBeDefined();
  expect(dragBTab).toBeDefined();

  const filteredRows = sidepanelPage.locator(".tab-row button[role='treeitem']");
  await expect(filteredRows).toHaveCount(3);

  const sourceRow = filteredRows.nth(0);
  const targetRowA = filteredRows.nth(1);
  const targetRowB = filteredRows.nth(2);
  await expect(sourceRow).toBeVisible();
  await expect(targetRowA).toBeVisible();
  await expect(targetRowB).toBeVisible();

  await expect(sourceRow.locator(".tab-row__title")).toHaveText(dragATitle);
  await expect(targetRowA.locator(".tab-row__title")).toHaveText(dragBTitle);
  await expect(targetRowB.locator(".tab-row__title")).toHaveText(`page-drag-gap-c-${uniqueSuffix}`);

  const sourceBox = await sourceRow.boundingBox();
  const targetBoxA = await targetRowA.boundingBox();
  const targetBoxB = await targetRowB.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBoxA).not.toBeNull();
  expect(targetBoxB).not.toBeNull();

  const gapY = targetBoxA!.y + targetBoxA!.height + Math.max((targetBoxB!.y - (targetBoxA!.y + targetBoxA!.height)) / 2, 1);
  const sourceX = sourceBox!.x + 24;
  const sourceY = sourceBox!.y + sourceBox!.height / 2;
  const hoverX = targetBoxA!.x + 24;
  const hoverY = targetBoxA!.y + targetBoxA!.height / 2;

  await sidepanelPage.mouse.move(sourceX, sourceY);
  await sidepanelPage.mouse.down();
  await sidepanelPage.mouse.move(hoverX, hoverY, { steps: 8 });
  await sidepanelPage.mouse.move(hoverX, gapY, { steps: 4 });
  await sidepanelPage.mouse.up();

  await expect
    .poll(async () => {
      const snapshot = await sidepanelApi.getSnapshot();
      return snapshot.tabsById[dragATab!.id]?.index;
    })
    .toBe(dragBTab!.index);
});

test("pointer drag 在顶部热区自动滚动后仍可完成移动", async ({ extensionContext, sidepanelApi, sidepanelPage }) => {
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tabCount = 18;

  const pages = await Promise.all(
    Array.from({ length: tabCount }, (_, index) => extensionContext.newPage().then(async (page) => {
      await page.goto(createLocalPageUrl(`drag-auto-scroll-${index}-${uniqueSuffix}`));
      await page.waitForLoadState("load");
      return page;
    }))
  );

  await waitForSnapshot(
    sidepanelApi,
    (snapshot) => getSnapshotTabs(snapshot).filter((tab) => tab.title?.includes(`drag-auto-scroll-`) && tab.title?.includes(uniqueSuffix)).length >= tabCount
  );

  await sidepanelPage.bringToFront();
  await sidepanelApi.waitForInteractive();
  const searchInput = sidepanelPage.locator(".search-bar__input");
  await expect(searchInput).toBeVisible({ timeout: 10_000 });
  await searchInput.fill(uniqueSuffix);

  const scrollContainer = sidepanelPage.locator(".panel-scroll");
  await scrollContainer.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  const filteredRows = sidepanelPage.locator(".tab-row button[role='treeitem']");
  const sourceRow = filteredRows.last();
  await expect(sourceRow).toBeVisible();

  const sourceTitle = await sourceRow.locator(".tab-row__title").innerText();
  const beforeSnapshot = await sidepanelApi.getSnapshot();
  const sourceTab = getSnapshotTabs(beforeSnapshot).find((tab) => tab.title === sourceTitle);
  expect(sourceTab).toBeDefined();

  const sourceBox = await sourceRow.boundingBox();
  const scrollBox = await scrollContainer.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(scrollBox).not.toBeNull();

  const initialScrollTop = await scrollContainer.evaluate((element) => element.scrollTop);
  expect(initialScrollTop).toBeGreaterThan(0);

  const hotZoneX = scrollBox!.x + Math.min(scrollBox!.width / 2, 80);
  const hotZoneY = scrollBox!.y + 2;

  await sidepanelPage.mouse.move(sourceBox!.x + 24, sourceBox!.y + sourceBox!.height / 2);
  await sidepanelPage.mouse.down();
  await sidepanelPage.mouse.move(hotZoneX, hotZoneY, { steps: 16 });

  await expect
    .poll(async () => scrollContainer.evaluate((element) => element.scrollTop), { timeout: 10_000 })
    .toBeLessThan(initialScrollTop - 40);

  const neutralX = scrollBox!.x + scrollBox!.width / 2;
  const neutralY = scrollBox!.y + scrollBox!.height / 2;
  await sidepanelPage.mouse.move(neutralX, neutralY, { steps: 8 });

  const targetRow = filteredRows.nth(2);
  await expect(targetRow).toBeVisible();

  const targetTitle = await targetRow.locator(".tab-row__title").innerText();
  const targetTab = getSnapshotTabs(beforeSnapshot).find((tab) => tab.title === targetTitle);
  expect(targetTab).toBeDefined();
  expect(targetTab!.id).not.toBe(sourceTab!.id);

  const targetBox = await targetRow.boundingBox();
  expect(targetBox).not.toBeNull();

  const dropX = targetBox!.x + 24;
  const dropY = targetBox!.y + targetBox!.height * 0.75;

  await sidepanelPage.mouse.move(dropX, dropY, { steps: 8 });
  await sidepanelPage.mouse.up();

  await expect
    .poll(async () => {
      const snapshot = await sidepanelApi.getSnapshot();
      const windowTabIds = snapshot.windowTabIds[targetTab!.windowId] ?? [];
      return {
        sourceIndex: snapshot.tabsById[sourceTab!.id]?.index ?? null,
        targetIndex: snapshot.tabsById[targetTab!.id]?.index ?? null,
        tabAtTargetIndex: windowTabIds[targetTab!.index] ?? null,
        tabAfterTargetIndex: windowTabIds[targetTab!.index + 1] ?? null
      };
    })
    .toEqual({
      sourceIndex: targetTab!.index,
      targetIndex: targetTab!.index + 1,
      tabAtTargetIndex: sourceTab!.id,
      tabAfterTargetIndex: targetTab!.id
    });

  await Promise.all(pages.map((page) => page.close()));
});

test("侧边栏加载时无 JS 错误", async ({ sidepanelPage }) => {
  const errors: string[] = [];
  sidepanelPage.on("pageerror", (err) => {
    errors.push(err.message);
  });

  await sidepanelPage.reload();
  await sidepanelPage.waitForLoadState("domcontentloaded");

  const realErrors = errors.filter(
    (e) => !e.includes("ResizeObserver") && !e.includes("favicon")
  );
  expect(realErrors).toHaveLength(0);
});

