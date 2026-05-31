export function sanitizeTabFaviconUrl(
  pageUrl: string,
  rawFaviconUrl: string | null | undefined
): string | null {
  if (!rawFaviconUrl) {
    return null;
  }

  try {
    const faviconUrl = new URL(rawFaviconUrl);

    if (isSafeInternalFaviconProtocol(faviconUrl.protocol)) {
      return rawFaviconUrl;
    }

    if (isWebPageUrl(pageUrl) && isSafeWebFaviconProtocol(faviconUrl.protocol)) {
      return rawFaviconUrl;
    }
  } catch {
    return null;
  }

  return null;
}

export function buildTabFaviconCandidates(pageUrl: string, favIconUrl: string | null): string[] {
  const candidates: string[] = [];
  const sanitizedFaviconUrl = sanitizeTabFaviconUrl(pageUrl, favIconUrl);

  if (sanitizedFaviconUrl) {
    candidates.push(sanitizedFaviconUrl);
  }

  const proxyCandidate = buildChromeFaviconProxyUrl(pageUrl);
  if (proxyCandidate) {
    candidates.push(proxyCandidate);
  }

  return dedupe(candidates);
}

export function buildChromeFaviconProxyUrl(pageUrl: string): string | null {
  if (!supportsChromeFaviconProxy(pageUrl)) {
    return null;
  }

  const baseUrl =
    typeof chrome !== "undefined" && typeof chrome.runtime?.getURL === "function"
      ? chrome.runtime.getURL("_favicon/")
      : "/_favicon/";

  return `${baseUrl}?pageUrl=${encodeURIComponent(pageUrl)}&size=16`;
}

function supportsChromeFaviconProxy(pageUrl: string): boolean {
  try {
    const url = new URL(pageUrl);
    return (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "file:" ||
      url.protocol === "chrome:" ||
      url.protocol === "chrome-extension:"
    );
  } catch {
    return false;
  }
}

function isWebPageUrl(value: string): boolean {
  return /^(https?|file):/i.test(value);
}

function isSafeWebFaviconProtocol(protocol: string): boolean {
  return protocol === "http:" || protocol === "https:";
}

function isSafeInternalFaviconProtocol(protocol: string): boolean {
  return (
    protocol === "chrome:" ||
    protocol === "chrome-extension:" ||
    protocol === "data:" ||
    protocol === "blob:"
  );
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
