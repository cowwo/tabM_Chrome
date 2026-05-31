import type { StorePatch, TabGroupRecord, TabRecord, TabStoreSnapshot, TabStoreState } from "../types";

export function createEmptyState(): TabStoreState {
  return {
    tabsById: {},
    windowTabIds: {},
    windowOrder: [],
    groupsById: {},
    focusedWindowId: null
  };
}

export function createSnapshot(state: TabStoreState, version: number): TabStoreSnapshot {
  return {
    ...state,
    version
  };
}

export function createStateFromTabs(
  tabs: TabRecord[],
  focusedWindowId: number | null,
  groups: TabGroupRecord[] = []
): TabStoreState {
  const tabsById: Record<number, TabRecord> = {};
  const windowTabIds: Record<number, number[]> = {};
  const groupsById: Record<number, TabGroupRecord> = {};

  for (const group of groups) {
    groupsById[group.id] = group;
  }

  for (const tab of tabs) {
    tabsById[tab.id] = tab;
    const bucket = windowTabIds[tab.windowId] ?? [];
    bucket.push(tab.id);
    windowTabIds[tab.windowId] = bucket;
  }

  for (const windowId of Object.keys(windowTabIds)) {
    const numericWindowId = Number(windowId);
    windowTabIds[numericWindowId] = [...windowTabIds[numericWindowId]].sort(
      (leftId, rightId) => tabsById[leftId].index - tabsById[rightId].index
    );
  }

  const windowOrder = sortWindowIds(Object.keys(windowTabIds).map(Number));

  return {
    tabsById,
    windowTabIds,
    windowOrder,
    groupsById,
    focusedWindowId: resolveFocusedWindowAfterMutation(focusedWindowId, windowOrder)
  };
}

export function applyPatch(state: TabStoreState, patch: StorePatch): TabStoreState {
  switch (patch.type) {
    case "tab/upsert":
      return upsertTabRecord(state, patch.tab);
    case "group/upsert":
      return upsertGroupRecord(state, patch.group);
    case "group/remove":
      return removeGroupRecord(state, patch.groupId);
    case "tab/remove":
      return removeTabRecord(state, patch.tabId, patch.windowId);
    case "window/focus":
      return setFocusedWindow(state, patch.windowId);
    case "window/remove":
      return removeWindow(state, patch.windowId);
  }
}

export function upsertTabRecord(state: TabStoreState, tab: TabRecord): TabStoreState {
  const previous = state.tabsById[tab.id];
  if (previous && isSameTab(previous, tab)) {
    return state;
  }

  const tabsById = { ...state.tabsById };
  const windowTabIds = cloneWindowTabIds(state.windowTabIds);
  const affectedWindowIds = new Set<number>();
  let removedWindowId: number | undefined;

  if (previous) {
    affectedWindowIds.add(previous.windowId);
    windowTabIds[previous.windowId] = (windowTabIds[previous.windowId] ?? []).filter(
      (tabId) => tabId !== tab.id
    );
    if (windowTabIds[previous.windowId]?.length === 0) {
      delete windowTabIds[previous.windowId];
      removedWindowId = previous.windowId;
    }
  }

  tabsById[tab.id] = tab;
  affectedWindowIds.add(tab.windowId);

  const existing = windowTabIds[tab.windowId] ?? [];

  // 新 tab 必须加到窗口列表；只有 windowId 或 index 变化时才重排
  const needsReorder = previous && (previous.windowId !== tab.windowId || previous.index !== tab.index);
  if (needsReorder) {
    const reorderedTabIds = existing.filter((candidateId) => candidateId !== tab.id);
    windowTabIds[tab.windowId] = [...reorderedTabIds, tab.id].sort(
      (leftId, rightId) => tabsById[leftId].index - tabsById[rightId].index
    );
  } else if (!existing.includes(tab.id)) {
    windowTabIds[tab.windowId] = [...existing, tab.id].sort(
      (leftId, rightId) => tabsById[leftId].index - tabsById[rightId].index
    );
  }

  for (const windowId of affectedWindowIds) {
    if (windowId === tab.windowId) {
      continue;
    }
    if (!windowTabIds[windowId]) {
      continue;
    }
    windowTabIds[windowId] = [...windowTabIds[windowId]].sort(
      (leftId, rightId) => tabsById[leftId].index - tabsById[rightId].index
    );
  }

  const windowOrder = sortWindowIds(Object.keys(windowTabIds).map(Number));
  const focusedWindowId =
    removedWindowId == null
      ? resolveFocusedWindowAfterMutation(state.focusedWindowId, windowOrder)
      : resolveFocusedWindowAfterRemoval(state.focusedWindowId, windowOrder, removedWindowId);

  return {
    tabsById,
    windowTabIds,
    windowOrder,
    groupsById: state.groupsById,
    focusedWindowId
  };
}

