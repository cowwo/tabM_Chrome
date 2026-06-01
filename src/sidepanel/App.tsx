import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAutoDismiss } from "./hooks/useAutoDismiss";
import {
  applyDocumentLocale,
  getUiLanguage,
  resolveLocale,
  translate
} from "../shared/i18n";
import { selectPanelViewModel } from "../shared/domain/selectors";
import { computeDuplicateSelection } from "../shared/domain/duplicateDetection";
import {
  DEFAULT_EXTENSION_SETTINGS,
  EXTENSION_SETTINGS_STORAGE_KEY,
  loadExtensionSettings,
  mergeExtensionSettings
} from "../shared/settings";
import type { ExtensionSettingsRecord, SearchFilterMode, SupportedLocale, TabCommand, TabRecord } from "../shared/types";
import { VirtualizedWindowList } from "./components/VirtualizedWindowList";
import type { HoveredTabPreview } from "./components/listRows";
import { createPanelCommandActions } from "./panelCommands";
import { SearchBar, focusSearchInput } from "./SearchBar";
import { SidepanelStatus } from "./SidepanelStatus";
import { SidepanelToolbar } from "./SidepanelToolbar";
import { resolveAutoLocateFromLiveActiveTab, type LiveActiveUpdateSource } from "./locateNavigation";
import { useActiveGroupAutoExpand } from "./useActiveGroupAutoExpand";
import { useClosingTabs } from "./useClosingTabs";
import { useCollapsedWindows } from "./useCollapsedWindows";
import { usePanelController } from "./usePanelController";
import { useTabSelection } from "./useTabSelection";

