import { createLocalizedText, getRuntimeLocale, translateText } from "../shared/i18n";
import type { TabCommand } from "../shared/types";

export interface CommandExecutorChromeApi {
  tabs: {
    get(tabId: number): Promise<{
      id?: number;
      windowId: number;
      index?: number;
      groupId?: number;
      pinned?: boolean;
    }>;
    move(
      tabIds: number | number[],
      moveProperties: {
        windowId?: number;
        index: number;
      }
    ): Promise<unknown>;
    group(groupOptions: {
      groupId?: number;
      createProperties?: {
        windowId?: number;
      };
      tabIds: number | number[];
    }): Promise<number>;
    ungroup(tabIds: number | number[]): Promise<void>;
    update(
      tabId: number,
      updateProperties: {
        active?: boolean;
        pinned?: boolean;
      }
    ): Promise<unknown>;
    remove(tabIds: number | number[]): Promise<void>;
    create(properties: {
      url?: string;
      active?: boolean;
      windowId?: number;
      index?: number;
    }): Promise<{
      id?: number;
      windowId?: number;
      index?: number;
      pinned?: boolean;
      active?: boolean;
    }>;
  };
  windows: {
    update(
      windowId: number,
      updateInfo: {
        focused: boolean;
      }
    ): Promise<{
      id?: number;
      focused?: boolean;
    }>;
    remove(windowId: number): Promise<void>;
    create(options?: {
      url?: string;
      focused?: boolean;
      incognito?: boolean;
    }): Promise<{
      id?: number;
      focused?: boolean;
    }>;
  };
  tabGroups: {
    get(groupId: number): Promise<{
      id: number;
      collapsed: boolean;
      color: chrome.tabGroups.ColorEnum;
      title?: string;
      windowId?: number;
    }>;
    update(
      groupId: number,
      updateProperties: {
        title?: string;
        color?: chrome.tabGroups.ColorEnum;
        collapsed: boolean;
      }
    ): Promise<unknown>;
  };
}

export interface CommandExecutionResult {
  affectedWindowIds: number[];
  preferredOrder?: number[];
}

type ExistingTab = Awaited<ReturnType<CommandExecutorChromeApi["tabs"]["get"]>>;

