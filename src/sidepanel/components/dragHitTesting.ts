import type { PanelRow } from "../../shared/types";
import type { DragSource, DropTarget } from "./listDrag";
import { resolveDropTarget, normalizeGroupId } from "./listDrag";
import { NO_TAB_GROUP_ID } from "../../shared/defaults";

export interface PointerPosition {
  clientX: number;
  clientY: number;
}

export interface DragHitTestRow {
  row: PanelRow;
  rect: DOMRect;
  level: number;
}

export interface GapCandidate {
  distance: number;
  pointerRatio: number;
  row: PanelRow;
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

export function clampPointerRatio(pointerRatio: number): number {
  if (Number.isNaN(pointerRatio)) {
    return 0.5;
  }

  return Math.max(0, Math.min(pointerRatio, 1));
}
