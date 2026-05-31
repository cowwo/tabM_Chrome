import {
  buildChromeFaviconProxyUrl,
  buildTabFaviconCandidates,
  sanitizeTabFaviconUrl
} from "../src/shared/domain/favicon";

describe("sanitizeTabFaviconUrl", () => {
  it("keeps safe web page favicon urls", () => {
    expect(sanitizeTabFaviconUrl("https://example.com/page", "https://example.com/icon.png")).toBe(
      "https://example.com/icon.png"
    );
  });

  it("drops unsafe favicon urls on internal pages", () => {
    expect(sanitizeTabFaviconUrl("chrome://settings", "https://unsafe.example.com/icon.png")).toBeNull();
  });

  it("keeps safe internal favicon urls", () => {
    expect(sanitizeTabFaviconUrl("chrome-extension://abc/page.html", "chrome-extension://abc/icon.png")).toBe(
      "chrome-extension://abc/icon.png"
    );
  });
});

describe("buildChromeFaviconProxyUrl", () => {
  beforeEach(() => {
    vi.stubGlobal("chrome", {
      runtime: {
        getURL: (path: string) => `chrome-extension://unit-test/${path}`
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds proxy urls for web pages", () => {
    expect(buildChromeFaviconProxyUrl("https://example.com/page")).toBe(
      "chrome-extension://unit-test/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fpage&size=16"
    );
  });

  it("also builds proxy urls for chrome internal pages", () => {
    expect(buildChromeFaviconProxyUrl("chrome://extensions/")).toBe(
      "chrome-extension://unit-test/_favicon/?pageUrl=chrome%3A%2F%2Fextensions%2F&size=16"
    );
  });

  it("ignores unsupported protocols", () => {
    expect(buildChromeFaviconProxyUrl("data:text/plain,hello")).toBeNull();
    expect(buildChromeFaviconProxyUrl("blob:https://example.com/icon")).toBeNull();
  });
});

describe("buildTabFaviconCandidates", () => {
  beforeEach(() => {
    vi.stubGlobal("chrome", {
      runtime: {
        getURL: (path: string) => `chrome-extension://unit-test/${path}`
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tries the raw favicon first for web pages and then falls back to the proxy", () => {
    expect(buildTabFaviconCandidates("https://example.com/page", "https://example.com/icon.png")).toEqual([
      "https://example.com/icon.png",
      "chrome-extension://unit-test/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fpage&size=16"
    ]);
  });

  it("keeps raw favicon first and then tries the chrome proxy for internal pages", () => {
    expect(
      buildTabFaviconCandidates("chrome-extension://abc/page.html", "chrome-extension://abc/icon.png")
    ).toEqual([
      "chrome-extension://abc/icon.png",
      "chrome-extension://unit-test/_favicon/?pageUrl=chrome-extension%3A%2F%2Fabc%2Fpage.html&size=16"
    ]);
  });

  it("drops unsafe raw favicon urls and still returns the proxy fallback", () => {
    expect(buildTabFaviconCandidates("chrome://settings", "https://unsafe.example.com/icon.png")).toEqual([
      "chrome-extension://unit-test/_favicon/?pageUrl=chrome%3A%2F%2Fsettings&size=16"
    ]);
  });

  it("deduplicates identical candidates", () => {
    const candidate =
      "chrome-extension://unit-test/_favicon/?pageUrl=https%3A%2F%2Fexample.com&size=16";

    expect(buildTabFaviconCandidates("https://example.com", candidate)).toEqual([candidate]);
  });
});
