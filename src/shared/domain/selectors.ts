import { NO_TAB_GROUP_ID } from "../defaults";
import { formatWindowTitle } from "../i18n";
import type {
  PanelRow,
  SupportedLocale,
  TabGroupRecord,
  TabRecord,
  TabStoreState,
  WindowRenderItem,
  WindowRenderSection,
  WindowSection,
  WindowSectionItem,
} from "../types";

type TabRow = Extract<PanelRow, { kind: "tab" }>;
type GroupRow = Extract<PanelRow, { kind: "group" }>;
type WindowRow = Extract<PanelRow, { kind: "window" }>;

type WindowSectionItemDescriptor =
  | {
      kind: "tab";
      tab: TabRecord;
    }
  | {
      kind: "group";
      group: TabGroupRecord;
    };

type WindowBlockEntry =
  | {
      kind: "tab";
      row: TabRow;
    }
  | {
      kind: "group";
      row: GroupRow;
      tabs: TabRow[];
    };

type WindowRowBlock = {
  windowRow: WindowRow;
  entries: WindowBlockEntry[];
};

export interface PanelViewModel {
  sections: WindowSection[];
  rows: PanelRow[];
  searchResult: {
    rows: PanelRow[];
    matchCount: number;
  };
  filteredRows: PanelRow[];
  renderSections: WindowRenderSection[];
  filteredRowKeySet: Set<string>;
  searchMatchingTabIds: number[];
  currentActiveTabId: number | null;
  searchActive: boolean;
  matchCount: number;
}

export function selectPanelViewModel(params: {
  state: TabStoreState;
  collapsedWindowIds: readonly number[];
  searchTerm: string;
  filterMode: "filter" | "highlight";
  locale: SupportedLocale;
}): PanelViewModel {
  const { state, collapsedWindowIds, searchTerm, filterMode, locale } = params;
  const sections = selectWindowSections(state, collapsedWindowIds, locale);
  const searchActive = searchTerm.trim().length > 0;
  const rows = flattenWindowSections(
    sections,
    searchActive ? { includeCollapsedChildren: true } : undefined
  );
  const searchResult = createSearchResult(rows, searchTerm, filterMode);
  const filteredRows = searchResult.rows;
  const filteredRowKeySet = new Set(filteredRows.map((row) => row.key));
  const searchMatchingTabIds = getSearchMatchingTabIds(filteredRows);

  return {
    sections,
    rows,
    searchResult,
    filteredRows,
    renderSections: buildWindowRenderSections(filteredRows),
    filteredRowKeySet,
    searchMatchingTabIds,
    currentActiveTabId: selectCurrentActiveTabId(state),
    searchActive,
    matchCount: searchResult.matchCount
  };
}

export function selectWindowSections(
  state: TabStoreState,
  collapsedWindowIds: readonly number[],
  locale: SupportedLocale = "en",
): WindowSection[] {
  const collapsedWindowSet = new Set(collapsedWindowIds);
  const visibleWindows = state.windowOrder
    .map((windowId) => ({
      windowId,
      tabs: selectTabsForWindow(state, windowId),
    }))
    .filter(({ tabs }) => tabs.length > 0);

  return visibleWindows.map(({ windowId, tabs }, visibleIndex) => ({
    windowId,
    title: buildWindowTitle(tabs, visibleIndex + 1, locale),
    isFocused: state.focusedWindowId === windowId,
    collapsed: collapsedWindowSet.has(windowId),
    totalCount: tabs.length,
    firstUnpinnedTabIndex:
      tabs.find((tab) => !tab.pinned)?.index ?? tabs.length,
    items: buildWindowSectionItems(tabs, state),
  }));
}

export function flattenWindowSections(
  sections: WindowSection[],
  options?: {
    includeCollapsedChildren?: boolean;
  },
): PanelRow[] {
  const includeCollapsedChildren = options?.includeCollapsedChildren ?? false;

  return sections.flatMap((section) => {
    const windowRow = createWindowRow(section);
    if (section.collapsed && !includeCollapsedChildren) {
      return [windowRow];
    }

    return [
      windowRow,
      ...section.items.flatMap((item) =>
        createItemRows(section.windowId, item, includeCollapsedChildren),
      ),
    ];
  });
}