export function removeTabRecord(
  state: TabStoreState,
  tabId: number,
  fallbackWindowId?: number
): TabStoreState {
  const existing = state.tabsById[tabId];
  const windowId = existing?.windowId ?? fallbackWindowId;

  if (windowId == null || !existing) {
    return state;
  }

  const tabsById = { ...state.tabsById };
  const windowTabIds = cloneWindowTabIds(state.windowTabIds);
  delete tabsById[tabId];

  const nextIds = (windowTabIds[windowId] ?? []).filter((candidateId) => candidateId !== tabId);
  const windowRemoved = nextIds.length === 0;
  if (windowRemoved) {
    delete windowTabIds[windowId];
  } else {
    windowTabIds[windowId] = nextIds;
  }

  const windowOrder = sortWindowIds(Object.keys(windowTabIds).map(Number));
  const focusedWindowId = windowRemoved
    ? resolveFocusedWindowAfterRemoval(state.focusedWindowId, windowOrder, windowId)
    : resolveFocusedWindowAfterMutation(state.focusedWindowId, windowOrder);

  return {
    tabsById,
    windowTabIds,
    windowOrder,
    groupsById: state.groupsById,
    focusedWindowId
  };
}

export function removeWindow(state: TabStoreState, windowId: number): TabStoreState {
  if (!state.windowTabIds[windowId]) {
    return state;
  }

  const tabsById = { ...state.tabsById };
  for (const tabId of state.windowTabIds[windowId]) {
    delete tabsById[tabId];
  }
  const groupsById = { ...state.groupsById };
  for (const [groupId, group] of Object.entries(groupsById)) {
    if (group.windowId === windowId) {
      delete groupsById[Number(groupId)];
    }
  }

  const windowTabIds = cloneWindowTabIds(state.windowTabIds);
  delete windowTabIds[windowId];

  const windowOrder = sortWindowIds(Object.keys(windowTabIds).map(Number));
  const focusedWindowId = resolveFocusedWindowAfterRemoval(state.focusedWindowId, windowOrder, windowId);

  return {
    tabsById,
    windowTabIds,
    windowOrder,
    groupsById,
    focusedWindowId
  };
}

function resolveFocusedWindowAfterMutation(
  focusedWindowId: number | null,
  windowOrder: number[]
): number | null {
  return focusedWindowId != null ? focusedWindowId : windowOrder[0] ?? null;
}

function resolveFocusedWindowAfterRemoval(
  focusedWindowId: number | null,
  windowOrder: number[],
  removedWindowId: number
): number | null {
  if (focusedWindowId == null || focusedWindowId === removedWindowId) {
    return windowOrder[0] ?? null;
  }

  return focusedWindowId;
}

export function setFocusedWindow(state: TabStoreState, windowId: number | null): TabStoreState {
  return {
    ...state,
    focusedWindowId: windowId
  };
}

export function upsertGroupRecord(state: TabStoreState, group: TabGroupRecord): TabStoreState {
  const previous = state.groupsById[group.id];
  if (
    previous &&
    previous.windowId === group.windowId &&
    previous.title === group.title &&
    previous.color === group.color &&
    previous.collapsed === group.collapsed
  ) {
    return state;
  }

  return {
    ...state,
    groupsById: {
      ...state.groupsById,
      [group.id]: group
    }
  };
}

export function removeGroupRecord(state: TabStoreState, groupId: number): TabStoreState {
  if (!state.groupsById[groupId]) {
    return state;
  }

  const groupsById = { ...state.groupsById };
  delete groupsById[groupId];

  return {
    ...state,
    groupsById
  };
}

function sortWindowIds(windowIds: number[]): number[] {
  return windowIds.toSorted((left, right) => left - right);
}

function cloneWindowTabIds(windowTabIds: Record<number, number[]>): Record<number, number[]> {
  return Object.fromEntries(
    Object.entries(windowTabIds).map(([windowId, tabIds]) => [Number(windowId), [...tabIds]])
  );
}

function isSameTab(left: TabRecord, right: TabRecord): boolean {
  return (
    left.id === right.id &&
    left.windowId === right.windowId &&
    left.index === right.index &&
    left.title === right.title &&
    left.url === right.url &&
    left.pinned === right.pinned &&
    left.active === right.active &&
    left.audible === right.audible &&
    left.discarded === right.discarded &&
    left.groupId === right.groupId &&
    left.favIconUrl === right.favIconUrl &&
    left.lastAccessed === right.lastAccessed
  );
}
