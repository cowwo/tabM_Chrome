import type { PanelRow } from "../../shared/types";
import type { DragSource, DropTarget } from "./listDrag";
import { resolveDropTarget } from "./listDrag";

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
  const nearestRow = rows
    .map((entry) => ({ entry, distance: distanceToRect(pointer.clientY, entry.rect) }))
    .sort((left, right) => left.distance - right.distance)[0]?.entry;

  if (!nearestRow) {
    return null;
  }

  const pointerRatio = clampPointerRatio((pointer.clientY - nearestRow.rect.top) / nearestRow.rect.height);
  const directTarget = resolveDropTarget({
    source,
    targetRow: nearestRow.row,
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