export function buildWindowRenderSections(
  rows: readonly PanelRow[],
): WindowRenderSection[] {
  const sections: WindowRenderSection[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.kind !== "window") {
      continue;
    }

    const sectionRows: Array<Exclude<PanelRow, { kind: "window" }>> = [];
    let cursor = index + 1;
    while (cursor < rows.length && rows[cursor].kind !== "window") {
      sectionRows.push(rows[cursor] as Exclude<PanelRow, { kind: "window" }>);
      cursor += 1;
    }

    sections.push({
      windowRow: row,
      items: buildRenderItems(sectionRows),
    });
    index = cursor - 1;
  }

  return sections;
}

export function selectCurrentActiveTabId(state: TabStoreState): number | null {
  if (state.focusedWindowId == null) {
    return null;
  }

  return (
    (state.windowTabIds[state.focusedWindowId] ?? []).find(
      (tabId) => state.tabsById[tabId]?.active,
    ) ?? null
  );
}

export function selectCurrentActiveGroupId(
  state: TabStoreState,
): number | null {
  const currentActiveTabId = selectCurrentActiveTabId(state);
  if (currentActiveTabId == null) {
    return null;
  }

  const groupId =
    state.tabsById[currentActiveTabId]?.groupId ?? NO_TAB_GROUP_ID;
  return groupId === NO_TAB_GROUP_ID ? null : groupId;
}

export function resolveActiveGroupAutoExpand(params: {
  currentActiveTabId: number | null;
  previousActiveTabId: number | null;
  hasCompletedInitialCheck: boolean;
  currentActiveGroupId: number | null;
  hasCurrentActiveGroupRecord: boolean;
  isCurrentActiveGroupCollapsed: boolean;
}): {
  shouldAutoExpand: boolean;
  shouldConsumeCheck: boolean;
} {
  const {
    currentActiveTabId,
    previousActiveTabId,
    hasCompletedInitialCheck,
    currentActiveGroupId,
    hasCurrentActiveGroupRecord,
    isCurrentActiveGroupCollapsed,
  } = params;

  if (currentActiveTabId == null) {
    return {
      shouldAutoExpand: false,
      shouldConsumeCheck: true,
    };
  }

  if (currentActiveGroupId != null && !hasCurrentActiveGroupRecord) {
    return {
      shouldAutoExpand: false,
      shouldConsumeCheck: false,
    };
  }

  if (!isCurrentActiveGroupCollapsed) {
    return {
      shouldAutoExpand: false,
      shouldConsumeCheck: true,
    };
  }

  return {
    shouldAutoExpand:
      !hasCompletedInitialCheck || previousActiveTabId !== currentActiveTabId,
    shouldConsumeCheck: true,
  };
}

export function expandFocusedWindow(
  collapsedWindowIds: readonly number[],
  focusedWindowId: number | null,
): readonly number[] {
  if (
    focusedWindowId == null ||
    !collapsedWindowIds.includes(focusedWindowId)
  ) {
    return collapsedWindowIds;
  }

  return collapsedWindowIds.filter((windowId) => windowId !== focusedWindowId);
}

export function filterPanelRowsBySearch(
  rows: readonly PanelRow[],
  searchTerm: string,
  mode: "filter" | "highlight",
): PanelRow[] {
  return createSearchResult(rows, searchTerm, mode).rows;
}

export function countSearchMatches(rows: readonly PanelRow[]): number {
  return rows.filter((row) => row.kind === "tab" && row.matchesSearch).length;
}

export function createSearchResult(
  rows: readonly PanelRow[],
  searchTerm: string,
  mode: "filter" | "highlight",
): {
  rows: PanelRow[];
  matchCount: number;
} {
  const term = normalizeSearchTerm(searchTerm);
  if (!term) {
    return {
      rows: [...rows],
      matchCount: 0,
    };
  }

  const windowBlocks = collectWindowRowBlocks(rows);
  return mode === "filter"
    ? filterWindowBlocks(windowBlocks, term)
    : highlightWindowBlocks(windowBlocks, term);
}

export function getSearchMatchingTabIds(rows: readonly PanelRow[]): number[] {
  return rows.flatMap((row) =>
    row.kind === "tab" && row.matchesSearch ? [row.tab.id] : [],
  );
}

export type SearchResult = ReturnType<typeof createSearchResult>;

export function hasRowKey(rows: readonly PanelRow[], rowKey: string): boolean {
  return rows.some((row) => row.key === rowKey);
}

export function resolveCollapsedWindowIdsForTarget(params: {
  collapsedWindowIds: readonly number[];
  targetWindowId: number | null;
}): number[] {
  const { collapsedWindowIds, targetWindowId } = params;
  if (targetWindowId == null || !collapsedWindowIds.includes(targetWindowId)) {
    return [...collapsedWindowIds];
  }

  return collapsedWindowIds.filter((windowId) => windowId !== targetWindowId);
}

