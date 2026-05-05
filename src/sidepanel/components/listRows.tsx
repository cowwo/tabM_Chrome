import { CloseSmall, Pin } from "@icon-park/react";
import { memo, useEffect, useMemo, useState } from "react";
import type { SupportedLocale } from "../../shared/i18n";
import { buildTabFaviconCandidates } from "../../shared/domain/favicon";
import { translate } from "../../shared/i18n";
import type { PanelRow } from "../../shared/types";
import type { DropTarget } from "./listDrag";
import {
  getGroupRowClassName,
  getRowShellClassName,
  getTabRowClassName,
  getWindowRowClassName
} from "./listUtils";

export interface HoveredTabPreview {
  title: string;
  url: string;
}

export interface RowShellProps {
  locale: SupportedLocale;
  row: PanelRow;
  rowRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  isCurrentActive?: boolean;
  isWindowActive?: boolean;
  isClosing?: boolean;
  isSelected?: boolean;
  isLocatePulsing?: boolean;
  onCaptureManualToggleAnchor: (rowKey: string) => void;
  disabled: boolean;
  onClearSelection: () => void;
  onToggleWindow: (windowId: number) => void;
  onToggleGroup: (groupId: number, collapsed: boolean) => void;
  onActivateTab: (params: {
    tabId: number;
    shiftKey: boolean;
    toggleKey: boolean;
  }) => void;
  onTogglePinned: (tabId: number, pinned: boolean) => void;
  onCloseTab: (tabId: number) => void;
  selectionMode: boolean;
  onPointerDown: (row: PanelRow, event: React.PointerEvent<HTMLElement>) => void;
  onPointerEnter: (row: PanelRow, event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (row: PanelRow, event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (row: PanelRow, event: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (row: PanelRow, event: React.PointerEvent<HTMLElement>) => void;
  extraClassName?: string;
  groupedTabColor?: chrome.tabGroups.ColorEnum;
  visuallyExpanded?: boolean;
  isDragging?: boolean;
  dropIndicator?: DropTarget["indicator"] | null;
  onElementRefChange?: (node: HTMLDivElement | null) => void;
  onHoveredTabChange?: (preview: HoveredTabPreview | null) => void;
}

function RowShellInner({
  locale,
  row,
  rowRefs,
  isCurrentActive = false,
  isWindowActive = false,
  isClosing = false,
  isSelected = false,
  isLocatePulsing = false,
  onCaptureManualToggleAnchor,
  disabled,
  onClearSelection,
  onToggleWindow,
  onToggleGroup,
  onActivateTab,
  onTogglePinned,
  onCloseTab,
  selectionMode,
  onPointerDown,
  onPointerEnter,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  extraClassName = "",
  groupedTabColor,
  visuallyExpanded = false,
  isDragging = false,
  dropIndicator = null,
  onElementRefChange,
  onHoveredTabChange
}: RowShellProps) {
  const shellExtraClassName = [
    extraClassName,
    isDragging ? "stack-list__item--dragging" : "",
    dropIndicator ? `stack-list__item--drop-${dropIndicator}` : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={getRowShellClassName({
        extraClassName: shellExtraClassName
      })}
      ref={(node) => {
        if (node) {
          rowRefs.current.set(row.key, node);
        } else {
          rowRefs.current.delete(row.key);
        }
        onElementRefChange?.(node);
      }}
    >
      <PanelListRow
        row={row}
        isCurrentActive={isCurrentActive}
        isWindowActive={isWindowActive}
        isClosing={isClosing}
        isSelected={isSelected}
        isLocatePulsing={isLocatePulsing}
        locale={locale}
        onCaptureManualToggleAnchor={onCaptureManualToggleAnchor}
        disabled={disabled}
        onClearSelection={onClearSelection}
        onToggleWindow={onToggleWindow}
        onToggleGroup={onToggleGroup}
        onActivateTab={onActivateTab}
        onTogglePinned={onTogglePinned}
        onCloseTab={onCloseTab}
        selectionMode={selectionMode}
        onPointerDown={onPointerDown}
        onPointerEnter={onPointerEnter}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        groupedTabColor={groupedTabColor}
        visuallyExpanded={visuallyExpanded}
        onHoveredTabChange={onHoveredTabChange}
      />
    </div>
  );
}

export function areRowShellPropsEqual(previous: RowShellProps, next: RowShellProps): boolean {
  return (
    previous.row === next.row
    && previous.locale === next.locale
    && previous.rowRefs === next.rowRefs
    && previous.isCurrentActive === next.isCurrentActive
    && previous.isWindowActive === next.isWindowActive
    && previous.isClosing === next.isClosing
    && previous.isSelected === next.isSelected
    && previous.isLocatePulsing === next.isLocatePulsing
    && previous.disabled === next.disabled
    && previous.selectionMode === next.selectionMode
    && previous.extraClassName === next.extraClassName
    && previous.groupedTabColor === next.groupedTabColor
    && previous.visuallyExpanded === next.visuallyExpanded
    && previous.isDragging === next.isDragging
    && previous.dropIndicator === next.dropIndicator
    && previous.onCaptureManualToggleAnchor === next.onCaptureManualToggleAnchor
    && previous.onClearSelection === next.onClearSelection
    && previous.onToggleWindow === next.onToggleWindow
    && previous.onToggleGroup === next.onToggleGroup
    && previous.onActivateTab === next.onActivateTab
    && previous.onTogglePinned === next.onTogglePinned
    && previous.onCloseTab === next.onCloseTab
    && previous.onPointerDown === next.onPointerDown
    && previous.onPointerEnter === next.onPointerEnter
    && previous.onPointerMove === next.onPointerMove
    && previous.onPointerUp === next.onPointerUp
    && previous.onPointerCancel === next.onPointerCancel
    && previous.onElementRefChange === next.onElementRefChange
    && previous.onHoveredTabChange === next.onHoveredTabChange
  );
}

export const RowShell = memo(RowShellInner, areRowShellPropsEqual);

function PanelListRow({
  locale,
  row,
  isCurrentActive = false,
  isWindowActive = false,
  isClosing = false,
  isSelected = false,
  isLocatePulsing = false,
  onCaptureManualToggleAnchor,
  disabled,
  onClearSelection,
  onToggleWindow,
  onToggleGroup,
  onActivateTab,
  onTogglePinned,
  onCloseTab,
  selectionMode,
  onPointerDown,
  onPointerEnter,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  groupedTabColor,
  visuallyExpanded = false,
  onHoveredTabChange
}: {
  locale: SupportedLocale;
  row: PanelRow;
  isCurrentActive?: boolean;
  isWindowActive?: boolean;
  isClosing?: boolean;
  isSelected?: boolean;
  isLocatePulsing?: boolean;
  onCaptureManualToggleAnchor: (rowKey: string) => void;
  disabled: boolean;
  onClearSelection: () => void;
  onToggleWindow: (windowId: number) => void;
  onToggleGroup: (groupId: number, collapsed: boolean) => void;
  onActivateTab: (params: {
    tabId: number;
    shiftKey: boolean;
    toggleKey: boolean;
  }) => void;
  onTogglePinned: (tabId: number, pinned: boolean) => void;
  onCloseTab: (tabId: number) => void;
  selectionMode: boolean;
  onPointerDown: (row: PanelRow, event: React.PointerEvent<HTMLElement>) => void;
  onPointerEnter: (row: PanelRow, event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (row: PanelRow, event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (row: PanelRow, event: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (row: PanelRow, event: React.PointerEvent<HTMLElement>) => void;
  groupedTabColor?: chrome.tabGroups.ColorEnum;
  visuallyExpanded?: boolean;
  onHoveredTabChange?: (preview: HoveredTabPreview | null) => void;
}) {
  if (row.kind === "window") {
    return (
      <button
        type="button"
        className={getWindowRowClassName({
          isFocused: row.isFocused,
          visuallyExpanded
        })}
        role="treeitem"
        aria-level={1}
        onClick={() => {
          onClearSelection();
          onCaptureManualToggleAnchor(row.key);
          onToggleWindow(row.windowId);
        }}
        onPointerEnter={(event) => onPointerEnter(row, event)}
        onPointerMove={(event) => onPointerMove(row, event)}
        onPointerUp={(event) => onPointerUp(row, event)}
        onPointerCancel={(event) => onPointerCancel(row, event)}
        aria-expanded={visuallyExpanded || !row.collapsed}
        disabled={disabled}
      >
        <span className="window-row__chevron" aria-hidden="true">
          {visuallyExpanded || !row.collapsed ? "▾" : "▸"}
        </span>
        <span className="window-row__title">{row.title}</span>
        <span className="window-row__meta">
          {row.isFocused ? <span className="window-row__current">{translate(locale, "sidepanel.window.current")}</span> : null}
          <span className="window-row__count">{row.totalCount}</span>
        </span>
      </button>
    );
  }

  if (row.kind === "group") {
    return (
      <button
        type="button"
        className={getGroupRowClassName({
          collapsed: row.collapsed,
          visuallyExpanded
        })}
        role="treeitem"
        aria-level={2}
        onClick={() => {
          onClearSelection();
          onCaptureManualToggleAnchor(row.key);
          onToggleGroup(row.groupId, !row.collapsed);
        }}
        onPointerDown={(event) => onPointerDown(row, event)}
        onPointerEnter={(event) => onPointerEnter(row, event)}
        onPointerMove={(event) => onPointerMove(row, event)}
        onPointerUp={(event) => onPointerUp(row, event)}
        onPointerCancel={(event) => onPointerCancel(row, event)}
        aria-expanded={visuallyExpanded || !row.collapsed}
        disabled={disabled}
      >
        <span className="group-row__title">{row.title}</span>
        <span className="group-row__meta">
          <span className="group-row__count">{row.totalCount}</span>
          <span className="group-row__chevron" aria-hidden="true">
            {visuallyExpanded || !row.collapsed ? "▾" : "▸"}
          </span>
        </span>
      </button>
    );
  }

  const tabDisabled = disabled || isClosing;
  const hoveredPreview = useMemo(
    () => ({ title: row.tab.title, url: row.tab.url }),
    [row.tab.title, row.tab.url]
  );

  return (
    <div
      className={getTabRowClassName({
        isCurrentActive,
        isWindowActive,
        isGrouped: groupedTabColor != null,
        isSelected,
        isClosing,
        isLocatePulsing,
        groupedTabColor,
        matchesSearch: row.matchesSearch
      }) + (tabDisabled ? " tab-row--disabled" : "")}
      onPointerEnter={(event) => {
        onPointerEnter(row, event);
        onHoveredTabChange?.(hoveredPreview);
      }}
      onPointerMove={(event) => onPointerMove(row, event)}
      onPointerUp={(event) => onPointerUp(row, event)}
      onPointerCancel={(event) => onPointerCancel(row, event)}
      onFocus={() => onHoveredTabChange?.(hoveredPreview)}
    >
      <button
        type="button"
        className="tab-row__main"
        role="treeitem"
        aria-level={groupedTabColor != null ? 3 : 2}
        aria-label={
          selectionMode
            ? row.tab.title
            : translate(locale, "sidepanel.tab.activate", {
                title: row.tab.title
              })
        }
        aria-current={isCurrentActive ? "page" : undefined}
        aria-selected={isSelected}
        onClick={(event) =>
          onActivateTab({
            tabId: row.tab.id,
            shiftKey: event.shiftKey,
            toggleKey: event.metaKey || event.ctrlKey
          })
        }
        onPointerDown={(event) => onPointerDown(row, event)}
        disabled={tabDisabled}
      >
        <span className="tab-row__favicon" aria-hidden="true">
          <TabFavicon pageUrl={row.tab.url} favIconUrl={row.tab.favIconUrl} />
        </span>
        <span className="tab-row__title">{row.tab.title}</span>
      </button>
      <div className="tab-row__actions" aria-hidden={tabDisabled ? "true" : undefined}>
        <button
          type="button"
          className={`tab-row__action${row.tab.pinned ? " tab-row__action--active" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onTogglePinned(row.tab.id, !row.tab.pinned);
          }}
          aria-label={row.tab.pinned ? translate(locale, "sidepanel.tab.unpin") : translate(locale, "sidepanel.tab.pin")}
          aria-pressed={row.tab.pinned}
          disabled={tabDisabled}
        >
          <Pin theme={row.tab.pinned ? "filled" : "outline"} size="16" />
        </button>
        <button
          type="button"
          className="tab-row__action"
          onClick={(event) => {
            event.stopPropagation();
            onCloseTab(row.tab.id);
          }}
          aria-label={translate(locale, "sidepanel.tab.close")}
          disabled={tabDisabled}
        >
          <CloseSmall theme="outline" size="16" />
        </button>
      </div>
    </div>
  );
}

function TabFavicon({
  pageUrl,
  favIconUrl
}: {
  pageUrl: string;
  favIconUrl: string | null;
}) {
  const candidates = buildTabFaviconCandidates(pageUrl, favIconUrl);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const activeCandidate = candidates[candidateIndex] ?? null;

  useEffect(() => {
    setCandidateIndex(0);
  }, [pageUrl, favIconUrl]);

  if (!activeCandidate) {
    return <span className="tab-row__favicon-placeholder" />;
  }

  return (
    <img
      src={activeCandidate}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setCandidateIndex((current) => current + 1)}
    />
  );
}
