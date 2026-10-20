import type { PanelRow } from "../../shared/types";
import type { DragSource, DropTarget, DragHitTestRow, GapCandidate } from "./listDrag";
import { resolveDropTarget, normalizeGroupId, clampPointerRatio } from "./listDrag";
import { NO_TAB_GROUP_ID } from "../../shared/defaults";

export type { DragHitTestRow, GapCandidate };

export interface PointerPosition {
  clientX: number;
  clientY: number;
}

export function findClosestDropTarget(params: {
  source: DragSource;
  pointer: PointerPosition;
  rows: readonly DragHitTestRow[];
}): DropTarget | null {
  const { source, pointer, rows } = params;
  const nearestEntry = rows
    .map((entry) => ({ entry, distance: distanceToRect(pointer.clientY, entry.rect) }))
    .sort((left, right) => left.distance - right.distance)[0];

  if (!nearestEntry) {
    return null;
  }

  const { row: nearestRow, rect: nearestRect } = nearestEntry.entry;

  // When the nearest row is a child tab inside a group and the source is not
  // already within that group, prefer an into-group target for the parent group.
  if (
    nearestRow.kind === "tab"
    && nearestRow.tab.groupId !== NO_TAB_GROUP_ID
    && source.kind !== "group"
  ) {
    const targetGroupId = normalizeGroupId(nearestRow.tab.groupId);
    const isSourceInTargetGroup = source.kind === "tab"
      ? source.groupId === targetGroupId
      : source.tabs.every((t) => t.groupId === targetGroupId);

    if (!isSourceInTargetGroup) {
      const parentGroupEntry = rows.find(
        (entry) => entry.row.kind === "group" && entry.row.groupId === nearestRow.tab.groupId
      );
      if (parentGroupEntry) {
        const groupPointerRatio = clampPointerRatio(
          (pointer.clientY - parentGroupEntry.rect.top) / parentGroupEntry.rect.height
        );
        const groupTarget = resolveDropTarget({
          source,
          targetRow: parentGroupEntry.row,
          pointerRatio: groupPointerRatio
        });
        if (groupTarget) {
          return groupTarget;
        }
      }
    }
  }

  const pointerRatio = clampPointerRatio((pointer.clientY - nearestRect.top) / nearestRect.height);
  const directTarget = resolveDropTarget({
    source,
    targetRow: nearestRow,
    pointerRatio
  });

  if (directTarget) {
    return directTarget;
  }

  return findClosestGapTarget({ source, pointer, rows });
}

function findClosestGapTarget(params: {
  source: DragSource;
  pointer: PointerPosition;
  rows: readonly DragHitTestRow[];
}): DropTarget | null {
  const { source, pointer, rows } = params;

  return rows
    .map<GapCandidate>((entry) => ({
      row: entry.row,
      distance: distanceToRect(pointer.clientY, entry.rect),
      pointerRatio: pointer.clientY < entry.rect.top ? 0 : 1
    }))
    .sort((left, right) => left.distance - right.distance)
    .map((candidate) =>
      resolveDropTarget({
        source,
        targetRow: candidate.row,
        pointerRatio: candidate.pointerRatio
      })
    )
    .find((candidate): candidate is DropTarget => candidate != null) ?? null;
}

export function distanceToRect(clientY: number, rect: DOMRect): number {
  if (clientY < rect.top) {
    return rect.top - clientY;
  }

  if (clientY > rect.bottom) {
    return clientY - rect.bottom;
  }

  return 0;
}

// ── 拖拽命中热路径：预排序索引 + 二分 ────────────────────────────────
//
// 指针移动 / 自动滚动时不再对全部行做两次 sort：拖拽开始（或滚动、折叠、
// 布局变化）时构建一次按 rect.top 预排序的索引并缓存，之后按 clientY 二分
// 定位候选窗口，只在候选窗口内比较距离。

export interface DragHitTestIndex {
  entries: DragHitTestRow[];
}

export interface DragHitTestCacheState {
  scrollTop: number;
  rowsRevision: number;
  layoutRevision: number;
  index: DragHitTestIndex;
}

export function createDragHitTestIndex(rows: readonly DragHitTestRow[]): DragHitTestIndex {
  const entries = rows.slice().sort((left, right) => {
    if (left.rect.top !== right.rect.top) {
      return left.rect.top - right.rect.top;
    }

    return left.rect.bottom - right.rect.bottom;
  });

  return { entries };
}

export function isDragHitTestCacheValid(params: {
  cache: DragHitTestCacheState | null;
  scrollTop: number;
  rowsRevision: number;
  layoutRevision: number;
}): boolean {
  const { cache } = params;
  return cache != null
    && cache.scrollTop === params.scrollTop
    && cache.rowsRevision === params.rowsRevision
    && cache.layoutRevision === params.layoutRevision;
}