function buildRenderItems(
  rows: Array<Exclude<PanelRow, { kind: "window" }>>,
): WindowRenderItem[] {
  const items: WindowRenderItem[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.kind !== "group") {
      items.push({
        kind: "single",
        row,
      });
      continue;
    }

    const childRows: Array<Extract<PanelRow, { kind: "tab" }>> = [];
    let cursor = index + 1;
    while (cursor < rows.length) {
      const candidate = rows[cursor];
      if (candidate.kind !== "tab" || candidate.tab.groupId !== row.groupId) {
        break;
      }

      childRows.push(candidate);
      cursor += 1;
    }

    items.push({
      kind: "group-block",
      groupRow: row,
      childRows,
    });
    index = cursor - 1;
  }

  return items;
}

function selectTabsForWindow(
  state: TabStoreState,
  windowId: number,
): TabRecord[] {
  return (state.windowTabIds[windowId] ?? [])
    .map((tabId) => state.tabsById[tabId])
    .filter((tab): tab is TabRecord => Boolean(tab));
}

function buildWindowTitle(
  tabs: readonly TabRecord[],
  visibleWindowIndex: number,
  locale: SupportedLocale,
): string {
  const activeTabTitle = tabs.find((tab) => tab.active)?.title?.trim() ?? "";
  return formatWindowTitle({
    locale,
    visibleWindowIndex,
    activeTabTitle,
  });
}

function buildWindowSectionItems(
  tabs: readonly TabRecord[],
  state: TabStoreState,
): WindowSectionItem[] {
  const groupedTabsById = new Map<number, TabRecord[]>();
  const itemDescriptors: WindowSectionItemDescriptor[] = [];

  tabs.forEach((tab) => {
    const group = resolveTabGroup(state, tab);
    if (!group) {
      itemDescriptors.push({
        kind: "tab",
        tab,
      });
      return;
    }

    const existingTabs = groupedTabsById.get(group.id) ?? [];
    groupedTabsById.set(group.id, [...existingTabs, tab]);

    if (existingTabs.length === 0) {
      itemDescriptors.push({
        kind: "group",
        group,
      });
    }
  });

  return itemDescriptors.map((descriptor) =>
    descriptor.kind === "tab"
      ? descriptor
      : {
          kind: "group",
          group: descriptor.group,
          tabs: groupedTabsById.get(descriptor.group.id) ?? [],
        },
  );
}

function resolveTabGroup(
  state: TabStoreState,
  tab: TabRecord,
): TabGroupRecord | null {
  if (tab.groupId === NO_TAB_GROUP_ID) {
    return null;
  }

  return state.groupsById[tab.groupId] ?? null;
}

const WINDOW_ROW_CACHE_LIMIT = 256;
const GROUP_ROW_CACHE_LIMIT = 256;

// 行对象引用缓存：输入（TabRecord 引用 / 窗口或分组关键字段）不变时返回同一个 row 对象，
// 让 React.memo 能按行跳过重渲染。缓存只由内容决定，不依赖调用顺序。
const windowRowCache = new Map<string, WindowRow>();
const groupRowCache = new Map<string, GroupRow>();
const tabRowCache = new WeakMap<TabRecord, TabRow>();

function buildRowCacheKey(parts: readonly unknown[]): string {
  return JSON.stringify(parts);
}

function rememberRow<Row>(
  cache: Map<string, Row>,
  cacheKey: string,
  row: Row,
  limit: number,
): Row {
  if (cache.size >= limit) {
    // 有界缓存：超限时丢弃最早写入的一半，只影响引用复用，不影响行内容。
    const dropTarget = Math.ceil(limit / 2);
    let droppedCount = 0;
    for (const oldestKey of cache.keys()) {
      cache.delete(oldestKey);
      droppedCount += 1;
      if (droppedCount >= dropTarget) {
        break;
      }
    }
  }

  cache.set(cacheKey, row);
  return row;
}

function createWindowRow(section: WindowSection): WindowRow {
  const cacheKey = buildRowCacheKey([
    section.windowId,
    section.title,
    section.isFocused,
    section.collapsed,
    section.totalCount,
    section.firstUnpinnedTabIndex,
  ]);
  const cachedRow = windowRowCache.get(cacheKey);
  if (cachedRow) {
    return cachedRow;
  }

  const row: WindowRow = {
    kind: "window",
    key: `window-${section.windowId}`,
    windowId: section.windowId,
    title: section.title,
    isFocused: section.isFocused,
    collapsed: section.collapsed,
    totalCount: section.totalCount,
    firstUnpinnedTabIndex: section.firstUnpinnedTabIndex,
  };
  return rememberRow(windowRowCache, cacheKey, row, WINDOW_ROW_CACHE_LIMIT);
}

