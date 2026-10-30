#!/usr/bin/env node
// Initial / historical import of Safe Quote validated sales — WITHOUT any rewards.
//
//   node --env-file=/etc/sales-arena/sales-arena.env scripts/import-sales.mjs --from=2026-10-01 --to=2026-10-30
//
// Every imported sale is stored with source = 'backfill' and reward_eligible = false,
// so it can never grant spins or bonuses. Existing sales (same caseId) are skipped.
// The script compares what it imported with the upstream /summary validated count and
// flags days where /recent-sales returned a full page (possibly truncated). It never
// fabricates sales and never prints the API token or database password.

import pg from "pg";
import readline from "node:readline/promises";

const args = process.argv.slice(2);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const from = opt("from");
const to = opt("to") ?? from;
const YES = args.includes("--yes");
const LIMIT = Math.max(1, Number(process.env.SAFEQUOTE_RECENT_SALES_LIMIT) || 50);
const base = (process.env.SALES_ARENA_API_URL || "https://portal.thesafequote.com/api/sales-arena").replace(/\/+$/, "");
const token = process.env.SALES_ARENA_API_TOKEN;

function fail(m, c = 1) {
  console.error(m);
  process.exit(c);
}
if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set (use node --env-file=...).", 2);
if (!token) fail("SALES_ARENA_API_TOKEN is not set.", 2);
if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? "") || from > to) fail("Use --from=YYYY-MM-DD [--to=YYYY-MM-DD].", 2);

// Same closer identity rules as lib/server/safequote/mapper.ts (extractCloserIdentity).
function hashString(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const hashCode = (s) => `CLS-${(hashString(s) >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
function closerIdentity(closer) {
  if (typeof closer === "string") {
    const m = closer.match(/^(.+?)\s*\((CLS-[A-Za-z0-9_-]+)\)$/i);
    if (m) return { name: m[1].trim(), userCode: m[2].trim().toUpperCase() };
    if (closer.toUpperCase().startsWith("CLS-")) return { name: closer.trim(), userCode: closer.trim().toUpperCase() };
    return { name: closer.trim(), userCode: hashCode(closer.toLowerCase().trim()) };
  }
  const name = closer?.name?.trim() || "Unknown Closer";
  const code = (closer?.code || closer?.userCode)?.trim().toUpperCase();
  return { name, userCode: code || hashCode(name.toLowerCase()) };
}

async function api(path, params) {
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
  return res.json();
}

const days = [];
for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
if (days.length > 93) fail("Import at most 93 days per run.", 2);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
try {
  const dbName = (await pool.query("SELECT current_database() AS d")).rows[0].d;
  console.log(`Importing validated sales ${from} → ${to} into "${dbName}" as historical (no spins, no bonuses).`);
  if (!YES) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const a = await rl.question('Type "import" to continue: ');
    rl.close();
    if (a.trim() !== "import") fail("Aborted. Nothing was changed.");
  }
  let fetched = 0, inserted = 0, duplicates = 0, invalid = 0;
  const incomplete = [];
  for (const day of days) {
    const body = await api("/recent-sales", { from: day, to: day });
    const sales = Array.isArray(body?.sales) ? body.sales : [];
    fetched += sales.length;
    if (sales.length >= LIMIT) incomplete.push(day);
    for (const s of sales) {
      const caseId = String(s.caseId ?? "").trim();
      const at = new Date(s.validatedAt);
      if (!caseId || Number.isNaN(at.getTime())) { invalid++; continue; }
      const id = closerIdentity(s.closer);
      const userCode = id.userCode.trim().toUpperCase().slice(0, 60);
      const name = id.name;
      const agentId = `agt_${userCode.slice(0, 60)}`; // same mapping as lib/server/sales/ingest.ts
      const initials = (name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("") || "CL").toUpperCase();
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query(
          `INSERT INTO agents (id, user_code, name, initials) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [agentId, userCode, name.slice(0, 128), initials],
        );
        const r = await c.query(
          `INSERT INTO validated_sales (id, case_id, user_code, agent_id, state, carrier, coverage, premium, validated_at, raw_payload,
                                        reward_processed, source, reward_eligible, closer_name, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}'::jsonb, TRUE, 'backfill', FALSE, $10, 'validated')
           ON CONFLICT (case_id) DO NOTHING RETURNING id`,
          [`sale_${caseId}`.slice(0, 64), caseId, userCode, agentId, s.state || null, s.carrier || null,
            s.coverage !== undefined && s.coverage !== "" ? String(s.coverage) : null, Number(s.premium) || 0, at, name.slice(0, 128)],
        );
        if (r.rowCount) {
          await c.query(`INSERT INTO sale_status_history (case_id, status, source) VALUES ($1, 'validated', 'backfill') ON CONFLICT DO NOTHING`, [caseId]);
          inserted++;
        } else duplicates++;
        await c.query("COMMIT");
      } catch (err) {
        await c.query("ROLLBACK");
        throw err;
      } finally {
        c.release();
      }
    }
    process.stdout.write(`  ${day}: ${sales.length} received${sales.length >= LIMIT ? " (full page — possibly incomplete)" : ""}\n`);
  }
  let upstream = null;
  try {
    upstream = Number((await api("/summary", { from, to }))?.validated);
  } catch {
    /* summary unavailable */
  }
  await pool.query(
    `INSERT INTO sync_checkpoints (id, endpoint, last_sync_at, status, details, updated_at)
     VALUES ('backfill', '/recent-sales', NOW(), $1, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET last_sync_at = NOW(), status = EXCLUDED.status, details = EXCLUDED.details, updated_at = NOW()`,
    [incomplete.length ? "partial" : "success", JSON.stringify({ source: "backfill", from, to, fetched, inserted, duplicates, invalid, upstreamValidated: upstream, possiblyIncompleteDays: incomplete, via: "scripts/import-sales.mjs" })],
  );
  console.log(`\nReceived ${fetched}, stored ${inserted} new, ${duplicates} already stored, ${invalid} invalid.`);
  if (upstream !== null && Number.isFinite(upstream)) {
    console.log(`Safe Quote /summary reports ${upstream} validated sales for ${from} → ${to}.`);
    if (fetched < upstream) console.log(`Only ${fetched} individual sales are available from /recent-sales; the remaining ${upstream - fetched} cannot be imported individually.`);
  }
  if (incomplete.length) console.log(`Possibly incomplete days (full page of ${LIMIT}): ${incomplete.join(", ")}`);
  console.log("No spins or bonuses were granted (historical import).");
} catch (err) {
  console.error(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
