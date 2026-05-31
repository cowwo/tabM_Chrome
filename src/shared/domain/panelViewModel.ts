import {
  buildWindowRenderSections,
  createSearchResult,
  flattenWindowSections,
  getSearchMatchingTabIds,
  selectCurrentActiveGroupId,
  selectCurrentActiveTabId,
  selectWindowSections,
} from "./selectors";
import type {
  PanelRow,
  SearchFilterMode,
  SupportedLocale,
  TabStoreSnapshot,
  WindowRenderSection,
  WindowSection,
} from "../types";
import type { SearchResult } from "./selectors";

export interface PanelViewModel {
  sections: WindowSection[];
  rows: PanelRow[];
  searchResult: SearchResult;
  filteredRows: PanelRow[];
  renderSections: WindowRenderSection[];
  filteredRowKeySet: Set<string>;
  currentActiveTabId: number | null;
  currentActiveGroupId: number | null;
  searchMatchingTabIds: number[];
}

export function selectPanelViewModel(params: {
  snapshot: TabStoreSnapshot;
  collapsedWindowIds: readonly number[];
  searchTerm: string;
  filterMode: SearchFilterMode;
  locale: SupportedLocale;
}): PanelViewModel {
  const { snapshot, collapsedWindowIds, searchTerm, filterMode, locale } =
    params;
  const sections = selectWindowSections(snapshot, collapsedWindowIds, locale);
  const searchActive = searchTerm.trim().length > 0;
  const rows = flattenWindowSections(
    sections,
    searchActive ? { includeCollapsedChildren: true } : undefined,
  );
  const searchResult = createSearchResult(rows, searchTerm, filterMode);
  const filteredRows = searchResult.rows;

  return {
    sections,
    rows,
    searchResult,
    filteredRows,
    renderSections: buildWindowRenderSections(filteredRows),
    filteredRowKeySet: new Set(filteredRows.map((row) => row.key)),
    currentActiveTabId: selectCurrentActiveTabId(snapshot),
    currentActiveGroupId: selectCurrentActiveGroupId(snapshot),
    searchMatchingTabIds: getSearchMatchingTabIds(filteredRows),
  };
}