export default function App() {
  const [settings, setSettings] = useState<ExtensionSettingsRecord>(DEFAULT_EXTENSION_SETTINGS);
  const [liveActiveTabId, setLiveActiveTabId] = useState<number | null>(null);
  const [liveActiveUpdateSource, setLiveActiveUpdateSource] = useState<LiveActiveUpdateSource | null>(null);
  const suppressedAutoLocateTabIdRef = useRef<number | null>(null);
  const [locateRequest, setLocateRequest] = useState<{ rowKey: string; requestId: number } | null>(null);
  const [hoveredTabPreview, setHoveredTabPreview] = useState<HoveredTabPreview | null>(null);
  const locale: SupportedLocale = useMemo(
    () => resolveLocale({ settings, uiLanguage: getUiLanguage() }),
    [settings]
  );
  const panelController = usePanelController(locale);
  const dispatchCommand = useCallback(
    (command: TabCommand) => panelController.dispatchCommand(command),
    [panelController]
  );
  const {
    snapshot,
    errorMessage,
    isInteractive,
    hasUsableSnapshot,
    isLoading,
    isResyncing,
    traceSettings,
    traceEntryCount,
    traceUpdatedAt,
    resyncPanel,
    copyDebugTrace,
    postTraceEvent
  } = panelController;
  const [copyTraceState, setCopyTraceState] = useState<"idle" | "success" | "error">("idle");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterMode, setFilterMode] = useState<SearchFilterMode>("filter");
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const panelScrollRef = useRef<HTMLDivElement | null>(null);
  const commandActions = useMemo(() => createPanelCommandActions(dispatchCommand), [dispatchCommand]);

  const handleHoveredTabChange = useCallback((preview: HoveredTabPreview | null) => {
    setHoveredTabPreview(preview);
  }, []);
  const hoveredTabPreviewEnabled = settings.display.hoveredTabPreviewEnabled;

  useEffect(() => {
    applyDocumentLocale({
      locale,
      titleKey: "app.sidepanelTitle"
    });
  }, [locale]);

  useEffect(() => {
    if (hoveredTabPreviewEnabled) {
      return;
    }

    setHoveredTabPreview(null);
  }, [hoveredTabPreviewEnabled]);

  useEffect(() => {
    let disposed = false;

    const initializeSettings = async () => {
      const nextSettings = await loadExtensionSettings();
      if (!disposed) {
        setSettings(nextSettings);
      }
    };

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local") {
        return;
      }

      const settingsChange = changes[EXTENSION_SETTINGS_STORAGE_KEY];
      if (!settingsChange) {
        return;
      }

      setSettings(
        mergeExtensionSettings(
          settingsChange.newValue as Partial<ExtensionSettingsRecord> | undefined
        )
      );
    };

    void initializeSettings();
    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      disposed = true;
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  const {
    collapsedWindowIds,
    hasCollapsedWindows,
    hasCollapsedGroups,
    toggleWindow,
    expandWindowPath,
    expandAll,
    collapseAll
  } = useCollapsedWindows(snapshot, commandActions.setGroupCollapsed);

  const viewModel = useMemo(
    () =>
      selectPanelViewModel({
        state: snapshot,
        collapsedWindowIds,
        searchTerm,
        filterMode,
        locale
      }),
    [collapsedWindowIds, filterMode, locale, searchTerm, snapshot]
  );
  const { filteredRows, renderSections, filteredRowKeySet, searchMatchingTabIds, currentActiveTabId, searchActive, matchCount } = viewModel;
  const toolbarDisabled = !isInteractive || isResyncing;
  const listDisabled = !hasUsableSnapshot;
  const totalTabCount = Object.keys(snapshot.tabsById).length;
  const showEmptyPlaceholder = !isLoading && hasUsableSnapshot && totalTabCount === 0;

  const { selectionMode, selectedTabIds, selectedTabIdSet, clearSelection, enterSelectionMode, exitSelectionMode, removeFromSelection, replaceSelection, handlePrimaryAction } =
    useTabSelection(filteredRows, (event, details) => {
      postTraceEvent({
        event,
        details,
        category: "selection"
      });
    });
  const effectiveSelectedTabIds = useMemo(
    () => Array.from(new Set([...selectedTabIds, ...searchMatchingTabIds])),
    [searchMatchingTabIds, selectedTabIds]
  );
  const moveToNewWindowCount = effectiveSelectedTabIds.length;
  const { closingTabIdSet, startClosing } = useClosingTabs(snapshot);
  const [duplicateToast, setDuplicateToast] = useState<string | null>(null);

  useActiveGroupAutoExpand({
    snapshot,
    currentActiveTabId,
    dispatchCommand
  });

  useEffect(() => {
    (
      window as typeof window & {
        __sidepanelBoot?: {
          ready?: () => void;
        };
      }
    ).__sidepanelBoot?.ready?.();
  }, []);

  useEffect(() => {
    let disposed = false;

    const updateLiveActiveTabId = async (source: LiveActiveUpdateSource) => {
      try {
        const tabs = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true
        });
        if (disposed) {
          return;
        }

        setLiveActiveTabId(tabs[0]?.id ?? null);
        setLiveActiveUpdateSource(source);
      } catch {
        if (!disposed) {
          setLiveActiveTabId(null);
          setLiveActiveUpdateSource(source);
        }
      }
    };

    const handleActivated = () => {
      void updateLiveActiveTabId("tabs.onActivated");
    };
    const handleFocusChanged = () => {
      void updateLiveActiveTabId("windows.onFocusChanged");
    };

    void updateLiveActiveTabId("bootstrap");
    chrome.tabs.onActivated.addListener(handleActivated);
    chrome.windows.onFocusChanged.addListener(handleFocusChanged);

    return () => {
      disposed = true;
      chrome.tabs.onActivated.removeListener(handleActivated);
      chrome.windows.onFocusChanged.removeListener(handleFocusChanged);
    };
  }, []);


  useEffect(() => {
    const api: NonNullable<typeof window.__playwrightApi> = {
      getSnapshot: () => Promise.resolve(snapshot),
      dispatchCommand: (command: TabCommand) => {
        dispatchCommand(command);
        return Promise.resolve();
      },
      waitForInteractive: async () => {
        const timeoutAt = Date.now() + 10_000;
        while (Date.now() < timeoutAt) {
          if (snapshot.version > 0 && panelController.isInteractive) {
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error("Sidepanel did not become interactive within 10 seconds");
      },
      closeSidepanel: () => window.close()
    };
    if (!import.meta.env.PROD || import.meta.env.VITE_E2E_TEST === "true") {
      window.__playwrightApi = api;
    }
  }, [dispatchCommand, panelController.isInteractive, snapshot]);

  const liveActiveTab = useMemo<TabRecord | null>(
    () => (liveActiveTabId == null ? null : snapshot.tabsById[liveActiveTabId] ?? null),
    [liveActiveTabId, snapshot.tabsById]
  );
  const previousLiveActiveTabIdRef = useRef<number | null>(null);
  const canLocateCurrentPage = !toolbarDisabled && liveActiveTab != null;
  const locateDisabledReason = liveActiveTab == null
    ? "sidepanel.toolbar.locateCurrentPageUnavailable"
    : null;

  useEffect(() => {
    if (liveActiveTabId != null) {
      return;
    }

    setLocateRequest(null);
  }, [liveActiveTabId]);

  useEffect(() => {
    if (locateRequest == null) {
      return;
    }

    if (filteredRowKeySet.has(locateRequest.rowKey)) {
      return;
    }

    setLocateRequest(null);
  }, [filteredRowKeySet, locateRequest]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        if (event.key === "Escape") {
          event.preventDefault();
          setSearchTerm("");
          target.blur();
        }
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        focusSearchInput();
        return;
      }

      if (event.key === "Escape" && searchTerm) {
        event.preventDefault();
        setSearchTerm("");
        return;
      }

      if (event.key === "Escape" && selectionMode) {
        event.preventDefault();
        exitSelectionMode();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [exitSelectionMode, searchTerm, selectionMode]);

  function expandLocateTargetPath(targetTab: TabRecord): void {
    expandWindowPath(targetTab.windowId);
    if (targetTab.groupId >= 0) {
      commandActions.setGroupCollapsed(targetTab.groupId, false);
    }
  }

  function requestLocateForTab(targetTab: TabRecord, params: {
    event: "panel/locate-current-page-clicked" | "panel/locate-current-page-auto";
    category: "panel" | "ui";
  }): void {
    const targetRowKey = `tab-${targetTab.id}`;
    const targetVisibleInFilteredRows = filteredRowKeySet.has(targetRowKey);
    const nextSearchTerm = targetVisibleInFilteredRows ? searchTerm : "";

    if (nextSearchTerm !== searchTerm) {
      setSearchTerm(nextSearchTerm);
    }

    expandLocateTargetPath(targetTab);
    setLocateRequest((current) => ({
      rowKey: targetRowKey,
      requestId: (current?.requestId ?? 0) + 1
    }));
    postTraceEvent({
      event: params.event,
      details: {
        targetTabId: targetTab.id,
        targetWindowId: targetTab.windowId,
        targetGroupId: targetTab.groupId,
        searchCleared: nextSearchTerm !== searchTerm,
        hadSearchTerm: searchTerm.trim().length > 0,
        targetVisibleInFilteredRows
      },
      category: params.category
    });
  }

  function requestLocateCurrentPage(): void {
    if (!liveActiveTab) {
      return;
    }

    requestLocateForTab(liveActiveTab, {
      event: "panel/locate-current-page-clicked",
      category: "panel"
    });
  }

  useEffect(() => {
    const decision = resolveAutoLocateFromLiveActiveTab({
      previousActiveTabId: previousLiveActiveTabIdRef.current,
      nextActiveTabId: liveActiveTab?.id ?? null,
      updateSource: liveActiveUpdateSource,
      suppressedTabId: suppressedAutoLocateTabIdRef.current,
      isInteractive: !toolbarDisabled
    });

    previousLiveActiveTabIdRef.current = decision.nextPreviousActiveTabId;
    suppressedAutoLocateTabIdRef.current = decision.nextSuppressedTabId;

    if (!decision.shouldLocate || !liveActiveTab) {
      return;
    }

    requestLocateForTab(liveActiveTab, {
      event: "panel/locate-current-page-auto",
      category: "ui"
    });
  }, [liveActiveTab, liveActiveUpdateSource, requestLocateForTab, toolbarDisabled]);

  function closeTab(tabId: number): void {
    postTraceEvent({
      event: "panel/tab-close-clicked",
      details: {
        tabId,
        selectedTabIds
      },
      category: "command"
    });
    removeFromSelection(tabId);

    const nextClosingTabIds = startClosing([tabId]);
    if (nextClosingTabIds.length === 0) {
      return;
    }

    commandActions.closeTab(tabId);
  }

  function closeSelectedTabs(): void {
    if (selectedTabIds.length === 0) {
      return;
    }

    postTraceEvent({
      event: "panel/tabs-close-selected",
      details: {
        selectedTabIds
      },
      category: "command"
    });

    const nextClosingTabIds = startClosing(selectedTabIds);
    clearSelection();
    if (nextClosingTabIds.length === 0) {
      return;
    }

    commandActions.closeTabs(nextClosingTabIds);
  }

  function handleTabPrimaryAction(params: { tabId: number; shiftKey: boolean; toggleKey: boolean }): void {
    suppressedAutoLocateTabIdRef.current = params.tabId;
    postTraceEvent({
      event: "panel/tab-activate-clicked",
      details: params,
      category: "command"
    });
    handlePrimaryAction({
      ...params,
      onActivate: commandActions.activateTab
    });
  }

  async function handleCopyDebugTrace(): Promise<void> {
    try {
      postTraceEvent({
        event: "panel/trace-copy-clicked",
        details: {
          traceEntryCount
        },
        category: "trace"
      });
      const copied = await copyDebugTrace();
      setCopyTraceState(copied ? "success" : "error");
    } catch {
      setCopyTraceState("error");
    }
  }

  function handleClearSearch(): void {
    postTraceEvent({
      event: "panel/search-cleared-from-app",
      details: {
        searchTerm,
        filterMode,
        matchCount
      },
      category: "search"
    });
    setSearchTerm("");
  }

  function handleSelectDuplicates(): void {
    const result = computeDuplicateSelection(snapshot.tabsById, snapshot.windowTabIds);

    if (!result.hasDuplicates) {
      postTraceEvent({
        event: "panel/duplicates-none",
        details: {},
        category: "selection"
      });
      setDuplicateToast(translate(locale, "sidepanel.toast.noDuplicates"));
      return;
    }

    postTraceEvent({
      event: "panel/duplicates-selected",
      details: {
        duplicateCount: result.tabIdsToSelect.length,
        urlGroupCount: 0
      },
      category: "selection"
    });
    replaceSelection(result.tabIdsToSelect);
    enterSelectionMode();
  }

  function handleMoveToNewWindow(): void {
    if (moveToNewWindowCount === 0) {
      return;
    }

    postTraceEvent({
      event: "panel/search-move-to-new-window-dispatched",
      details: {
        searchTerm,
        filterMode,
        matchCount,
        selectedTabIds,
        effectiveSelectedTabIds
      },
      category: "command"
    });

    commandActions.moveTabsToNewWindow(effectiveSelectedTabIds);
    clearSelection();
    setSearchTerm("");
  }

  useAutoDismiss(duplicateToast, setDuplicateToast, null);
  useAutoDismiss(copyTraceState, setCopyTraceState, "idle");

  return (
    <div ref={appShellRef} className="app-shell">
      <SidepanelToolbar
        locale={locale}
        appShellRef={appShellRef}
        hoveredTabPreview={hoveredTabPreviewEnabled ? hoveredTabPreview : null}
        selectedCount={selectedTabIds.length}
        hasCollapsedWindows={hasCollapsedWindows}
        hasCollapsedGroups={hasCollapsedGroups}
        disabled={toolbarDisabled}
        canLocateCurrentPage={canLocateCurrentPage}
        locateCurrentPageDisabledReasonKey={locateDisabledReason}
        onLocateCurrentPage={requestLocateCurrentPage}
        onSelectDuplicates={handleSelectDuplicates}
        onResync={resyncPanel}
        onOpenSettings={() => {
          postTraceEvent({
            event: "panel/settings-open-clicked",
            details: {},
            category: "panel"
          });
          void chrome.runtime.openOptionsPage();
        }}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
        onCloseSelected={closeSelectedTabs}
        moveToNewWindowCount={moveToNewWindowCount}
        onMoveToNewWindow={handleMoveToNewWindow}
        selectionMode={selectionMode}
        onToggleSelectionMode={() => {
          if (selectionMode) {
            exitSelectionMode();
            return;
          }

          enterSelectionMode();
        }}
      />
      <div ref={panelScrollRef} className="panel-scroll">
        <SidepanelStatus
          locale={locale}
          errorMessage={errorMessage}
          isInteractive={isInteractive}
          isLoading={isLoading}
          isResyncing={isResyncing}
          traceEnabled={traceSettings.verboseLoggingEnabled}
          traceEntryCount={traceEntryCount}
          traceUpdatedAt={traceUpdatedAt}
          duplicateToast={duplicateToast}
          hasUsableSnapshot={hasUsableSnapshot}
          totalTabCount={totalTabCount}
          onCopyDebugTrace={
            errorMessage
              ? () => {
                  void handleCopyDebugTrace();
                }
              : undefined
          }
          copyTraceState={copyTraceState}
        />
        {!isLoading && !showEmptyPlaceholder ? (
          <VirtualizedWindowList
            locale={locale}
            tabDisplaySize={settings.display.tabDisplaySize}
            rows={filteredRows}
            renderSections={renderSections}
            currentActiveTabId={currentActiveTabId}
            locateRequest={locateRequest}
            closingTabIds={closingTabIdSet}
            selectedTabIds={selectedTabIdSet}
            scrollContainerRef={panelScrollRef}
            disabled={listDisabled}
            searchActive={searchActive}
            onHoveredTabChange={hoveredTabPreviewEnabled ? handleHoveredTabChange : undefined}
            onTraceEvent={(event, details) => {
              postTraceEvent({
                event,
                details,
                category: event.startsWith("list/") ? "ui" : "selection"
              });
            }}
            selectionMode={selectionMode}
            onClearSelection={clearSelection}
            onToggleWindow={toggleWindow}
            onToggleGroup={commandActions.setGroupCollapsed}
            onActivateTab={handleTabPrimaryAction}
            onTogglePinned={commandActions.setTabPinned}
            onCloseTab={closeTab}
            onMoveTab={commandActions.moveTab}
            onMoveTabs={commandActions.moveTabs}
            onMoveGroup={commandActions.moveGroup}
          />
        ) : null}
      </div>
      <SearchBar
        locale={locale}
        searchTerm={searchTerm}
        filterMode={filterMode}
        matchCount={matchCount}
        disabled={toolbarDisabled}
        onSearchChange={setSearchTerm}
        onFilterModeChange={setFilterMode}
        onClearSearch={handleClearSearch}
        onTraceEvent={(event, details) => {
          postTraceEvent({
            event,
            details,
            category: "search"
          });
        }}
      />
    </div>
  );
}
