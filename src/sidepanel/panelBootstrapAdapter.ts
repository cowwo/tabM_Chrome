import { translate, type SupportedLocale } from "../shared/i18n";
import { getLastFocusedWindowId, queryAllTabGroupsForTabs } from "../background/chromeQueries";
import { normalizeChromeTab } from "../shared/domain/normalizeTab";
import { createSnapshot, createStateFromTabs } from "../shared/domain/tabState";
import type { TabRecord, TabStoreSnapshot } from "../shared/types";

const BOOTSTRAP_CHUNK_SIZE = 80;

/** 等待后台首包快照的上限；超时才回退到本地 chrome.tabs 枚举。 */
export const REMOTE_SNAPSHOT_TIMEOUT_MS = 1_500;

export interface PanelBootstrapParams {
  onStart: () => void;
  onProgress: (loaded: number, total: number) => void;
  onSnapshot: (snapshot: TabStoreSnapshot) => void;
  onError: (message: string) => void;
  shouldStop: () => boolean;
}

export interface PanelBootstrapAdapterOptions {
  /** 可配置的端口快照等待时间，主要供单测缩短等待。 */
  remoteSnapshotTimeoutMs?: number;
}

export interface PanelBootstrapAdapter {
  /**
   * 启动顺序：先等端口快照（最多 remoteSnapshotTimeoutMs），
   * 收到即结束；超时 / 端口失败才执行本地 chrome.tabs 枚举兜底。
   */
  bootstrap(params: PanelBootstrapParams): Promise<void>;
  /** 端口 panel/snapshot 已到达：取消等待，并让迟到的本地兜底结果全部作废。 */
  markRemoteSnapshotReceived(): void;
  /** 端口连接失败/断开且尚未收到快照：立刻执行本地兜底，避免空屏。 */
  markPortFailed(): void;
  /** 面板卸载 / 连接换代：取消等待与兜底，不再回调。 */
  dispose(): void;
}

export function createPanelBootstrapAdapter(
  locale: SupportedLocale,
  options: PanelBootstrapAdapterOptions = {}
): PanelBootstrapAdapter {
  const remoteSnapshotTimeoutMs = options.remoteSnapshotTimeoutMs ?? REMOTE_SNAPSHOT_TIMEOUT_MS;

  let remoteSnapshotReceived = false;
  let portFailureRequested = false;
  let disposed = false;
  let pendingWait: (() => void) | null = null;
  let waitTimer: ReturnType<typeof setTimeout> | null = null;

  const clearWaitTimer = (): void => {
    if (waitTimer == null) {
      return;
    }

    clearTimeout(waitTimer);
    waitTimer = null;
  };

  const resolvePendingWait = (): void => {
    clearWaitTimer();
    const resolve = pendingWait;
    pendingWait = null;
    resolve?.();
  };

  const isCancelled = (shouldStop: () => boolean): boolean =>
    disposed || remoteSnapshotReceived || shouldStop();

  const waitForRemoteSnapshotOrTimeout = async (): Promise<void> => {
    if (remoteSnapshotReceived || portFailureRequested || disposed) {
      return;
    }

    await new Promise<void>((resolve) => {
      pendingWait = resolve;
      waitTimer = setTimeout(() => {
        waitTimer = null;
        pendingWait = null;
        resolve();
      }, remoteSnapshotTimeoutMs);
    });
  };

  return {
    markRemoteSnapshotReceived() {
      remoteSnapshotReceived = true;
      resolvePendingWait();
    },
    markPortFailed() {
      portFailureRequested = true;
      resolvePendingWait();
    },
    dispose() {
      disposed = true;
      resolvePendingWait();
    },
    async bootstrap(params) {
      const { onStart, onProgress, onSnapshot, onError, shouldStop } = params;

      if (remoteSnapshotReceived || disposed) {
        return;
      }

      onStart();

      await waitForRemoteSnapshotOrTimeout();

      if (isCancelled(shouldStop)) {
        return;
      }

      await runLocalBootstrapFallback({
        locale,
        onProgress,
        onSnapshot,
        onError,
        isCancelled: () => isCancelled(shouldStop)
      });
    }
  };
}

async function runLocalBootstrapFallback(params: {
  locale: SupportedLocale;
  onProgress: (loaded: number, total: number) => void;
  onSnapshot: (snapshot: TabStoreSnapshot) => void;
  onError: (message: string) => void;
  isCancelled: () => boolean;
}): Promise<void> {
  const { locale, onProgress, onSnapshot, onError, isCancelled } = params;

  try {
    const tabs = await chrome.tabs.query({});
    if (isCancelled()) {
      return;
    }

    const [focusedWindowId, groups] = await Promise.all([
      getLastFocusedWindowId(),
      queryAllTabGroupsForTabs(tabs)
    ]);

    if (isCancelled()) {
      return;
    }

    const normalizedTabs = await hydrateLocalTabs({
      tabs,
      locale,
      onProgress,
      isCancelled
    });

    if (!normalizedTabs || isCancelled()) {
      return;
    }

    onSnapshot(createSnapshot(createStateFromTabs(normalizedTabs, focusedWindowId, groups), 1));
  } catch {
    if (isCancelled()) {
      return;
    }

    onError(translate(locale, "error.panel.bootstrapFailed"));
  }
}

async function hydrateLocalTabs(params: {
  tabs: readonly chrome.tabs.Tab[];
  locale: SupportedLocale;
  onProgress: (loaded: number, total: number) => void;
  isCancelled: () => boolean;
}): Promise<TabRecord[] | null> {
  const { tabs, locale, onProgress, isCancelled } = params;
  const normalizedTabs: TabRecord[] = [];
  onProgress(0, tabs.length);

  for (let index = 0; index < tabs.length; index += BOOTSTRAP_CHUNK_SIZE) {
    const chunk = tabs.slice(index, index + BOOTSTRAP_CHUNK_SIZE);
    normalizedTabs.push(...normalizeTabChunk(chunk, locale));

    if (isCancelled()) {
      return null;
    }

    onProgress(Math.min(index + chunk.length, tabs.length), tabs.length);

    if (index + BOOTSTRAP_CHUNK_SIZE < tabs.length) {
      await nextPaint();
    }
  }

  return normalizedTabs;
}

function normalizeTabChunk(
  tabs: readonly chrome.tabs.Tab[],
  locale: SupportedLocale
): TabRecord[] {
  return tabs.map((tab) => normalizeChromeTab(tab, locale)).filter((tab): tab is TabRecord => Boolean(tab));
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}
