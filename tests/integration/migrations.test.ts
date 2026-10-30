import { describe, it, expect, beforeAll } from "vitest";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrations, migrationStatus, defaultMigrationsDir, MIGRATIONS } from "@/lib/server/db/migrate-core.mjs";
import { pool, resetDatabase } from "./helpers";

const EXPECTED_TABLES = [
  "admin_users", "admin_sessions", "admin_login_attempts", "agents", "teams", "campaigns", "validated_sales", "sale_status_history",
  "sales_events_inbox", "sync_checkpoints", "reward_programs", "bonus_awards", "target_rules", "spin_credits",
  "spin_credit_transactions", "manual_spin_allocations", "automatic_spin_awards", "spin_results", "rewards_catalog",
  "admin_settings", "audit_logs", "arena_devices", "schema_migrations",
];

describe("migrations", () => {
  beforeAll(async () => {
    const p = pool();
    await p.query("DROP SCHEMA public CASCADE");
    await p.query("CREATE SCHEMA public");
  });

  it("applies every version in order on an empty database, exactly once", async () => {
    const first = await runMigrations(pool());
    expect(first.applied).toEqual(MIGRATIONS.map((m) => m.version));
    const second = await runMigrations(pool());
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(MIGRATIONS.map((m) => m.version));
    const { rows } = await pool().query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    const tables = rows.map((r) => r.table_name);
    for (const t of EXPECTED_TABLES) expect(tables).toContain(t);
    const status = await migrationStatus(pool());
    expect(status.every((s) => s.applied && s.checksumMatches)).toBe(true);
  });

  it("concurrent runners do not apply anything twice (advisory lock)", async () => {
    await resetDatabase();
    const p = pool();
    await p.query("DROP SCHEMA public CASCADE");
    await p.query("CREATE SCHEMA public");
    const results = await Promise.all([runMigrations(p), runMigrations(p), runMigrations(p)]);
    const appliedTotal = results.flatMap((r) => r.applied);
    expect(appliedTotal.sort()).toEqual(MIGRATIONS.map((m) => m.version).sort());
    const { rows } = await p.query(`SELECT COUNT(*)::int AS n FROM schema_migrations`);
    expect(rows[0].n).toBe(MIGRATIONS.length);
  });

  it("upgrades a database where the old runner applied 001 (no checksum recorded)", async () => {
    const p = pool();
    await p.query("DROP SCHEMA public CASCADE");
    await p.query("CREATE SCHEMA public");
    // Reproduce the old runner exactly: tracking table without checksum + 001 SQL.
    await p.query(`CREATE TABLE schema_migrations (version VARCHAR(64) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await p.query(readFileSync(path.join(defaultMigrationsDir(), "001_initial_schema.sql"), "utf8"));
    await p.query(`INSERT INTO schema_migrations (version) VALUES ('001_initial_schema')`);
    // An existing sale from before the upgrade must survive and stay non-eligible.
    await p.query(`INSERT INTO agents (id, user_code, name, initials) VALUES ('agt_old', 'OLD1', 'Old Agent', 'OA')`);
    await p.query(`INSERT INTO validated_sales (id, case_id, user_code, agent_id, premium, validated_at) VALUES ('sale_c1', 'C1', 'OLD1', 'agt_old', 10, NOW())`);

    const res = await runMigrations(p);
    expect(res.applied).toEqual(["002_admin_auth", "003_spin_credit_ledger", "004_sync_eligibility_devices", "005_sales_targets"]);
    const sale = await p.query(`SELECT source, reward_eligible, status FROM validated_sales WHERE case_id = 'C1'`);
    expect(sale.rows[0]).toEqual({ source: "backfill", reward_eligible: false, status: "validated" });
    const cs = await p.query(`SELECT checksum FROM schema_migrations WHERE version = '001_initial_schema'`);
    expect(cs.rows[0].checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses to continue when an applied migration file was edited", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sa-mig-"));
    cpSync(defaultMigrationsDir(), dir, { recursive: true });
    const f = path.join(dir, "002_admin_auth.sql");
    writeFileSync(f, readFileSync(f, "utf8") + "\n-- edited after apply\n");
    await expect(runMigrations(pool(), { dir })).rejects.toThrow(/checksum mismatch/);
  });

  it("foreign keys and checks reject invalid data", async () => {
    await resetDatabase();
    const p = pool();
    await expect(
      p.query(`INSERT INTO validated_sales (id, case_id, user_code, premium, validated_at) VALUES ('s', 'X', 'NOBODY', 1, NOW())`),
    ).rejects.toThrow(/foreign key/);
    await p.query(`INSERT INTO agents (id, user_code, name, initials) VALUES ('agt_a', 'A1', 'A', 'A')`);
    await p.query(`INSERT INTO spin_credits (id, user_code, agent_id) VALUES ('credit_A1', 'A1', 'agt_a')`);
    await expect(p.query(`UPDATE spin_credits SET available = -1 WHERE user_code = 'A1'`)).rejects.toThrow(/check constraint/);
    await expect(
      p.query(
        `INSERT INTO spin_credit_transactions (user_code, kind, quantity, balance_before, balance_after, idempotency_key) VALUES ('A1', 'consume', -1, 0, -1, 'k1')`,
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      p.query(`INSERT INTO admin_users (email, password_hash) VALUES ('x@y.z', 'plaintext')`),
    ).rejects.toThrow(/check constraint/);
    const fk = await p.query(`SELECT COUNT(*)::int AS n FROM pg_constraint WHERE contype = 'f'`);
    expect(fk.rows[0].n).toBeGreaterThanOrEqual(25);
    // Every foreign key is validated.
    const notValid = await p.query(`SELECT COUNT(*)::int AS n FROM pg_constraint WHERE contype = 'f' AND NOT convalidated`);
    expect(notValid.rows[0].n).toBe(0);
  });
});
