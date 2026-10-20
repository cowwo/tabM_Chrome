import { CloseSmall, Filter, Star } from "@icon-park/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { translate, type SupportedLocale } from "../shared/i18n";
import type { ToolbarTooltipPlacement } from "./toolbarTooltip";
import type { SearchFilterMode } from "../shared/types";

interface SearchBarProps {
  searchTerm: string;
  filterMode: SearchFilterMode;
  matchCount: number;
  disabled?: boolean;
  onSearchChange: (term: string) => void;
  onFilterModeChange: (mode: SearchFilterMode) => void;
  onClearSearch: () => void;
  onTraceEvent?: (event: string, details: Record<string, unknown>) => void;
}

type SearchTooltipType = "clear" | "mode";

interface SearchTooltipState {
  type: SearchTooltipType;
  anchor: HTMLButtonElement;
}

export function SearchBar({
  locale,
  searchTerm,
  filterMode,
  matchCount,
  disabled = false,
  onSearchChange,
  onFilterModeChange,
  onClearSearch,
  onTraceEvent
}: SearchBarProps & {
  locale: SupportedLocale;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const searchBarRef = useRef<HTMLDivElement>(null);
  const [searchTooltip, setSearchTooltip] = useState<SearchTooltipState | null>(null);
  const [searchTooltipPlacement, setSearchTooltipPlacement] = useState<ToolbarTooltipPlacement | null>(null);
  const searchTooltipRef = useRef<HTMLDivElement | null>(null);

  const updateSearchTooltipPlacement = useCallback(() => {
    if (!searchTooltip || !searchBarRef.current || !searchTooltipRef.current) {
      setSearchTooltipPlacement(null);
      return;
    }

    if (!searchTerm.trim() || !document.body.contains(searchTooltip.anchor)) {
      setSearchTooltip(null);
      setSearchTooltipPlacement(null);
      return;
    }

    const anchorRect = searchTooltip.anchor.getBoundingClientRect();
    const tooltipRect = searchTooltipRef.current.getBoundingClientRect();
    const GAP = 20;
    const MARGIN = 8;

    let left = anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - tooltipRect.width - MARGIN));

    setSearchTooltipPlacement({
      left,
      top: anchorRect.top - GAP - tooltipRect.height,
      placement: "top"
    });
  }, [searchTerm, searchTooltip]);

  const handleClear = useCallback(() => {
    hideSearchTooltip();
    onTraceEvent?.("panel/search-cleared", {
      previousSearchTerm: searchTerm,
      filterMode,
      matchCount
    });
    onClearSearch();
    onSearchChange("");
  }, [filterMode, matchCount, onClearSearch, onSearchChange, onTraceEvent, searchTerm]);

  const handleToggleMode = useCallback(() => {
    hideSearchTooltip();
    const nextMode = filterMode === "filter" ? "highlight" : "filter";
    onTraceEvent?.("panel/search-filter-mode-changed", {
      searchTerm,
      previousMode: filterMode,
      nextMode,
      matchCount
    });
    onFilterModeChange(nextMode);
  }, [filterMode, matchCount, onFilterModeChange, onTraceEvent, searchTerm]);

  function showSearchTooltip(type: SearchTooltipType, anchor: HTMLButtonElement): void {
    setSearchTooltip({ type, anchor });
  }

  function hideSearchTooltip(): void {
    setSearchTooltip(null);
    setSearchTooltipPlacement(null);
  }

  useLayoutEffect(() => {
    updateSearchTooltipPlacement();
  }, [updateSearchTooltipPlacement]);

  useEffect(() => {
    if (!searchTooltip) {
      return;
    }
    const handleResize = () => {
      updateSearchTooltipPlacement();
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [searchTooltip, updateSearchTooltipPlacement]);

  const showSearch = searchTerm.trim().length > 0;

  useEffect(() => {
    if (!showSearch) {
      setSearchTooltip(null);
      setSearchTooltipPlacement(null);
    }
  }, [showSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      onTraceEvent?.("panel/search-updated", {
        searchTerm,
        filterMode,
        matchCount,
        active: searchTerm.trim().length > 0
      });
    }, 350);

    return () => {
      window.clearTimeout(timer);
    };
  }, [filterMode, matchCount, onTraceEvent, searchTerm]);

  const modeToggleLabel =
    filterMode === "filter"
      ? translate(locale, "sidepanel.search.filter")
      : translate(locale, "sidepanel.search.highlight");

  const searchTooltipLabel = searchTooltip
    ? searchTooltip.type === "clear"
      ? translate(locale, "sidepanel.search.clear")
      : modeToggleLabel
    : null;

  return (
    <>
      <div ref={searchBarRef} className="search-bar">
        <div className="search-bar__input-wrapper">
          <input
            ref={inputRef}
            type="text"
            className="search-bar__input"
            placeholder={translate(locale, "sidepanel.search.placeholder")}
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            disabled={disabled}
            aria-label={translate(locale, "sidepanel.search.input")}
          />
          {showSearch && (
            <button
              type="button"
              className="search-bar__button"
              onPointerDown={hideSearchTooltip}
              onClick={handleClear}
              onPointerEnter={(event) => showSearchTooltip("clear", event.currentTarget)}
              onPointerLeave={hideSearchTooltip}
              onFocus={(event) => showSearchTooltip("clear", event.currentTarget)}
              onBlur={hideSearchTooltip}
              disabled={disabled}
              aria-label={translate(locale, "sidepanel.search.clear")}
            >
              <CloseSmall theme="outline" size="14" />
            </button>
          )}
        </div>

        {showSearch && (
          <>
            <span className="search-bar__count">
              {translate(locale, "sidepanel.search.matchCount", {
                count: matchCount
              })}
            </span>

            <button
              type="button"
              data-testid="search-filter-mode-toggle"
              className={`search-bar__button${filterMode === "highlight" ? " search-bar__button--active" : ""}`}
              onPointerDown={hideSearchTooltip}
              onClick={handleToggleMode}
              onPointerEnter={(event) => showSearchTooltip("mode", event.currentTarget)}
              onPointerLeave={hideSearchTooltip}
              onFocus={(event) => showSearchTooltip("mode", event.currentTarget)}
              onBlur={hideSearchTooltip}
              disabled={disabled}
              aria-label={modeToggleLabel}
            >
              {filterMode === "filter" ? (
                <Filter theme="outline" size="14" />
              ) : (
                <Star theme="outline" size="14" />
              )}
            </button>
          </>
        )}
      </div>

      {showSearch && searchTooltip && searchTooltipLabel && (
        <div
          ref={searchTooltipRef}
          className={`search-bar-tooltip${searchTooltipPlacement ? " search-bar-tooltip--visible" : ""}`}
          data-placement={searchTooltipPlacement?.placement ?? "top"}
          style={{
            left: searchTooltipPlacement ? `${searchTooltipPlacement.left}px` : "-9999px",
            top: searchTooltipPlacement ? `${searchTooltipPlacement.top}px` : "-9999px"
          }}
          role="tooltip"
        >
          {searchTooltipLabel}
        </div>
      )}
    </>
  );
}

export function focusSearchInput(): void {
  const input = document.querySelector(".search-bar__input") as HTMLInputElement | null;
  input?.focus();
}
