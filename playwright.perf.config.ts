import { defineConfig } from "@playwright/test";
import base from "./playwright.ui.config";

/**
 * Celebration reliability / low-end simulations against the PRODUCTION build (no database, nothing written):
 *
 *   npm run build && npx playwright test -c playwright.perf.config.ts
 *
 * Same tests as the database-free UI suite's reliability spec, but served by `next start` (optimised React), so
 * the CPU-throttled numbers reflect what office displays run. Port 3101, so it never collides with the UI suite.
 */
export default defineConfig({
  ...base,
  testMatch: /celebration-reliability\.ui\.spec\.ts$/,
  use: { ...base.use, baseURL: "http://127.0.0.1:3101" },
  webServer: {
    command: "npx next start -p 3101 -H 127.0.0.1",
    url: "http://127.0.0.1:3101/teams/team-alpha.webp",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: "", SALES_ARENA_SYNC_ENABLED: "false" },
  },
});
