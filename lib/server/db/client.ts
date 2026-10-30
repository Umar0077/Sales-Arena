import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

let pool: Pool | null = null;

export function getDbPool(): Pool | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on("error", (err) => {
      console.error("[PostgreSQL Pool Error]", err.message);
    });
  }

  return pool;
}

export async function isDbConnected(): Promise<{
  connected: boolean;
  databaseName?: string;
  error?: string;
  tableCounts?: Record<string, number>;
}> {
  const p = getDbPool();
  if (!p) {
    return { connected: false, error: "DATABASE_URL not configured" };
  }

  try {
    const client = await p.connect();
    try {
      const dbRes = await client.query("SELECT current_database()");
      const databaseName = dbRes.rows[0]?.current_database;

      const tableCounts: Record<string, number> = {};
      const tables = [
        "validated_sales",
        "agents",
        "bonus_awards",
        "spin_credits",
        "reward_programs",
        "sync_checkpoints",
        "sales_events_inbox",
        "spin_results",
      ];
      for (const t of tables) {
        try {
          const c = await client.query(`SELECT COUNT(*) as count FROM ${t}`);
          tableCounts[t] = parseInt(c.rows[0]?.count || "0", 10);
        } catch {
          // Table may not exist prior to migrations
        }
      }

      return { connected: true, databaseName, tableCounts };
    } finally {
      client.release();
    }
  } catch (err) {
    return {
      connected: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function dbQuery<R extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<R> | null> {
  const p = getDbPool();
  if (!p) return null;

  try {
    return await p.query<R>(text, params);
  } catch (err) {
    console.error("[PostgreSQL Query Error]", {
      query: text.slice(0, 100),
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T | null> {
  const p = getDbPool();
  if (!p) return null;

  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Closes the pool (graceful shutdown, and tests that simulate a service restart). */
export async function closeDbPool(): Promise<void> {
  const p = pool;
  pool = null;
  if (p) await p.end();
}