function createItemRows(
  windowId: number,
  item: WindowSectionItem,
  includeCollapsedChildren: boolean,
): PanelRow[] {
  if (item.kind === "tab") {
    return [createTabRow(windowId, item.tab)];
  }

  const groupRow = createGroupRow(windowId, item);

  if (item.group.collapsed && !includeCollapsedChildren) {
    return [groupRow];
  }

  return [groupRow, ...item.tabs.map((tab) => createTabRow(windowId, tab))];
}

function createGroupRow(
  windowId: number,
  item: Extract<WindowSectionItem, { kind: "group" }>,
): GroupRow {
  const tabIds = item.tabs.map((tab) => tab.id);
  const firstTabIndex = item.tabs[0]?.index ?? 0;
  const cacheKey = buildRowCacheKey([
    windowId,
    item.group.id,
    item.group.title,
    item.group.color,
    item.group.collapsed,
    item.tabs.length,
    tabIds,
    firstTabIndex,
  ]);
  const cachedRow = groupRowCache.get(cacheKey);
  if (cachedRow) {
    return cachedRow;
  }

  const row: GroupRow = {
    kind: "group",
    key: `group-${item.group.id}`,
    windowId,
    groupId: item.group.id,
    title: item.group.title,
    color: item.group.color,
    collapsed: item.group.collapsed,
    totalCount: item.tabs.length,
    tabIds,
    firstTabIndex,
  };
  return rememberRow(groupRowCache, cacheKey, row, GROUP_ROW_CACHE_LIMIT);
}

function createTabRow(windowId: number, tab: TabRecord): TabRow {
  const cachedRow = tabRowCache.get(tab);
  if (cachedRow && cachedRow.windowId === windowId) {
    return cachedRow;
  }

  const row: TabRow = {
    kind: "tab",
    key: `tab-${tab.id}`,
    windowId,
    tab,
  };

  if (tab.windowId !== windowId) {
    // TabRecord 自带 windowId 与所在窗口不一致（异常/瞬态）时不写缓存，
    // 避免同一 TabRecord 在不同 windowId 之间交替时返回过期行。
    return row;
  }

  tabRowCache.set(tab, row);
  return row;
}

function normalizeSearchTerm(searchTerm: string): string {
  return searchTerm.trim().toLowerCase();
}

function matchesSearchTerm(tab: TabRecord, term: string): boolean {
  return (
    tab.title.toLowerCase().includes(term) ||
    tab.url.toLowerCase().includes(term)
  );
}

function collectWindowRowBlocks(rows: readonly PanelRow[]): WindowRowBlock[] {
  const blocks: WindowRowBlock[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.kind !== "window") {
      continue;
    }

    const { entries, nextIndex } = collectWindowBlockEntries(rows, index + 1);
    blocks.push({
      windowRow: row,
      entries,
    });
    index = nextIndex - 1;
  }

  return blocks;
}

function collectWindowBlockEntries(
  rows: readonly PanelRow[],
  startIndex: number,
): {
  entries: WindowBlockEntry[];
  nextIndex: number;
} {
  const entries: WindowBlockEntry[] = [];
  let index = startIndex;

  while (index < rows.length && rows[index].kind !== "window") {
    const row = rows[index];
    if (row.kind === "group") {
      const { tabs, nextIndex } = collectGroupTabRows(
        rows,
        index + 1,
        row.groupId,
      );
      entries.push({
        kind: "group",
        row,
        tabs,
      });
      index = nextIndex;
      continue;
    }

    if (row.kind === "tab") {
      entries.push({
        kind: "tab",
        row,
      });
    }
    index += 1;
  }

  return {
    entries,
    nextIndex: index,
  };
}

function collectGroupTabRows(
  rows: readonly PanelRow[],
  startIndex: number,
  groupId: number,
): {
  tabs: TabRow[];
  nextIndex: number;
} {
  const tabs: TabRow[] = [];
  let index = startIndex;

  while (index < rows.length) {
    const row = rows[index];
    if (row.kind !== "tab" || row.tab.groupId !== groupId) {
      break;
    }

    tabs.push(row);
    index += 1;
  }

  return {
    tabs,
    nextIndex: index,
  };
}

type SearchAnnotatedRowEntry = {
  matched: PanelRow;
  unmatched: PanelRow;
};

