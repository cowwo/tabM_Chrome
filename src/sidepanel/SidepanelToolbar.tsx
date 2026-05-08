import { Delete, Refresh, SettingTwo, ExpandDownOne, FoldUpOne, ListCheckbox, CloseSmall, Aiming, MonitorOne, Intersection } from "@icon-park/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { translate, type SupportedLocale } from "../shared/i18n";
import { resolveBulkToggleToolbarAction } from "./toolbarActions";
import { calculateToolbarTooltipPlacement, type ToolbarTooltipPlacement } from "./toolbarTooltip";


interface ToolbarTooltipState {
  actionKey: string;
  anchor: HTMLButtonElement;
}

interface HoveredTabPreview {
  title: string;
  url: string;
}

interface ToolbarAction {
  key: string;
  label: string;
  icon: typeof Refresh;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}

function renderToolbarButton(
  action: ToolbarAction,
  params: {
    disabled: boolean;
    hideToolbarTooltip: () => void;
    showToolbarTooltip: (actionKey: string, anchor: HTMLButtonElement) => void;
  }
): ReactElement {
  const { key, label, icon: Icon, onClick, active = false, disabled = false } = action;
  const buttonDisabled = params.disabled || disabled;

  return (
    <button
      key={key}
      type="button"
      className={`panel-toolbar__button${active ? " panel-toolbar__button--active" : ""}`}
      onClick={() => {
        if (buttonDisabled) {
          return;
        }
        onClick();
      }}
      onPointerEnter={(event) => params.showToolbarTooltip(key, event.currentTarget)}
      onPointerLeave={params.hideToolbarTooltip}
      onFocus={(event) => params.showToolbarTooltip(key, event.currentTarget)}
      onBlur={params.hideToolbarTooltip}
      aria-label={label}
      aria-disabled={buttonDisabled}
      data-disabled={buttonDisabled ? "true" : undefined}
      tabIndex={buttonDisabled ? -1 : 0}
    >
      <Icon theme="outline" size="18" />
    </button>
  );
}

