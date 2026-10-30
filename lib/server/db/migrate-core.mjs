// Versioned PostgreSQL migrations — shared by the CLI (scripts/db-migrate.mjs)
// and the app (lib/server/db/migrations.ts). Plain JS so the CLI runs with plain Node.
//
// Rules:
//  - Versions run in the order listed below, each exactly once.
//  - Each version runs in its own transaction; a failure rolls it back and stops.
//  - A pg advisory lock prevents two runners from migrating at the same time.
//  - The SHA-256 of every applied file is recorded. If an applied file later changes,
//    the runner refuses to continue instead of silently diverging.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const MIGRATIONS = [
  { version: "001_initial_schema", file: "001_initial_schema.sql" },
  { version: "002_admin_auth", file: "002_admin_auth.sql" },
  { version: "003_spin_credit_ledger", file: "003_spin_credit_ledger.sql" },
  { version: "004_sync_eligibility_devices", file: "004_sync_eligibility_devices.sql" },
  { version: "005_sales_targets", file: "005_sales_targets.sql" },
];

// Arbitrary constant: "sales_arena_migrate".
const LOCK_KEY = 584_120_771;

export function defaultMigrationsDir() {
  return path.join(process.cwd(), "lib", "server", "db", "migrations");
}

function loadMigration(dir, m) {
  const sql = readFileSync(path.join(dir, m.file), "utf8");
  return { ...m, sql, checksum: createHash("sha256").update(sql).digest("hex") };
}

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(64) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  // Older installs created the table without a checksum column.
  await client.query(`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum VARCHAR(64)`);
}

/** Lists applied and pending versions without changing anything (except creating the tracking table). */
export async function migrationStatus(pool, dir = defaultMigrationsDir()) {
  const client = await pool.connect();
  try {
    await ensureTable(client);
    const { rows } = await client.query(`SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version`);
    const applied = new Map(rows.map((r) => [r.version, r]));
    return MIGRATIONS.map((m) => {
      const loaded = loadMigration(dir, m);
      const row = applied.get(m.version);
      return {
        version: m.version,
        applied: Boolean(row),
        appliedAt: row?.applied_at ?? null,
        checksumMatches: row ? !row.checksum || row.checksum === loaded.checksum : null,
      };
    });
  } finally {
    client.release();
  }
}

/**
 * Applies pending migrations. Returns { applied: string[], skipped: string[] }.
 * Throws on checksum mismatch or SQL error (the failing version is rolled back).
 */
export async function runMigrations(pool, { dir = defaultMigrationsDir(), log = () => {} } = {}) {
  const client = await pool.connect();
  const applied = [];
  const skipped = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await ensureTable(client);
    const { rows } = await client.query(`SELECT version, checksum FROM schema_migrations`);
    const done = new Map(rows.map((r) => [r.version, r.checksum]));

    for (const m of MIGRATIONS) {
      const mig = loadMigration(dir, m);
      if (done.has(mig.version)) {
        const stored = done.get(mig.version);
        if (stored && stored !== mig.checksum) {
          throw new Error(
            `Migration ${mig.version} was already applied but its file has changed (checksum mismatch). ` +
              `Never edit an applied migration; add a new version instead.`,
          );
        }
        if (!stored) {
          // Legacy row from the old single-file runner: record the checksum now.
          await client.query(`UPDATE schema_migrations SET checksum = $1 WHERE version = $2`, [mig.checksum, mig.version]);
        }
        skipped.push(mig.version);
        continue;
      }
      log(`Applying ${mig.version} ...`);
      try {
        await client.query("BEGIN");
        await client.query(mig.sql);
        await client.query(`INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)`, [mig.version, mig.checksum]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${mig.version} failed and was rolled back: ${err instanceof Error ? err.message : String(err)}`);
      }
      applied.push(mig.version);
      log(`Applied ${mig.version}`);
    }
    return { applied, skipped };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    client.release();
  }
}
