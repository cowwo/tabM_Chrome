import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { test } from "./fixtures";
import {
  duplicateValues,
  getSnapshotRecordCount,
  getSnapshotTabRowCount,
  getSnapshotTabTitles,
  killExtensionServiceWorker,
  openTitledTab,
  readPanelState,
  sortedCopy,
  waitForCondition,
  type PanelState
} from "./helpers/ghost";

const CLOSED_TAB_ROUNDS = 3;
const CONVERGE_TIMEOUT_MS = 20_000;

function assertPanelMatchesChrome(state: PanelState, roundLabel: string): void {
  const panelTitles = getSnapshotTabTitles(state.snapshot);
  const liveTitles = state.liveTabs.map((tab) => tab.title);
  const rowCount = getSnapshotTabRowCount(state.snapshot);
  const recordCount = getSnapshotRecordCount(state.snapshot);

  expect(state.snapshot.bootId, `${roundLabel}：快照应携带后台 bootId，实际 ${String(state.snapshot.bootId)}`).toEqual(
    expect.any(String)
  );
  expect(
    rowCount,
    `${roundLabel}：面板标签行数应等于 chrome.tabs.query 真实标签数（实际 ${rowCount}，期望 ${state.liveTabs.length}）`
  ).toBe(state.liveTabs.length);
  expect(
    recordCount,
    `${roundLabel}：面板 TabRecord 数应等于真实标签数（实际 ${recordCount}，期望 ${state.liveTabs.length}）`
  ).toBe(state.liveTabs.length);
  expect(
    duplicateValues(panelTitles),
    `${roundLabel}：面板不应出现重复 title 行（重复行 ${JSON.stringify(duplicateValues(panelTitles))}）`
  ).toEqual([]);
}

test("幽灵回归：强杀 SW + 关闭标签 3 轮后，面板行数始终等于 Chrome 真实标签数且无重复行", async ({
  extensionContext,
  sidepanelPage,
  sidepanelApi
}) => {
  const runId = `ghost-e2e-${Date.now().toString(36)}`;
  const openedTabs: Array<{ page: Page; title: string }> = [];

  for (let index = 0; index < CLOSED_TAB_ROUNDS; index += 1) {
    const title = `${runId}-${index}`;
    openedTabs.push({ page: await openTitledTab(extensionContext, title), title });
  }

  // 等面板（后台 store）收录全部测试标签，避免在快照还没同步时就开始杀 SW
  await waitForCondition({
    read: () => sidepanelApi.getSnapshot(),
    isReady: (snapshot) => openedTabs.every((tab) => getSnapshotTabTitles(snapshot).includes(tab.title)),
    message: `面板未在 15s 内收录全部测试标签（期望标题 ${openedTabs.map((tab) => tab.title).join(", ")}）`
  });

  const initialSnapshot = await sidepanelApi.getSnapshot();
  let previousBootId = initialSnapshot.bootId;
  expect(initialSnapshot.bootId, "初始面板快照应携带后台 bootId").toEqual(expect.any(String));

  for (let round = 0; round < CLOSED_TAB_ROUNDS; round += 1) {
    const closingTab = openedTabs[round];
    const roundLabel = `第 ${round + 1}/${CLOSED_TAB_ROUNDS} 轮`;

    // 1) 强杀扩展 Service Worker（修复前这里会让后台 version 归 1，面板随后拒收新快照）
    const killedTargets = await killExtensionServiceWorker(extensionContext);
    expect(killedTargets, `${roundLabel}：应强杀到至少 1 个扩展 Service Worker，实际 ${killedTargets}`).toBeGreaterThan(0);

    // 2) 在 SW 离线/重连窗口内关闭一个标签（修复前该行会永久留在面板里变成幽灵行）
    await closingTab.page.close();

    // 3) 轮询等面板收敛：bootId 换新 + 行数/标题与 Chrome 一致
    const state = await waitForCondition({
      read: () => readPanelState(sidepanelApi, sidepanelPage),
      isReady: (value) =>
        value.snapshot.bootId !== previousBootId &&
        getSnapshotTabRowCount(value.snapshot) === value.liveTabs.length &&
        getSnapshotRecordCount(value.snapshot) === value.liveTabs.length,
      timeoutMs: CONVERGE_TIMEOUT_MS,
      message:
        `${roundLabel}：杀 SW + 关闭标签后，面板未在 ${CONVERGE_TIMEOUT_MS}ms 内与 Chrome 收敛（需要 bootId 换新且行数=真实标签数）` +
        "；若失败请检查上方迭代抛出的实际值"
    });

    assertPanelMatchesChrome(state, roundLabel);
    expect(state.snapshot.bootId, `${roundLabel}：杀 SW 后面板快照的 bootId 应更新`).not.toBe(previousBootId);

    const panelRunTitles = sortedCopy(getSnapshotTabTitles(state.snapshot).filter((title) => title.includes(runId)));
    const liveRunTitles = sortedCopy(state.liveTabs.map((tab) => tab.title).filter((title) => title.includes(runId)));
    expect(
      panelRunTitles,
      `${roundLabel}：已关闭标签的幽灵行不应残留（面板测试行 ${JSON.stringify(panelRunTitles)}，Chrome 实际 ${JSON.stringify(liveRunTitles)}）`
    ).toEqual(liveRunTitles);
    expect(panelRunTitles, `${roundLabel}：本轮关闭的标签 "${closingTab.title}" 不应再出现在面板`).not.toContain(
      closingTab.title
    );

    previousBootId = state.snapshot.bootId;
  }
});

test("杀 SW 后面板最终快照收敛：bootId 更新为后台新启动周期且行数=真实标签数", async ({
  extensionContext,
  sidepanelPage,
  sidepanelApi
}) => {
  const title = `ghost-boot-${Date.now().toString(36)}`;
  const page = await openTitledTab(extensionContext, title);

  try {
    await waitForCondition({
      read: () => sidepanelApi.getSnapshot(),
      isReady: (snapshot) => getSnapshotTabTitles(snapshot).includes(title),
      message: `面板未在 15s 内收录测试标签 "${title}"`
    });

    const before = await sidepanelApi.getSnapshot();
    expect(before.bootId, "杀 SW 前快照应携带 bootId").toEqual(expect.any(String));

    const killedTargets = await killExtensionServiceWorker(extensionContext);
    expect(killedTargets, `应强杀到至少 1 个扩展 Service Worker，实际 ${killedTargets}`).toBeGreaterThan(0);

    const after = await waitForCondition({
      read: () => readPanelState(sidepanelApi, sidepanelPage),
      isReady: (value) =>
        value.snapshot.bootId !== before.bootId &&
        getSnapshotTabRowCount(value.snapshot) === value.liveTabs.length,
      timeoutMs: CONVERGE_TIMEOUT_MS,
      message: `杀 SW 后面板快照未在 ${CONVERGE_TIMEOUT_MS}ms 内换成新 bootId 且行数=真实标签数`
    });

    expect(after.snapshot.bootId, "杀 SW 后面板快照 bootId 应更新（后台换了启动周期）").not.toBe(before.bootId);
    expect(after.snapshot.bootId, "新快照仍应携带非空 bootId").toEqual(expect.any(String));
    assertPanelMatchesChrome(after, "杀 SW 后收敛");
  } finally {
    await page.close();
  }
});