const searchAnnotatedRowCache = new WeakMap<PanelRow, SearchAnnotatedRowEntry>();

// 命中状态派生行缓存：基础行不变、matchesSearch 相同时复用同一个 row 对象。
// 基础行本身是记忆化的且从不被原地修改，因此 (基础行, matchesSearch) 是纯输入。
function withSearchMatch(row: PanelRow, matchesSearch: boolean): PanelRow {
  const cachedEntry = searchAnnotatedRowCache.get(row);
  if (cachedEntry) {
    return matchesSearch ? cachedEntry.matched : cachedEntry.unmatched;
  }

  const entry: SearchAnnotatedRowEntry = {
    matched: { ...row, matchesSearch: true },
    unmatched: { ...row, matchesSearch: false },
  };
  searchAnnotatedRowCache.set(row, entry);
  return matchesSearch ? entry.matched : entry.unmatched;
}

function filterWindowBlocks(
  blocks: readonly WindowRowBlock[],
  term: string,
): {
  rows: PanelRow[];
  matchCount: number;
} {
  return blocks.reduce<{ rows: PanelRow[]; matchCount: number }>(
    (result, block) => {
      const filteredBlock = filterWindowBlock(block, term);
      return {
        rows: [...result.rows, ...filteredBlock.rows],
        matchCount: result.matchCount + filteredBlock.matchCount,
      };
    },
    {
      rows: [],
      matchCount: 0,
    },
  );
}

function filterWindowBlock(
  block: WindowRowBlock,
  term: string,
): {
  rows: PanelRow[];
  matchCount: number;
} {
  const filteredEntries = block.entries.flatMap((entry) =>
    filterWindowBlockEntry(entry, term),
  );
  const matchCount = filteredEntries.filter((row) => row.kind === "tab").length;
  return {
    rows:
      filteredEntries.length > 0 ? [block.windowRow, ...filteredEntries] : [],
    matchCount,
  };
}

function filterWindowBlockEntry(
  entry: WindowBlockEntry,
  term: string,
): PanelRow[] {
  if (entry.kind === "tab") {
    return matchesSearchTerm(entry.row.tab, term)
      ? [withSearchMatch(entry.row, true)]
      : [];
  }

  const matchingTabs = entry.tabs.flatMap((tabRow) =>
    matchesSearchTerm(tabRow.tab, term)
      ? [withSearchMatch(tabRow, true)]
      : [],
  );

  return matchingTabs.length > 0
    ? [withSearchMatch(entry.row, true), ...matchingTabs]
    : [];
}

function highlightWindowBlocks(
  blocks: readonly WindowRowBlock[],
  term: string,
): {
  rows: PanelRow[];
  matchCount: number;
} {
  return blocks.reduce<{ rows: PanelRow[]; matchCount: number }>(
    (result, block) => {
      const highlightedBlock = highlightWindowBlock(block, term);
      return {
        rows: [...result.rows, ...highlightedBlock.rows],
        matchCount: result.matchCount + highlightedBlock.matchCount,
      };
    },
    {
      rows: [],
      matchCount: 0,
    },
  );
}

function highlightWindowBlock(
  block: WindowRowBlock,
  term: string,
): {
  rows: PanelRow[];
  matchCount: number;
} {
  const highlightedEntries = block.entries.flatMap((entry) =>
    highlightWindowBlockEntry(entry, term),
  );
  const matchCount = highlightedEntries.filter(
    (row) => row.kind === "tab" && row.matchesSearch,
  ).length;
  const hasWindowMatch = matchCount > 0;
  const highlightedWindowRow = withSearchMatch(
    block.windowRow,
    hasWindowMatch,
  );

  return {
    rows: [highlightedWindowRow, ...highlightedEntries],
    matchCount,
  };
}

function highlightWindowBlockEntry(
  entry: WindowBlockEntry,
  term: string,
): PanelRow[] {
  if (entry.kind === "tab") {
    return [
      withSearchMatch(
        entry.row,
        matchesSearchTerm(entry.row.tab, term),
      ),
    ];
  }

  const highlightedTabs: TabRow[] = entry.tabs.map(
    (tabRow) =>
      withSearchMatch(
        tabRow,
        matchesSearchTerm(tabRow.tab, term),
      ) as TabRow,
  );
  const hasGroupMatch = highlightedTabs.some((tabRow) => tabRow.matchesSearch);
  const highlightedGroupRow = withSearchMatch(entry.row, hasGroupMatch);

  return [highlightedGroupRow, ...highlightedTabs];
}
