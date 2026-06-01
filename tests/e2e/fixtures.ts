import { chromium, test as base, type BrowserContext, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  connectSidepanelApi,
  openSidepanelPage,
  type SidepanelApi
} from "./helpers/sidepanel";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const distDir = resolve(rootDir, "..", "..", "dist");

export type E2eFixture = {
  extensionContext: BrowserContext;
  sidepanelPage: Page;
  sidepanelApi: SidepanelApi;
};

export const test = base.extend<E2eFixture>({
  extensionContext: async ({}, use) => {
    const isCI = Boolean(process.env.CI);
    const userDataDir = await mkdtemp(resolve(tmpdir(), "sidepanel-e2e-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        "/home/ff/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome",
      headless: true,
      args: [
        `--disable-extensions-except=${distDir}`,
        `--load-extension=${distDir}`,
        ...(isCI ? ["--no-sandbox", "--disable-gpu"] : [])
      ]
    });

    try {
      await use(context);
    } finally {
      await context.close();
      await rm(userDataDir, { recursive: true, force: true });
    }
  },

  sidepanelPage: async ({ extensionContext }, use) => {
    const { page } = await openSidepanelPage(extensionContext, distDir);
    await use(page);
    await page.close();
  },

  sidepanelApi: async ({ sidepanelPage }, use) => {
    const api = await connectSidepanelApi(sidepanelPage);
    await api.waitForInteractive();
    await use(api);
  }
});