export function SidepanelToolbar({
  hoveredTabPreview,
  locale,
  appShellRef,
  selectedCount,
  hasCollapsedWindows,
  hasCollapsedGroups,
  disabled,
  onResync,
  onSelectDuplicates,
  onLocateCurrentPage,
  canLocateCurrentPage,
  locateCurrentPageDisabledReasonKey,
  onOpenSettings,
  onExpandAll,
  onCollapseAll,
  onCloseSelected,
  moveToNewWindowCount,
  onMoveToNewWindow,
  selectionMode,
  onToggleSelectionMode
}: {
  hoveredTabPreview: HoveredTabPreview | null;
  locale: SupportedLocale;
  appShellRef: React.RefObject<HTMLDivElement | null>;
  selectedCount: number;
  hasCollapsedWindows: boolean;
  hasCollapsedGroups: boolean;
  disabled: boolean;
  onResync: () => void;
  onSelectDuplicates: () => void;
  onLocateCurrentPage: () => void;
  canLocateCurrentPage: boolean;
  locateCurrentPageDisabledReasonKey: "sidepanel.toolbar.locateCurrentPageUnavailable" | null;
  onOpenSettings: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onCloseSelected: () => void;
  moveToNewWindowCount: number;
  onMoveToNewWindow: () => void;
  selectionMode: boolean;
  onToggleSelectionMode: () => void;
}) {
  const [toolbarTooltip, setToolbarTooltip] = useState<ToolbarTooltipState | null>(null);
  const [toolbarTooltipPlacement, setToolbarTooltipPlacement] = useState<ToolbarTooltipPlacement | null>(null);
  const toolbarTooltipRef = useRef<HTMLDivElement | null>(null);

  const bulkToggleAction = resolveBulkToggleToolbarAction(
    {
      hasCollapsedWindows,
      hasCollapsedGroups
    },
    locale
  );

  const leadingToolbarActions: ToolbarAction[] = [
    {
      key: selectionMode ? "selection-cancel" : "selection-start",
      label: translate(locale, selectionMode ? "sidepanel.toolbar.selection.cancel" : "sidepanel.toolbar.selection.start"),
      icon: selectionMode ? CloseSmall : ListCheckbox,
      onClick: onToggleSelectionMode,
      active: selectionMode
    },
    {
      key: "select-duplicates",
      label: translate(locale, disabled ? "sidepanel.toolbar.selectDuplicates.disabled" : "sidepanel.toolbar.selectDuplicates"),
      icon: Intersection,
      onClick: onSelectDuplicates,
      disabled: disabled
    },
    {
      key: "resync",
      label: translate(locale, "sidepanel.toolbar.resync"),
      icon: Refresh,
      onClick: onResync
    },
    {
      key: "locate-current-page",
      label: locateCurrentPageDisabledReasonKey
        ? translate(locale, locateCurrentPageDisabledReasonKey)
        : translate(locale, "sidepanel.toolbar.locateCurrentPage"),
      icon: Aiming,
      onClick: onLocateCurrentPage,
      disabled: !canLocateCurrentPage
    },
    {
      key: "toggle-all",
      label: bulkToggleAction.label,
      icon: bulkToggleAction.mode === "expand" ? ExpandDownOne : FoldUpOne,
      onClick: bulkToggleAction.mode === "expand" ? onExpandAll : onCollapseAll
    },
    ...(moveToNewWindowCount > 0
      ? [
          {
            key: "move-to-new-window",
            label: translate(locale, "sidepanel.toolbar.moveToNewWindow", {
              count: moveToNewWindowCount
            }),
            icon: MonitorOne,
            onClick: onMoveToNewWindow
          }
        ]
      : []),
    ...(selectedCount > 0
      ? [
          {
            key: "close-selected",
            label: translate(locale, "sidepanel.toolbar.closeSelected", {
              count: selectedCount
            }),
            icon: Delete,
            onClick: onCloseSelected
          }
        ]
      : [])
  ];
  const trailingToolbarActions: ToolbarAction[] = [
    {
      key: "settings",
      label: translate(locale, "sidepanel.toolbar.settings"),
      icon: SettingTwo,
      onClick: onOpenSettings
    }
  ];
  const toolbarActions = [...leadingToolbarActions, ...trailingToolbarActions];

  const toolbarActionLabelByKey = useMemo(
    () => new Map(toolbarActions.map((action) => [action.key, action.label])),
    [toolbarActions]
  );
  const toolbarTooltipLabel = toolbarTooltip
    ? (toolbarActionLabelByKey.get(toolbarTooltip.actionKey) ?? null)
    : null;

  const updateToolbarTooltipPlacement = useCallback(() => {
    if (!toolbarTooltip || !appShellRef.current || !toolbarTooltipRef.current) {
      setToolbarTooltipPlacement(null);
      return;
    }

    const nextPlacement = calculateToolbarTooltipPlacement({
      anchorRect: toolbarTooltip.anchor.getBoundingClientRect(),
      tooltipSize: toolbarTooltipRef.current.getBoundingClientRect(),
      containerRect: appShellRef.current.getBoundingClientRect()
    });
    setToolbarTooltipPlacement(nextPlacement);
  }, [appShellRef, toolbarTooltip]);

  useLayoutEffect(() => {
    updateToolbarTooltipPlacement();
  }, [updateToolbarTooltipPlacement]);

  useEffect(() => {
    if (!toolbarTooltip) {
      return;
    }

    const handleResize = () => {
      updateToolbarTooltipPlacement();
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [toolbarTooltip, updateToolbarTooltipPlacement]);

  function showToolbarTooltip(actionKey: string, anchor: HTMLButtonElement): void {
    setToolbarTooltip({
      actionKey,
      anchor
    });
  }

  function hideToolbarTooltip(): void {
    setToolbarTooltip(null);
    setToolbarTooltipPlacement(null);
  }

  return (
    <>
      <div className="panel-toolbar">
        <div className="panel-toolbar__primary">
          {selectedCount > 0 ? (
            <div className="panel-toolbar__selection" aria-live="polite">
              {translate(locale, "sidepanel.toolbar.selectedCount", {
                count: selectedCount
              })}
            </div>
          ) : null}
          <div className="panel-toolbar__actions" role="toolbar" aria-label={translate(locale, "sidepanel.toolbar.aria")}>
            {leadingToolbarActions.map((action) =>
              renderToolbarButton(action, {
                disabled,
                hideToolbarTooltip,
                showToolbarTooltip
              })
            )}
          </div>
        </div>
        {hoveredTabPreview ? (
          <div className="panel-toolbar__hovered-tab" aria-live="polite">
            <span className="panel-toolbar__hovered-tab-title">{hoveredTabPreview.title}</span>
            <span className="panel-toolbar__hovered-tab-url">{hoveredTabPreview.url}</span>
          </div>
        ) : null}
        <div className="panel-toolbar__actions panel-toolbar__actions--end">
          {trailingToolbarActions.map((action) =>
            renderToolbarButton(action, {
              disabled,
              hideToolbarTooltip,
              showToolbarTooltip
            })
          )}
        </div>
      </div>
      {toolbarTooltip && toolbarTooltipLabel ? (
        <div
          ref={toolbarTooltipRef}
          className={`panel-toolbar-tooltip${toolbarTooltipPlacement ? " panel-toolbar-tooltip--visible" : ""}`}
          data-placement={toolbarTooltipPlacement?.placement ?? "bottom"}
          style={{
            left: toolbarTooltipPlacement ? `${toolbarTooltipPlacement.left}px` : "-9999px",
            top: toolbarTooltipPlacement ? `${toolbarTooltipPlacement.top}px` : "-9999px"
          }}
          role="tooltip"
        >
          {toolbarTooltipLabel}
        </div>
      ) : null}
    </>
  );
}
