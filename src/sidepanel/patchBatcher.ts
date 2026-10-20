import type { BackgroundToPanelMessage } from "../shared/messages";
import type { StorePatch } from "../shared/types";

/**
 * 调度器：安排一次回调，返回取消函数。
 * 默认实现优先 requestAnimationFrame（每帧最多 flush 一次），
 * 没有 rAF 的环境（node 单测 / 旧环境）退回 setTimeout(0)。
 */
export type PatchFlushScheduler = (callback: () => void) => () => void;

/** 不能合批、必须立即应用的消息（快照 / 错误 / 调试日志）。 */
export type ImmediatePanelMessage = Exclude<BackgroundToPanelMessage, { type: "panel/patch" }>;

export interface PanelPatchBatcherOptions {
  /** 同一帧内累计的 patch，按到达顺序一次性回调。 */
  onFlush: (patches: StorePatch[]) => void;
  /** 非 patch 消息：先按序 flush 掉已入队的 patch，再回调该消息，保证快照不会排在旧 patch 前面。 */
  onImmediate: (message: ImmediatePanelMessage) => void;
  /** 可注入调度器，主要供 node 环境单测使用。 */
  schedule?: PatchFlushScheduler;
}

export interface PanelPatchBatcher {
  /** 接收后台消息：panel/patch 入队，其余类型立即 flush 并回调。 */
  accept(message: BackgroundToPanelMessage): void;
  /** 立即同步 flush 队列（断连 / 重连 / resync 等场景）。 */
  flushNow(): void;
  /** 丢弃未消费的 patch 并取消已排期的帧回调。 */
  dispose(): void;
  /** 当前未消费的 patch 数量（测试 / 诊断用）。 */
  pendingPatchCount(): number;
}

function createDefaultScheduler(): PatchFlushScheduler {
  if (
    typeof globalThis.requestAnimationFrame === "function" &&
    typeof globalThis.cancelAnimationFrame === "function"
  ) {
    return (callback) => {
      const frameId = globalThis.requestAnimationFrame(() => callback());
      return () => globalThis.cancelAnimationFrame(frameId);
    };
  }

  return (callback) => {
    const timerId = globalThis.setTimeout(callback, 0);
    return () => globalThis.clearTimeout(timerId);
  };
}

export function createPanelPatchBatcher(options: PanelPatchBatcherOptions): PanelPatchBatcher {
  const schedule = options.schedule ?? createDefaultScheduler();
  let pendingPatches: StorePatch[] = [];
  let cancelScheduledFlush: (() => void) | null = null;
  let disposed = false;

  const flushPending = (): void => {
    if (pendingPatches.length === 0) {
      return;
    }

    // 先清空队列再回调：回调里若又收到 patch，会重新排到下一帧，不会在本帧内无限循环。
    const patches = pendingPatches;
    pendingPatches = [];
    options.onFlush(patches);
  };

  const cancelFlush = (): void => {
    if (!cancelScheduledFlush) {
      return;
    }

    const cancel = cancelScheduledFlush;
    cancelScheduledFlush = null;
    cancel();
  };

  const flushNow = (): void => {
    if (disposed) {
      return;
    }

    cancelFlush();
    flushPending();
  };

  const scheduleFlush = (): void => {
    if (disposed || cancelScheduledFlush) {
      return;
    }

    cancelScheduledFlush = schedule(() => {
      cancelScheduledFlush = null;
      if (disposed) {
        pendingPatches = [];
        return;
      }

      flushPending();
    });
  };

  return {
    accept(message) {
      if (disposed) {
        return;
      }

      if (message.type === "panel/patch") {
        pendingPatches.push(message.payload);
        scheduleFlush();
        return;
      }

      // 快照 / 错误 / 日志类消息必须保持与 patch 的相对顺序。
      flushNow();
      options.onImmediate(message);
    },
    flushNow,
    dispose() {
      disposed = true;
      cancelFlush();
      pendingPatches = [];
    },
    pendingPatchCount() {
      return pendingPatches.length;
    }
  };
}
