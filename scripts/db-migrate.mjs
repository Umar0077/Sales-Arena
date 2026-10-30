#!/usr/bin/env node
// Sales Arena database migrations.
//
//   node --env-file=.env.staging scripts/db-migrate.mjs status
//   node --env-file=.env.staging scripts/db-migrate.mjs up
//
// Uses DATABASE_URL (or --database-url=...). Before applying, it prints the target
// host/database and asks for confirmation unless --yes is passed. It never runs
// automatically on deploy or app start.

import pg from "pg";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { runMigrations, migrationStatus } from "../lib/server/db/migrate-core.mjs";

const args = process.argv.slice(2);
const cmd = args.find((a) => !a.startsWith("--")) ?? "status";
const flag = (name) => args.some((a) => a === `--${name}`);
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const url = opt("database-url") ?? process.env.DATABASE_URL;

if (!url) {
  console.error("DATABASE_URL is not set. Pass --env-file=<file> to node or --database-url=<url>.");
  process.exit(2);
}

const target = (() => {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || 5432}/${u.pathname.replace(/^\//, "")} as ${decodeURIComponent(u.username)}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
})();

const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 8000 });

try {
  if (cmd === "status") {
    const rows = await migrationStatus(pool);
    console.log(`Target: ${target}`);
    for (const r of rows) {
      const state = r.applied ? (r.checksumMatches === false ? "APPLIED (FILE CHANGED!)" : "applied") : "pending";
      console.log(`  ${r.version.padEnd(32)} ${state}${r.appliedAt ? `  ${new Date(r.appliedAt).toISOString()}` : ""}`);
    }
  } else if (cmd === "up") {
    const rows = await migrationStatus(pool);
    const pending = rows.filter((r) => !r.applied).map((r) => r.version);
    console.log(`Target: ${target}`);
    if (!pending.length) {
      console.log("Nothing to apply; database is up to date.");
    } else {
      console.log(`Pending: ${pending.join(", ")}`);
      if (!flag("yes")) {
        const rl = readline.createInterface({ input: stdin, output: stdout });
        const answer = await rl.question(`Apply ${pending.length} migration(s) to ${target}? Type "migrate" to continue: `);
        rl.close();
        if (answer.trim() !== "migrate") {
          console.log("Aborted. Nothing was changed.");
          process.exit(1);
        }
      }
      const res = await runMigrations(pool, { log: (m) => console.log(`  ${m}`) });
      console.log(`Done. Applied: ${res.applied.join(", ") || "none"}`);
    }
  } else {
    console.error(`Unknown command "${cmd}". Use "status" or "up".`);
    process.exit(2);
  }
} catch (err) {
  console.error(`Migration error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
