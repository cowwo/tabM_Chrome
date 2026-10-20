import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyDocumentLocale,
  getUiLanguage,
  resolveLocale,
  translate,
  type TranslationKey
} from "../shared/i18n";
import type { PanelToBackgroundMessage } from "../shared/messages";
import {
  DEFAULT_EXTENSION_SETTINGS,
  EXTENSION_SETTINGS_STORAGE_KEY,
  loadExtensionSettings,
  mergeExtensionSettings,
  resetExtensionSettings,
  saveExtensionSettings
} from "../shared/settings";
import type {
  ExtensionSettingsRecord,
  LocaleMode,
  TabDisplaySize,
  TraceSettingsRecord
} from "../shared/types";
import {
  createPanelPortAdapter,
  type PanelPortAdapter,
  type TraceBundlePayload
} from "../sidepanel/panelPortAdapter";

const LANGUAGE_OPTIONS: LocaleMode[] = ["system", "zh-CN", "en"];
const TAB_DISPLAY_SIZE_OPTIONS: readonly TabDisplaySize[] = ["large", "medium", "small"];

interface DebugTraceState {
  settings: TraceSettingsRecord;
  entryCount: number;
  updatedAt: string | null;
}

export default function App() {
  const [settings, setSettings] = useState<ExtensionSettingsRecord>(DEFAULT_EXTENSION_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [traceState, setTraceState] = useState<DebugTraceState | null>(null);
  const [traceUnavailable, setTraceUnavailable] = useState(false);
  const tracePortAdapterRef = useRef<PanelPortAdapter | null>(null);
  const manifest = chrome.runtime.getManifest();
  const locale = useMemo(
    () => resolveLocale({ settings, uiLanguage: getUiLanguage() }),
    [settings]
  );

  useEffect(() => {
    applyDocumentLocale({
      locale,
      titleKey: "app.settingsTitle"
    });

    let disposed = false;

    const initialize = async () => {
      const nextSettings = await loadExtensionSettings();
      if (disposed) {
        return;
      }

      setSettings(nextSettings);
      setLoading(false);
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
      setLoading(false);
    };

    void initialize();
    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      disposed = true;
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [locale]);

  useEffect(() => {
    let disposed = false;

    const portAdapter = createPanelPortAdapter({
      onMessage: (message) => {
        if (message.type !== "debug/trace-state") {
          return;
        }

        if (disposed) {
          return;
        }

        setTraceState(message.payload);
        setTraceUnavailable(false);
      },
      onConnectionFailed: () => {
        if (!disposed) {
          setTraceUnavailable(true);
        }
      },
      onDisconnected: () => {
        if (!disposed) {
          setTraceUnavailable(true);
        }
      }
    });

    tracePortAdapterRef.current = portAdapter;
    portAdapter.connect();

    return () => {
      disposed = true;
      portAdapter.disconnect();
      if (tracePortAdapterRef.current === portAdapter) {
        tracePortAdapterRef.current = null;
      }
    };
  }, []);

  async function handleBadgeEnabledChange(enabled: boolean): Promise<void> {
    const nextSettings = await saveExtensionSettings({
      ...settings,
      badge: {
        ...settings.badge,
        enabled
      }
    });
    setSettings(nextSettings);
  }

  async function handleLocaleModeChange(mode: LocaleMode): Promise<void> {
    const nextSettings = await saveExtensionSettings({
      ...settings,
      locale: {
        mode
      }
    });
    setSettings(nextSettings);
  }

  async function handleTabDisplaySizeChange(tabDisplaySize: TabDisplaySize): Promise<void> {
    const nextSettings = await saveExtensionSettings({
      ...settings,
      display: {
        ...settings.display,
        tabDisplaySize
      }
    });
    setSettings(nextSettings);
  }

  async function handleHoveredTabPreviewEnabledChange(hoveredTabPreviewEnabled: boolean): Promise<void> {
    const optimisticSettings: ExtensionSettingsRecord = {
      ...settings,
      display: {
        ...settings.display,
        hoveredTabPreviewEnabled
      }
    };
    setSettings(optimisticSettings);

    const nextSettings = await saveExtensionSettings(optimisticSettings);
    setSettings(nextSettings);
  }

  async function handleResetSettings(): Promise<void> {
    const nextSettings = await resetExtensionSettings();
    setSettings(nextSettings);
  }

  function handleVerboseLoggingEnabledChange(enabled: boolean): void {
    const didPost =
      tracePortAdapterRef.current?.postMessage({
        type: "debug/set-trace-settings",
        payload: {
          verboseLoggingEnabled: enabled
        }
      } satisfies PanelToBackgroundMessage) ?? false;

    if (!didPost) {
      setTraceUnavailable(true);
    }
  }

  async function handleExportTrace(): Promise<void> {
    try {
      const portAdapter = tracePortAdapterRef.current;
      if (!portAdapter) {
        setTraceUnavailable(true);
        return;
      }

      const bundle = await portAdapter.requestTraceBundle();
      const timestamp = createExportTimestamp();
      downloadTextFile(
        `sidepanel-trace-${timestamp}.json`,
        buildTraceExportJson(bundle),
        "application/json"
      );
      downloadTextFile(
        `sidepanel-trace-${timestamp}.timeline.txt`,
        bundle.timelineText,
        "text/plain;charset=utf-8"
      );
      setTraceUnavailable(false);
    } catch {
      setTraceUnavailable(true);
    }
  }

  function handleClearTrace(): void {
    const didPost =
      tracePortAdapterRef.current?.postMessage({
        type: "debug/clear-trace"
      } satisfies PanelToBackgroundMessage) ?? false;

    if (!didPost) {
      setTraceUnavailable(true);
    }
  }

  const t = (key: TranslationKey, values?: Record<string, string | number>) =>
    translate(locale, key, values);
  const traceControlsDisabled = loading || traceState == null || traceUnavailable;
  const verboseStateKey: TranslationKey = traceState?.settings.verboseLoggingEnabled
    ? "trace.timeline.verbose.enabled"
    : "trace.timeline.verbose.disabled";

  return (
    <main className="page">
      <header className="page__hd">
        <h1 className="page__title">{t("options.title")}</h1>
        <p className="page__desc">{t("options.description")}</p>
      </header>

      <div className="panel">

        {/* ── Language ── */}
        <section className="group">
          <h2 className="group__title">{t("options.section.language.title")}</h2>
          <p className="group__desc">{t("options.section.language.description")}</p>
          <label className="item" htmlFor="locale-mode">
            <div className="item__copy">
              <span className="item__label">{t("options.language.label")}</span>
              <span className="item__hint">{t("options.language.hint")}</span>
            </div>
            <div className="sel">
              <select
                id="locale-mode"
                className="sel__ctrl"
                value={settings.locale.mode}
                onChange={(event) => {
                  void handleLocaleModeChange(event.target.value as LocaleMode);
                }}
                disabled={loading}
              >
                {LANGUAGE_OPTIONS.map((mode) => (
                  <option key={mode} value={mode}>
                    {t(`options.language.option.${mode}` as TranslationKey)}
                  </option>
                ))}
              </select>
            </div>
          </label>
        </section>

        {/* ── Badge ── */}
        <section className="group">
          <h2 className="group__title">{t("options.section.badge.title")}</h2>
          <p className="group__desc">{t("options.section.badge.description")}</p>
          <label className="item" htmlFor="badge-enabled">
            <div className="item__copy">
              <span className="item__label">{t("options.badge.label")}</span>
              <span className="item__hint">{t("options.badge.hint")}</span>
            </div>
            <div className="check">
              <input
                id="badge-enabled"
                className="check__input"
                type="checkbox"
                checked={settings.badge.enabled}
                onChange={(event) => {
                  void handleBadgeEnabledChange(event.target.checked);
                }}
                disabled={loading}
              />
              <span className="check__box" aria-hidden="true" />
            </div>
          </label>
        </section>

        {/* ── UI ── */}
        <section className="group">
          <h2 className="group__title">{t("options.section.ui.title")}</h2>
          <p className="group__desc">{t("options.section.ui.description")}</p>
          <label className="item" htmlFor="hovered-tab-preview-enabled">
            <div className="item__copy">
              <span className="item__label">{t("options.hoveredTabPreview.label")}</span>
              <span className="item__hint">{t("options.hoveredTabPreview.hint")}</span>
            </div>
            <div className="check">
              <input
                id="hovered-tab-preview-enabled"
                className="check__input"
                type="checkbox"
                checked={settings.display.hoveredTabPreviewEnabled}
                onChange={(event) => {
                  void handleHoveredTabPreviewEnabledChange(event.target.checked);
                }}
                disabled={loading}
              />
              <span className="check__box" aria-hidden="true" />
            </div>
          </label>
          <div className="item item--seg" role="group" aria-labelledby="size-label">
            <div className="item__copy">
              <span id="size-label" className="item__label">{t("options.displaySize.label")}</span>
              <span className="item__hint">{t("options.displaySize.hint")}</span>
            </div>
            <div className="seg" role="radiogroup" aria-label={t("options.displaySize.label")}>
              {TAB_DISPLAY_SIZE_OPTIONS.map((size) => (
                <button
                  key={size}
                  type="button"
                  role="radio"
                  data-testid={`display-size-${size}`}
                  aria-checked={settings.display.tabDisplaySize === size}
                  className={`seg__btn${settings.display.tabDisplaySize === size ? " seg__btn--on" : ""}`}
                  onClick={() => {
                    void handleTabDisplaySizeChange(size);
                  }}
                  disabled={loading}
                >
                  {t(`options.displaySize.option.${size}` as TranslationKey)}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ── Search ── */}
        <section className="group">
          <h2 className="group__title">{t("options.section.search.title")}</h2>
          <p className="group__desc">{t("options.section.search.description")}</p>
          <div className="ph">
            <span className="ph__text">{t("options.comingSoon")}</span>
          </div>
        </section>

        {/* ── Debug ── */}
        <section className="group">
          <h2 className="group__title">{t("options.section.debug.title")}</h2>
          <p className="group__desc">{t("options.section.debug.description")}</p>
          <label className="item" htmlFor="debug-verbose-logging">
            <div className="item__copy">
              <span className="item__label">{t("options.debug.logging.label")}</span>
              <span className="item__hint">{t("options.debug.logging.hint")}</span>
            </div>
            <div className="check">
              <input
                id="debug-verbose-logging"
                className="check__input"
                type="checkbox"
                checked={traceState?.settings.verboseLoggingEnabled ?? false}
                onChange={(event) => {
                  handleVerboseLoggingEnabledChange(event.target.checked);
                }}
                disabled={traceControlsDisabled}
              />
              <span className="check__box" aria-hidden="true" />
            </div>
          </label>
          <div className="debug" aria-live="polite">
            <span className="debug__item">
              {t("trace.timeline.verbose", { value: t(verboseStateKey) })}
            </span>
            <span className="debug__item">
              {t("options.debug.entryCount", { count: traceState?.entryCount ?? 0 })}
            </span>
            <span className="debug__item">
              {traceState?.updatedAt
                ? t("options.debug.updatedAt", {
                    value: new Date(traceState.updatedAt).toLocaleString(locale)
                  })
                : t("options.debug.updatedAt.empty")}
            </span>
            {traceUnavailable ? (
              <span className="debug__item debug__item--warn">{t("options.debug.connectionUnavailable")}</span>
            ) : null}
          </div>
          <div className="acts">
            <button
              type="button"
              className="acts__btn"
              onClick={() => { void handleExportTrace(); }}
              disabled={traceControlsDisabled}
            >
              {t("sidepanel.toolbar.exportTrace")}
            </button>
            <button
              type="button"
              className="acts__btn"
              onClick={handleClearTrace}
              disabled={traceControlsDisabled}
            >
              {t("sidepanel.toolbar.clearTrace")}
            </button>
          </div>
        </section>

        {/* ── About ── */}
        <section className="group">
          <h2 className="group__title">{t("options.section.about.title")}</h2>
          <p className="group__desc">{t("options.section.about.description")}</p>
          <div className="item item--flat" aria-live="polite">
            <span className="item__label">{t("options.about.name")}</span>
            <span className="item__val">{t("app.extensionName")}</span>
          </div>
          <div className="item item--flat">
            <span className="item__label">{t("options.about.version")}</span>
            <span className="item__val">{manifest.version}</span>
          </div>
        </section>

      </div>

      <footer className="page__ft">
        <button
          type="button"
          className="page__reset"
          onClick={() => { void handleResetSettings(); }}
          disabled={loading}
        >
          {t("options.reset")}
        </button>
      </footer>
    </main>
  );
}

function createExportTimestamp(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
}

function downloadTextFile(fileName: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildTraceExportJson(bundle: TraceBundlePayload): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      settings: bundle.settings,
      updatedAt: bundle.updatedAt,
      entries: bundle.entries
    },
    null,
    2
  );
}
