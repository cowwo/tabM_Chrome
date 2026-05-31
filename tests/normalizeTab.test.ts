import { normalizeChromeTab } from "../src/shared/domain/normalizeTab";
import { NO_TAB_GROUP_ID } from "../src/shared/defaults";

describe("normalizeChromeTab", () => {
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

  it("keeps the raw favicon url for web pages", () => {
    const normalized = normalizeChromeTab({
      id: 1,
      windowId: 2,
      index: 0,
      title: "Example",
      url: "https://example.com/page",
      favIconUrl: "https://example.com/favicon.ico"
    } as chrome.tabs.Tab);

    expect(normalized?.favIconUrl).toBe("https://example.com/favicon.ico");
  });

  it("keeps safe internal favicon urls", () => {
    const normalized = normalizeChromeTab({
      id: 2,
      windowId: 2,
      index: 1,
      title: "Extension",
      url: "chrome-extension://abc/options.html",
      favIconUrl: "chrome-extension://abc/icon.png"
    } as chrome.tabs.Tab);

    expect(normalized?.favIconUrl).toBe("chrome-extension://abc/icon.png");
  });

  it("keeps the chrome group id", () => {
    const normalized = normalizeChromeTab({
      id: 20,
      windowId: 2,
      index: 1,
      groupId: 11,
      title: "Grouped",
      url: "https://example.com/grouped"
    } as chrome.tabs.Tab);

    expect(normalized?.groupId).toBe(11);
  });

  it("does not rewrite suspended extension pages back to original web pages", () => {
    const normalized = normalizeChromeTab({
      id: 3,
      windowId: 2,
      index: 2,
      title: "Suspended",
      url: "chrome-extension://suspender/suspended.html?ttl=Original%20Doc&url=https%3A%2F%2Fexample.com%2Fdoc",
      favIconUrl: "chrome-extension://suspender/icon.png"
    } as chrome.tabs.Tab);

    expect(normalized?.title).toBe("Suspended");
    expect(normalized?.url).toBe(
      "chrome-extension://suspender/suspended.html?ttl=Original%20Doc&url=https%3A%2F%2Fexample.com%2Fdoc"
    );
    expect(normalized?.favIconUrl).toBe("chrome-extension://suspender/icon.png");
  });

  it("keeps the current extension page data for suspended pages with hash params", () => {
    const normalized = normalizeChromeTab({
      id: 4,
      windowId: 2,
      index: 3,
      title: "Suspended hash",
      url: "chrome-extension://suspender/suspended.html#ttl=Hash%20Title&uri=https%3A%2F%2Fexample.com%2Fhash",
      favIconUrl: "chrome-extension://suspender/icon.png"
    } as chrome.tabs.Tab);

    expect(normalized?.title).toBe("Suspended hash");
    expect(normalized?.url).toBe(
      "chrome-extension://suspender/suspended.html#ttl=Hash%20Title&uri=https%3A%2F%2Fexample.com%2Fhash"
    );
    expect(normalized?.favIconUrl).toBe("chrome-extension://suspender/icon.png");
  });

  it("keeps original extension page data when suspended page parameters are invalid", () => {
    const normalized = normalizeChromeTab({
      id: 5,
      windowId: 2,
      index: 4,
      title: "Broken suspended page",
      url: "chrome-extension://suspender/suspended.html?url=not-a-valid-url",
      favIconUrl: "chrome-extension://suspender/icon.png"
    } as chrome.tabs.Tab);

    expect(normalized?.title).toBe("Broken suspended page");
    expect(normalized?.url).toBe("chrome-extension://suspender/suspended.html?url=not-a-valid-url");
    expect(normalized?.favIconUrl).toBe("chrome-extension://suspender/icon.png");
  });

  it("keeps data url favicons for file pages", () => {
    const normalized = normalizeChromeTab({
      id: 7,
      windowId: 3,
      index: 1,
      title: "Local file",
      url: "file:///Users/example/Documents/note.html",
      favIconUrl: "data:image/png;base64,AAAA"
    } as chrome.tabs.Tab);

    expect(normalized?.favIconUrl).toBe("data:image/png;base64,AAAA");
  });

  it("drops unsafe favicon urls for internal pages", () => {
    const normalized = normalizeChromeTab({
      id: 6,
      windowId: 3,
      index: 0,
      title: "Internal",
      url: "chrome://settings",
      favIconUrl: "https://unsafe.example.com/icon.png"
    } as chrome.tabs.Tab);

    expect(normalized?.favIconUrl).toBeNull();
    expect(normalized?.groupId).toBe(NO_TAB_GROUP_ID);
  });
});
