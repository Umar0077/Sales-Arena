#!/usr/bin/env node
// IP perimeter security: SERVER-CONSOLE recovery for an authorised operator (there is no bypass URL).
//
//   node --env-file=/etc/sales-arena/sales-arena.env scripts/ip-security.mjs status
//   node --env-file=/etc/sales-arena/sales-arena.env scripts/ip-security.mjs disable --reason="Locked out after office ISP change"
//   node --env-file=/etc/sales-arena/sales-arena.env scripts/ip-security.mjs allow 203.0.113.25 --label="Head Office" --reason="..."
//   node --env-file=/etc/sales-arena/sales-arena.env scripts/ip-security.mjs activate 12 --reason="..."
//
// Every change asks you to type "recover" (unless --yes), is written to audit_logs as
// actor "console:<os user>", and bumps the policy revision so running app processes apply it
// within a few seconds (no restart). Needs only DATABASE_URL; it never prints the password.
import pg from "pg";
import os from "node:os";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const cmd = positional[0] ?? "status";
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
    return `${u.hostname}:${u.port || 5432}/${u.pathname.replace(/^\//, "")}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
})();
const actor = `console:${(() => {
  try {
    return os.userInfo().username;
  } catch {
    return "unknown";
  }
})()}`.slice(0, 128);

const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 8000 });

async function confirm(what) {
  console.log(`Target: ${target}\nAction: ${what}\nActor:  ${actor}`);
  if (flag("yes")) return;
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const answer = await rl.question('Type "recover" to continue: ');
  rl.close();
  if (answer.trim() !== "recover") {
    console.log("Aborted. Nothing was changed.");
    process.exit(1);
  }
}

async function change(action, targetId, details, fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`SELECT 1 FROM ip_security_settings WHERE id = 1 FOR UPDATE`);
    const extra = await fn(c);
    const rev = (await c.query(`UPDATE ip_security_settings SET revision = revision + 1, updated_at = NOW(), updated_by = NULL WHERE id = 1 RETURNING revision`)).rows[0].revision;
    await c.query(
      `INSERT INTO audit_logs (actor, action, target_type, target_id, details, ip_address, user_agent) VALUES ($1, $2, 'ip_security', $3, $4, NULL, 'scripts/ip-security.mjs')`,
      [actor, action, targetId, JSON.stringify({ ...details, ...(extra ?? {}), host: os.hostname(), revision: Number(rev) })],
    );
    await c.query("COMMIT");
    console.log(`Done (policy revision ${rev}). Running app processes apply it within a few seconds.`);
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

const reason = (opt("reason") ?? "").trim();
const needReason = () => {
  if (!reason) {
    console.error('Add --reason="..." (it is stored in the audit log).');
    process.exit(2);
  }
};

try {
  if (cmd === "status") {
    const s = (await pool.query(`SELECT * FROM ip_security_settings WHERE id = 1`)).rows[0];
    const rules = (await pool.query(`SELECT id, network::text AS network, label, active, allow_management, expires_at FROM ip_whitelist_rules WHERE archived_at IS NULL ORDER BY id`)).rows;
    console.log(`Target: ${target}`);
    console.log(`Restriction: ${s?.enabled ? "ON" : "OFF"} · protect arena=${s?.protect_arena} pairing=${s?.protect_pairing} admin=${s?.protect_admin} · revision ${s?.revision}`);
    for (const r of rules)
      console.log(`  #${String(r.id).padEnd(4)} ${r.network.padEnd(42)} ${r.active ? "active  " : "inactive"} ${r.allow_management ? "admin" : "arena"}  ${r.expires_at ? `expires ${new Date(r.expires_at).toISOString()}` : ""}  ${r.label}`);
    if (!rules.length) console.log("  (no rules)");
  } else if (cmd === "disable") {
    needReason();
    await confirm("turn IP restriction OFF (the whitelist stays saved)");
    await change("ip_security.recovery.disable", "settings", { reason }, async (c) => {
      await c.query(`UPDATE ip_security_settings SET enabled = FALSE WHERE id = 1`);
    });
  } else if (cmd === "allow") {
    needReason();
    const network = positional[1];
    const label = (opt("label") ?? "Console recovery").trim().slice(0, 80);
    if (!network) throw new Error("Usage: allow <ip-or-cidr> --label=... --reason=...");
    // PostgreSQL parses and normalises the network (cidr); /0 is refused.
    const norm = (await pool.query(`SELECT $1::cidr::text AS n, masklen($1::cidr) AS m`, [network])).rows[0];
    if (Number(norm.m) === 0) throw new Error("Refusing a /0 range.");
    await confirm(`allow ${norm.n} with Admin access as "${label}"`);
    await change("ip_security.recovery.allow", null, { reason, network: norm.n, label }, async (c) => {
      const clash = (await c.query(`SELECT id, label, network::text AS network FROM ip_whitelist_rules WHERE archived_at IS NULL AND network && $1::cidr`, [norm.n])).rows[0];
      if (clash) throw new Error(`Overlaps rule #${clash.id} "${clash.label}" (${clash.network}). Use: activate ${clash.id} --reason=...`);
      const id = (await c.query(
        `INSERT INTO ip_whitelist_rules (network, label, description, active, allow_management, created_via) VALUES ($1::cidr, $2, 'Added from the server console (recovery).', TRUE, TRUE, 'console') RETURNING id`,
        [norm.n, label],
      )).rows[0].id;
      return { ruleId: Number(id) };
    });
  } else if (cmd === "activate") {
    needReason();
    const id = Number(positional[1]);
    if (!Number.isInteger(id)) throw new Error("Usage: activate <rule id> --reason=...");
    await confirm(`activate rule #${id} with Admin access and no expiry`);
    await change("ip_security.recovery.activate", String(id), { reason }, async (c) => {
      const r = await c.query(`UPDATE ip_whitelist_rules SET active = TRUE, allow_management = TRUE, expires_at = NULL, updated_at = NOW() WHERE id = $1 AND archived_at IS NULL`, [id]);
      if (!r.rowCount) throw new Error(`Rule #${id} not found (or deleted).`);
    });
  } else {
    console.error("Commands: status | disable --reason=... | allow <ip-or-cidr> --label=... --reason=... | activate <id> --reason=...");
    process.exit(2);
  }
} catch (err) {
  console.error(`Failed: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