/**
 * 对已按 top 排序的 entries 二分定位插入点，再在候选窗口内取最近 entry。
 * 返回 entries 下标；没有 entry 时返回 -1。
 */
export function findNearestDragEntryIndex(
  entries: readonly DragHitTestRow[],
  clientY: number
): number {
  const count = entries.length;
  if (count === 0) {
    return -1;
  }

  // 第一个 bottom >= clientY 的 entry（可能"包含"指针）
  let low = 0;
  let high = count;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (entries[mid]!.rect.bottom >= clientY) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  const probe = low >= count ? count - 1 : low;
  const windowStart = Math.max(0, probe - 2);
  const windowEnd = Math.min(count - 1, probe + 2);

  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = windowStart; index <= windowEnd; index += 1) {
    const distance = distanceToRect(clientY, entries[index]!.rect);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function resolveClosestGroupEntry(entries: readonly DragHitTestRow[], groupId: number): DragHitTestRow | null {
  for (const entry of entries) {
    if (entry.row.kind === "group" && entry.row.groupId === groupId) {
      return entry;
    }
  }

  return null;
}

export function findClosestDropTargetInIndex(params: {
  source: DragSource;
  pointer: PointerPosition;
  index: DragHitTestIndex;
}): DropTarget | null {
  const { source, pointer, index } = params;
  const entries = index.entries;
  const nearestIndex = findNearestDragEntryIndex(entries, pointer.clientY);

  if (nearestIndex < 0) {
    return null;
  }

  const nearestEntry = entries[nearestIndex]!;
  const nearestRow = nearestEntry.row;
  const nearestRect = nearestEntry.rect;

  // 组内子标签且源不在该组时，优先落到父组的 into-group 目标。
  if (
    nearestRow.kind === "tab"
    && nearestRow.tab.groupId !== NO_TAB_GROUP_ID
    && source.kind !== "group"
  ) {
    const targetGroupId = normalizeGroupId(nearestRow.tab.groupId);
    const isSourceInTargetGroup = source.kind === "tab"
      ? source.groupId === targetGroupId
      : source.tabs.every((tab) => tab.groupId === targetGroupId);

    if (!isSourceInTargetGroup) {
      const parentGroupEntry = resolveClosestGroupEntry(entries, nearestRow.tab.groupId);
      if (parentGroupEntry != null) {
        const groupPointerRatio = clampPointerRatio(
          (pointer.clientY - parentGroupEntry.rect.top) / parentGroupEntry.rect.height
        );
        const groupTarget = resolveDropTarget({
          source,
          targetRow: parentGroupEntry.row,
          pointerRatio: groupPointerRatio
        });
        if (groupTarget != null) {
          return groupTarget;
        }
      }
    }
  }

  const pointerRatio = clampPointerRatio((pointer.clientY - nearestRect.top) / nearestRect.height);
  const directTarget = resolveDropTarget({
    source,
    targetRow: nearestRow,
    pointerRatio
  });

  if (directTarget != null) {
    return directTarget;
  }

  return findClosestGapTargetInIndex({ source, pointer, entries });
}

function findClosestGapTargetInIndex(params: {
  source: DragSource;
  pointer: PointerPosition;
  entries: readonly DragHitTestRow[];
}): DropTarget | null {
  const { source, pointer, entries } = params;
  let bestTarget: DropTarget | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const entry of entries) {
    const candidate = resolveDropTarget({
      source,
      targetRow: entry.row,
      pointerRatio: pointer.clientY < entry.rect.top ? 0 : 1
    });
    if (candidate == null) {
      continue;
    }

    const distance = distanceToRect(pointer.clientY, entry.rect);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestTarget = candidate;
    }
  }

  return bestTarget;
}

/** 只从"已渲染行"收集命中测试 entry（虚拟列表下 DOM 行数 ≈ 可见行数）。 */
export function collectRenderedDragRows(params: {
  rowRefs: ReadonlyMap<string, HTMLElement>;
  rowByKey: ReadonlyMap<string, PanelRow>;
}): DragHitTestRow[] {
  const entries: DragHitTestRow[] = [];

  for (const [rowKey, node] of params.rowRefs) {
    const row = params.rowByKey.get(rowKey);
    if (row == null) {
      continue;
    }

    entries.push({
      row,
      rect: node.getBoundingClientRect(),
      level: 0
    });
  }

  return entries;
}

/** 兼容旧入口：先构建索引再命中（单测/低频路径用；热路径请复用索引）。 */
export function findClosestDropTargetInRows(params: {
  source: DragSource;
  pointer: PointerPosition;
  rows: readonly DragHitTestRow[];
}): DropTarget | null {
  return findClosestDropTargetInIndex({
    source: params.source,
    pointer: params.pointer,
    index: createDragHitTestIndex(params.rows)
  });
}
