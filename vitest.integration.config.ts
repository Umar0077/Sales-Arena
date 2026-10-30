import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Database integration tests. They WIPE the target database between files, so the
// setup refuses to run unless TEST_DATABASE_URL points at a database named *_test.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
