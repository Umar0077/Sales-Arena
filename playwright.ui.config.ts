import { defineConfig } from "@playwright/test";

/**
 * UI-only browser tests that need NO database (and therefore no Docker): `npx playwright test -c playwright.ui.config.ts`.
 *
 * Starts its own dev server on port 3100 with DATABASE_URL blanked: the app then runs without PostgreSQL (its
 * documented no-database mode), Safe Quote figures are read-only, and each test answers the database-backed
 * endpoints it needs (settings, team standings, live stream) inside the browser. Nothing is written anywhere.
 * The full suite (playwright.config.ts) still needs the local dev database.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.ui\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    viewport: { width: 1920, height: 1080 },
    actionTimeout: 15_000,
    navigationTimeout: 120_000,
    launchOptions: {
      args: process.platform === "win32" ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    },
  },
  webServer: {
    command: "npx next dev -p 3100 -H 127.0.0.1",
    url: "http://127.0.0.1:3100/teams/team-alpha.webp",
    reuseExistingServer: true,
    timeout: 240_000,
    env: { DATABASE_URL: "", SALES_ARENA_SYNC_ENABLED: "false" },
  },
});
