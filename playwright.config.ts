import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10000,
    navigationTimeout: 15000,
    // Let headless Chromium render the 3D wheel: real GPU on Windows, software WebGL elsewhere.
    launchOptions: {
      args:
        process.platform === "win32"
          ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"]
          : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    },
    contextOptions: {
      reducedMotion: "reduce",
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
