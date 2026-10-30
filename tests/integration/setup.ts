import { readFileSync, existsSync } from "node:fs";

// Load TEST_DATABASE_URL from .env.test.local when not already set (never printed).
if (!process.env.TEST_DATABASE_URL && existsSync(".env.test.local")) {
  for (const line of readFileSync(".env.test.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^TEST_DATABASE_URL=(.+)$/);
    if (m) process.env.TEST_DATABASE_URL = m[1].trim();
  }
}

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is not set. Integration tests need an isolated *_test database.");
const dbName = new URL(url).pathname.replace(/^\//, "");
if (!/_test$/.test(dbName)) {
  throw new Error(`Refusing to run destructive integration tests against "${dbName}": the database name must end with _test.`);
}

// The app code reads DATABASE_URL; point it at the test database only.
process.env.DATABASE_URL = url;
process.env.SALES_ARENA_TIMEZONE = "America/New_York";
process.env.APP_ORIGIN = "http://arena.test";
delete process.env.SALES_ARENA_API_TOKEN;
