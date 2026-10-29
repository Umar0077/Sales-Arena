import fs from "fs";
import path from "path";
import { getDbPool, isDbConnected } from "./client";

export async function runMigrations(): Promise<{ success: boolean; applied: number; error?: string }> {
  const status = await isDbConnected();
  if (!status.connected) {
    return {
      success: false,
      applied: 0,
      error: status.error || "Database not connected",
    };
  }

  const pool = getDbPool();
  if (!pool) {
    return { success: false, applied: 0, error: "Database pool unavailable" };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Migration tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(64) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const schemaPath = path.join(process.cwd(), "lib/server/db/schema.sql");
    const sql = fs.readFileSync(schemaPath, "utf-8");

    // Check if 001 already applied
    const res = await client.query("SELECT version FROM schema_migrations WHERE version = '001_initial_schema'");
    let applied = 0;

    if (res.rowCount === 0) {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ('001_initial_schema')");
      applied++;
    }

    await client.query("COMMIT");
    return { success: true, applied };
  } catch (err) {
    await client.query("ROLLBACK");
    return {
      success: false,
      applied: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    client.release();
  }
}
