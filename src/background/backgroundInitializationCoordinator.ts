import { getLastFocusedWindowId, queryAllTabGroupsForTabs } from "./chromeQueries";
import { normalizeChromeTab } from "../shared/domain/normalizeTab";
import type { TabGroupRecord, TabRecord } from "../shared/types";

export interface BackgroundInitializationCoordinator {
  boot(): Promise<void>;
  ensureInitialized(): Promise<void>;
}

export interface BackgroundInitializationCoordinatorOptions {
  initializeTracePersistence: () => Promise<void>;
  initializeExtensionSettings: () => Promise<void>;
  configureActionBadge: () => void;
  configureSidePanel: () => Promise<void>;
  scheduleActionBadgeUpdate: () => void;
  setInitialStore: (payload: {
    tabs: TabRecord[];
    focusedWindowId: number | null;
    groups: TabGroupRecord[];
  }) => void;
  queryTabs?: () => Promise<chrome.tabs.Tab[]>;
  queryFocusedWindowId?: () => Promise<number | null>;
  queryAllTabGroupsForTabs?: (tabs: readonly chrome.tabs.Tab[]) => Promise<TabGroupRecord[]>;
}

export function createBackgroundInitializationCoordinator(
  options: BackgroundInitializationCoordinatorOptions
): BackgroundInitializationCoordinator {
  const queryTabs = options.queryTabs ?? (() => chrome.tabs.query({}));
  const queryFocusedWindowId = options.queryFocusedWindowId ?? (() => getLastFocusedWindowId());
  const queryAllTabGroups = options.queryAllTabGroupsForTabs ?? ((tabs) => queryAllTabGroupsForTabs(tabs));
  let initialized = false;
  let initializePromise: Promise<void> | null = null;

  const ensureInitialized = async (): Promise<void> => {
    if (initialized) {
      return;
    }

    if (!initializePromise) {
      initializePromise = (async () => {
        const tabs = await queryTabs();
        const [focusedWindowId, groups] = await Promise.all([
          queryFocusedWindowId(),
          queryAllTabGroups(tabs)
        ]);

        options.setInitialStore({
          tabs: normalizeTabs(tabs),
          focusedWindowId,
          groups
        });
        initialized = true;
        options.scheduleActionBadgeUpdate();
      })().catch((error) => {
        initializePromise = null;
        throw error;
      });
    }

    await initializePromise;
  };

  return {
    async boot(): Promise<void> {
      await options.initializeTracePersistence();
      await options.initializeExtensionSettings();
      options.configureActionBadge();
      await Promise.all([ensureInitialized(), options.configureSidePanel()]);
    },
    ensureInitialized
  };
}

function normalizeTabs(tabs: readonly chrome.tabs.Tab[]): TabRecord[] {
  return tabs.map((tab) => normalizeChromeTab(tab)).filter((tab): tab is TabRecord => Boolean(tab));
}
