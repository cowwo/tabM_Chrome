import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    headless: false,
  },
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || "/tmp/tabm-e2e/latest/test-results",
  reporter: [
    ["html", { outputFolder: process.env.PLAYWRIGHT_HTML_REPORT_DIR || "/tmp/tabm-e2e/latest/report" }],
    ["list"],
  ],
  globalSetup: "./tests/e2e/global-setup.ts",
});