export async function executeTabCommand(
  command: TabCommand,
  chromeApi: CommandExecutorChromeApi = chrome
): Promise<CommandExecutionResult> {
  switch (command.type) {
    case "tab/activate": {
      const tab = await chromeApi.tabs.get(command.tabId);
      await chromeApi.tabs.update(command.tabId, {
        active: true
      });
      await chromeApi.windows.update(tab.windowId, {
        focused: true
      });
      return {
        affectedWindowIds: [tab.windowId]
      };
    }
    case "tab/set-pinned": {
      await chromeApi.tabs.update(command.tabId, {
        pinned: command.pinned
      });
      return {
        affectedWindowIds: []
      };
    }
    case "tab/close": {
      await chromeApi.tabs.remove(command.tabId);
      return {
        affectedWindowIds: []
      };
    }
    case "tabs/close": {
      if (command.tabIds.length === 0) {
        return {
          affectedWindowIds: []
        };
      }

      await chromeApi.tabs.remove(command.tabIds);
      return {
        affectedWindowIds: []
      };
    }
    case "group/set-collapsed": {
      const group = await chromeApi.tabGroups.get(command.groupId);
      await chromeApi.tabGroups.update(command.groupId, {
        collapsed: command.collapsed
      });
      return {
        affectedWindowIds: group.windowId == null ? [] : [group.windowId]
      };
    }
    case "tab/move": {
      const tab = await chromeApi.tabs.get(command.tabId);
      assertMovableTabs([tab]);

      await chromeApi.tabs.move(command.tabId, {
        windowId: command.targetWindowId,
        index: command.targetIndex
      });

      if (command.targetGroupId == null) {
        await chromeApi.tabs.ungroup(command.tabId);
      } else {
        await chromeApi.tabs.group({
          groupId: command.targetGroupId,
          tabIds: command.tabId
        });
      }

      return buildWindowResult([tab.windowId], command.targetWindowId);
    }
    case "tabs/move": {
      if (command.tabIds.length === 0) {
        return {
          affectedWindowIds: []
        };
      }

      const tabs = await getExistingTabs(command.tabIds, chromeApi);
      if (tabs.length === 0) {
        return {
          affectedWindowIds: []
        };
      }
      assertMovableTabs(tabs);

      const targetIndex = normalizeMultiTabTargetIndex(tabs, command.targetWindowId, command.targetIndex);
      const isSameWindow = tabs.every((tab) => tab.windowId === command.targetWindowId);

      try {
        if (isSameWindow) {
          await chromeApi.tabs.move(command.tabIds, {
            windowId: command.targetWindowId,
            index: -1
          });

          const movedTabs = await getExistingTabs(command.tabIds, chromeApi);
          const sortedMovedTabs = movedTabs
            .filter((tab): tab is ExistingTab & { id: number; index: number } => tab.id != null && tab.index != null)
            .sort((left, right) => left.index - right.index);

          for (const [offset, tab] of sortedMovedTabs.entries()) {
            const desiredIndex = targetIndex + offset;
            if (tab.index !== desiredIndex) {
              await chromeApi.tabs.move(tab.id, {
                windowId: command.targetWindowId,
                index: desiredIndex
              });
            }
          }
        } else {
          await chromeApi.tabs.move(command.tabIds, {
            windowId: command.targetWindowId,
            index: targetIndex
          });
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("No tab with id")) {
          return buildWindowResult(
            tabs.map((tab) => tab.windowId),
            command.targetWindowId
          );
        }
        throw error;
      }

      if (command.targetGroupId == null) {
        await chromeApi.tabs.ungroup(command.tabIds);
      } else {
        await chromeApi.tabs.group({
          groupId: command.targetGroupId,
          tabIds: command.tabIds
        });
      }

      return buildWindowResult(
        tabs.map((tab) => tab.windowId),
        command.targetWindowId
      );
    }
    case "group/move": {
      if (command.tabIds.length === 0) {
        return {
          affectedWindowIds: [command.targetWindowId]
        };
      }

      const group = await chromeApi.tabGroups.get(command.groupId);
      const tabs = await getExistingTabs(command.tabIds, chromeApi);
      if (tabs.length === 0) {
        return {
          affectedWindowIds: [command.targetWindowId],
          preferredOrder: [command.targetWindowId]
        };
      }
      assertMovableTabs(tabs);

      const isCrossWindow = group.windowId !== command.targetWindowId;

      if (isCrossWindow) {
        // 先将标签移出组，避免 Chrome 跨窗口移动时自动创建新组导致标题冲突
        await chromeApi.tabs.ungroup(command.tabIds);

        await chromeApi.tabs.move(command.tabIds, {
          windowId: command.targetWindowId,
          index: command.targetIndex
        });

        const nextGroupId = await chromeApi.tabs.group({
          createProperties: { windowId: command.targetWindowId },
          tabIds: command.tabIds
        });

        await chromeApi.tabGroups.update(nextGroupId, {
          title: command.title || undefined,
          color: command.color,
          collapsed: command.collapsed
        });
      } else {
        // 同窗口移动：先全部移到末尾，再从末尾移到目标位置
        // 批量移动到末尾，减少 API 调用次数
        await chromeApi.tabs.move(command.tabIds, {
          windowId: command.targetWindowId,
          index: -1
        });

        const movedTabs = await getExistingTabs(command.tabIds, chromeApi);
        const tabsWithIndex = movedTabs.filter((t): t is { id: number; index: number; windowId: number } => t.id != null && t.index != null);
        const sortedMoved = [...tabsWithIndex].sort((a, b) => a.index - b.index);
        for (let i = 0; i < sortedMoved.length; i++) {
          const desired = command.targetIndex + i;
          if (sortedMoved[i].index !== desired) {
            await chromeApi.tabs.move(sortedMoved[i].id, {
              windowId: command.targetWindowId,
              index: desired
            });
          }
        }

        // 修复泄露的标签
        const afterMove = await getExistingTabs(command.tabIds, chromeApi);
        const leakedIds = afterMove
          .filter((tab) => (tab.groupId ?? -1) !== command.groupId)
          .map((tab) => tab.id)
          .filter((id): id is number => id != null);

        if (leakedIds.length > 0) {
          await chromeApi.tabs.group({
            groupId: command.groupId,
            tabIds: leakedIds
          });
        }
      }

      return buildWindowResult(
        tabs.map((tab) => tab.windowId),
        command.targetWindowId
      );
    }
    case "tabs/move-to-new-window": {
      if (command.tabIds.length === 0) {
        return {
          affectedWindowIds: []
        };
      }

      const tabs = await getExistingTabs(command.tabIds, chromeApi);
      if (tabs.length === 0) {
        return {
          affectedWindowIds: []
        };
      }

      const movePlan = buildMoveToNewWindowPlan(tabs);
      if (movePlan.nonPinnedTabIds.length === 0) {
        return {
          affectedWindowIds: movePlan.sourceWindowIds
        };
      }

      const newWindow = await chromeApi.windows.create({});
      if (newWindow.id === undefined) {
        return {
          affectedWindowIds: movePlan.sourceWindowIds
        };
      }

      try {
        await chromeApi.tabs.move(movePlan.nonPinnedTabIds, {
          windowId: newWindow.id,
          index: movePlan.targetIndex
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("No tab with id")) {
          await chromeApi.windows.remove(newWindow.id).catch(() => {});
          return {
            affectedWindowIds: movePlan.sourceWindowIds
          };
        }
        throw error;
      }

      await chromeApi.windows.update(newWindow.id, {
        focused: true
      });

      return {
        affectedWindowIds: [...movePlan.sourceWindowIds, newWindow.id],
        preferredOrder: [newWindow.id, ...movePlan.sourceWindowIds]
      };
    }
  }
}

function normalizeMultiTabTargetIndex(
  tabs: readonly ExistingTab[],
  targetWindowId: number,
  targetIndex: number
): number {
  return Math.max(
    0,
    tabs.reduce(
      (nextIndex, tab) =>
        tab.windowId === targetWindowId && (tab.index ?? 0) < targetIndex ? nextIndex - 1 : nextIndex,
      targetIndex
    )
  );
}

function buildWindowResult(
  sourceWindowIds: readonly number[],
  targetWindowId: number
): CommandExecutionResult {
  const affectedWindowIds = uniqueWindowIds([...sourceWindowIds, targetWindowId]);
  return {
    affectedWindowIds,
    preferredOrder: [targetWindowId, ...affectedWindowIds.filter((windowId) => windowId !== targetWindowId)]
  };
}

function buildMoveToNewWindowPlan(tabs: readonly ExistingTab[]): {
  sourceWindowIds: number[];
  nonPinnedTabIds: number[];
  targetIndex: number;
} {
  const sourceWindowIds = uniqueWindowIds(tabs.map((tab) => tab.windowId));
  const nonPinnedTabIds = tabs.filter((tab) => !tab.pinned).map((tab) => tab.id!).filter(isPresent);
  const pinnedTabsCount = tabs.filter((tab) => tab.pinned).length;

  return {
    sourceWindowIds,
    nonPinnedTabIds,
    targetIndex: pinnedTabsCount
  };
}

function uniqueWindowIds(windowIds: readonly number[]): number[] {
  return Array.from(new Set(windowIds));
}

function assertMovableTabs(tabs: readonly ExistingTab[]): void {
  if (tabs.some((tab) => tab.pinned)) {
    throw new Error(
      translateText(getRuntimeLocale(), createLocalizedText("error.commandPinnedMoveUnsupported"))
    );
  }
}

async function getExistingTabs(
  tabIds: readonly number[],
  chromeApi: CommandExecutorChromeApi
): Promise<ExistingTab[]> {
  const tabs = await Promise.all(tabIds.map((tabId) => getExistingTab(tabId, chromeApi)));
  return tabs.filter(isPresent);
}

async function getExistingTab(
  tabId: number,
  chromeApi: CommandExecutorChromeApi
): Promise<ExistingTab | null> {
  try {
    return await chromeApi.tabs.get(tabId);
  } catch (error) {
    if (error instanceof Error && error.message.includes("No tab with id")) {
      return null;
    }
    throw error;
  }
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value != null;
}
