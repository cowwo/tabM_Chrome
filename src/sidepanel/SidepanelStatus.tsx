import { translate, type SupportedLocale } from "../shared/i18n";

export function SidepanelStatus({
  locale,
  errorMessage,
  isInteractive,
  isLoading,
  isResyncing,
  traceEnabled,
  traceEntryCount,
  traceUpdatedAt,
  onCopyDebugTrace,
  copyTraceState,
  duplicateToast,
  hasUsableSnapshot,
  totalTabCount
}: {
  locale: SupportedLocale;
  errorMessage: string | null;
  isInteractive: boolean;
  isLoading: boolean;
  isResyncing: boolean;
  traceEnabled?: boolean;
  traceEntryCount?: number;
  traceUpdatedAt?: string | null;
  onCopyDebugTrace?: () => void;
  copyTraceState?: "idle" | "success" | "error";
  duplicateToast?: string | null;
  hasUsableSnapshot?: boolean;
  totalTabCount?: number;
}) {
  if (isLoading) {
    return (
      <div className="loading-state" aria-live="polite">
        <p className="loading-state__title">{translate(locale, "sidepanel.loading.title")}</p>
        <p className="loading-state__body">
          {isResyncing
            ? translate(locale, "sidepanel.loading.bodyResync")
            : translate(locale, "sidepanel.loading.body")}
        </p>
      </div>
    );
  }

  if (!isInteractive && !errorMessage) {
    return (
      <div className="reconnecting-state" aria-live="polite">
        <p className="reconnecting-state__title">{translate(locale, "sidepanel.reconnecting.title")}</p>
        <p className="reconnecting-state__body">{translate(locale, "sidepanel.reconnecting.body")}</p>
      </div>
    );
  }

  if (hasUsableSnapshot && totalTabCount === 0) {
    return (
      <div className="empty-state" aria-live="polite">
        <p className="empty-state__title">{translate(locale, "sidepanel.list.emptyTitle")}</p>
        <p className="empty-state__body">{translate(locale, "sidepanel.list.emptyBody")}</p>
      </div>
    );
  }

  if (!errorMessage && !traceEnabled) {
    return null;
  }

  return (
    <>
      {traceEnabled ? (
        <div className="debug-state" role="status" aria-live="polite">
          <p className="debug-state__title">{translate(locale, "sidepanel.debug.title")}</p>
          <p className="debug-state__body">
            {translate(locale, "sidepanel.debug.body", {
              count: traceEntryCount ?? 0
            })}
          </p>
          {traceUpdatedAt ? (
            <p className="debug-state__hint">
              {translate(locale, "sidepanel.debug.updatedAt", {
                value: new Date(traceUpdatedAt).toLocaleString(locale)
              })}
            </p>
          ) : null}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="error-state" role="alert">
          <p className="error-state__title">{translate(locale, "sidepanel.error.title")}</p>
          <p className="error-state__body">{errorMessage}</p>
          <p className="error-state__hint">
            {isInteractive
              ? translate(locale, "sidepanel.error.hintInteractive")
              : translate(locale, "sidepanel.error.hintReconnecting")}
          </p>
          {onCopyDebugTrace ? (
            <>
              <button type="button" className="panel-toolbar__button" onClick={onCopyDebugTrace}>
                {translate(locale, "sidepanel.error.copyTrace")}
              </button>
              {copyTraceState === "success" ? <p className="error-state__hint">{translate(locale, "sidepanel.error.copyTraceSuccess")}</p> : null}
              {copyTraceState === "error" ? <p className="error-state__hint">{translate(locale, "sidepanel.error.copyTraceFailed")}</p> : null}
            </>
          ) : null}
        </div>
      ) : null}
      {duplicateToast ? (
        <div className="duplicate-toast" aria-live="polite">
          {duplicateToast}
        </div>
      ) : null}
    </>
  );
}
