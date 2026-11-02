import { getDbPool } from "../db/client";
import { ipInNetwork, parseIp, parseNetwork, type ParsedNetwork } from "@/lib/security/ip";

/**
 * Authoritative IP perimeter policy (PostgreSQL ip_security_settings + ip_whitelist_rules), cached in
 * memory per process. Requests never wait on a full reload: a tiny `SELECT revision` runs at most
 * every REVISION_CHECK_MS, and the whole policy is reloaded only when the revision changed. Saves in
 * this process invalidate immediately; other processes notice the new revision within seconds.
 *
 * Failure policy (fail closed): if PostgreSQL is unreachable, the last verified policy keeps being
 * enforced. If no policy was ever loaded (cold start during an outage), protected routes are
 * refused with 503 until the database answers. Recovery never depends on a URL:
 * scripts/ip-security.mjs on the server console.
 */

export type Scope = "static" | "arena" | "pairing" | "admin";
export interface PolicyRule extends ParsedNetwork {
  id: number;
  label: string;
  active: boolean;
  allowManagement: boolean;
  expiresAt: number | null;
}
export interface Policy {
  enabled: boolean;
  protectArena: boolean;
  protectPairing: boolean;
  protectAdmin: boolean;
  revision: number;
  rules: PolicyRule[];
}
export type DenyReason = "no_ip" | "no_match" | "unavailable";
export type Decision =
  | { allowed: true; reason: "disabled" | "scope_open" | "static" | "matched" | "admin_session"; rule?: PolicyRule }
  | { allowed: false; reason: DenyReason };

export const REVISION_CHECK_MS = 3000;
type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

interface CacheState {
  policy: Policy | null;
  checkedAt: number;
  inflight: Promise<Policy | null> | null;
  dbErrorLoggedAt: number;
}
const KEY = Symbol.for("sales_arena.ip_policy");
const g = globalThis as unknown as { [KEY]?: CacheState };
const state: CacheState = (g[KEY] ??= { policy: null, checkedAt: 0, inflight: null, dbErrorLoggedAt: 0 });

/** Disabled policy for installations without PostgreSQL (demo / local preview). */
const NO_DB_POLICY: Policy = { enabled: false, protectArena: true, protectPairing: true, protectAdmin: false, revision: 0, rules: [] };

export async function loadPolicy(db: Db): Promise<Policy> {
  const s = (await db.query(`SELECT enabled, protect_arena, protect_pairing, protect_admin, revision FROM ip_security_settings WHERE id = 1`)).rows[0];
  const rows = (
    await db.query(
      `SELECT id, network::text AS network, label, active, allow_management, expires_at FROM ip_whitelist_rules WHERE archived_at IS NULL ORDER BY id`,
    )
  ).rows;
  const rules: PolicyRule[] = [];
  for (const r of rows) {
    const n = parseNetwork(String(r.network));
    if (!n.ok) continue; // PostgreSQL already validated it; never widen access on a parse surprise
    rules.push({
      ...n.network,
      id: Number(r.id),
      label: String(r.label),
      active: Boolean(r.active),
      allowManagement: Boolean(r.allow_management),
      expiresAt: r.expires_at ? new Date(r.expires_at as string).getTime() : null,
    });
  }
  return {
    enabled: Boolean(s?.enabled),
    protectArena: s ? Boolean(s.protect_arena) : true,
    protectPairing: s ? Boolean(s.protect_pairing) : true,
    protectAdmin: s ? Boolean(s.protect_admin) : false,
    revision: Number(s?.revision ?? 0),
    rules,
  };
}

/** Current policy (cached). null = unknown: the database is unreachable and nothing was ever loaded. */
export async function getPolicy(opts: { db?: Db | null; now?: number } = {}): Promise<Policy | null> {
  const db = opts.db === undefined ? (getDbPool() as unknown as Db | null) : opts.db;
  if (!db) return NO_DB_POLICY;
  const now = opts.now ?? Date.now();
  if (state.policy && now - state.checkedAt < REVISION_CHECK_MS) return state.policy;
  if (state.inflight) return state.inflight;
  state.inflight = (async () => {
    try {
      if (state.policy) {
        const rev = Number((await db.query(`SELECT revision FROM ip_security_settings WHERE id = 1`)).rows[0]?.revision ?? 0);
        if (rev !== state.policy.revision) state.policy = await loadPolicy(db);
      } else state.policy = await loadPolicy(db);
      state.checkedAt = Date.now();
    } catch (err) {
      // Keep enforcing the last verified policy; log at most once a minute (no secrets in the message).
      if (Date.now() - state.dbErrorLoggedAt > 60_000) {
        state.dbErrorLoggedAt = Date.now();
        console.error("[ip-security] policy check failed; enforcing last known policy", err instanceof Error ? err.message : err);
      }
      state.checkedAt = Date.now() - REVISION_CHECK_MS + 1000; // retry in ~1 s
    } finally {
      state.inflight = null;
    }
    return state.policy;
  })();
  return state.inflight;
}

/** Called after a committed change in this process: the next request reloads. */
export function invalidatePolicyCache() {
  state.checkedAt = 0;
  if (state.policy) state.policy = { ...state.policy, revision: -1 };
}
export function __resetPolicyCache() {
  state.policy = null;
  state.checkedAt = 0;
  state.inflight = null;
}

const STATIC_FILE = /\.(?:png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|css|js|map|txt|webmanifest)$/i;

/** Which protection scope a path belongs to. Static assets are never blocked (they hold no data). */
export function classifyPath(pathname: string): Scope {
  if (pathname.startsWith("/_next/static/") || pathname.startsWith("/_next/image") || pathname.startsWith("/brand/")) return "static";
  if (!pathname.startsWith("/api/") && STATIC_FILE.test(pathname) && !pathname.startsWith("/admin")) return "static";
  if (pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/") || pathname === "/api/admin") return "admin";
  if (pathname === "/pair" || pathname.startsWith("/pair/") || pathname.startsWith("/api/arena/device")) return "pairing";
  return "arena"; // "/", /arena, /spin, /leaderboard, /demo, /agent, /api/arena/* and every other route
}

export function isEffective(r: PolicyRule, now: number) {
  return r.active && (r.expiresAt === null || r.expiresAt > now);
}

/** The pure decision. Admin scope accepts only management rules; any active rule opens arena / pairing. */
export function decide(policy: Policy | null, scope: Scope, ip: string | null, now = Date.now()): Decision {
  if (scope === "static") return { allowed: true, reason: "static" };
  if (!policy) return { allowed: false, reason: "unavailable" };
  if (!policy.enabled) return { allowed: true, reason: "disabled" };
  const protectedScope = scope === "admin" ? policy.protectAdmin : scope === "pairing" ? policy.protectPairing : policy.protectArena;
  if (!protectedScope) return { allowed: true, reason: "scope_open" };
  const parsed = parseIp(ip);
  if (!parsed) return { allowed: false, reason: "no_ip" };
  const rule = policy.rules.find((r) => isEffective(r, now) && (scope !== "admin" || r.allowManagement) && ipInNetwork(parsed, r));
  return rule ? { allowed: true, reason: "matched", rule } : { allowed: false, reason: "no_match" };
}

/** The rule (any status) that contains this IP, for the Current Connection card. */
export function ruleFor(policy: Policy | null, ip: string | null): PolicyRule | null {
  const parsed = parseIp(ip);
  if (!policy || !parsed) return null;
  return policy.rules.find((r) => ipInNetwork(parsed, r)) ?? null;
}

// ---- Denied-request monitoring: in-memory, aggregated, rate-limited (never one DB row per request) ----
interface DenyStats {
  total: number;
  since: number;
  byIp: Map<string, { n: number; loggedAt: number }>;
}
const DKEY = Symbol.for("sales_arena.ip_denies");
const gd = globalThis as unknown as { [DKEY]?: DenyStats };
const denies: DenyStats = (gd[DKEY] ??= { total: 0, since: Date.now(), byIp: new Map() });

export function recordDenied(ip: string | null, scope: Scope, reason: DenyReason) {
  denies.total++;
  const k = ip ?? "unknown";
  const e = denies.byIp.get(k) ?? { n: 0, loggedAt: 0 };
  e.n++;
  if (Date.now() - e.loggedAt > 10 * 60_000) {
    e.loggedAt = Date.now();
    console.warn(`[ip-security] denied ${k} (${scope}, ${reason}); ${e.n} denied request(s) from it since ${new Date(denies.since).toISOString()}`);
  }
  denies.byIp.set(k, e);
  if (denies.byIp.size > 5000) denies.byIp.clear(); // bounded memory
}
export function deniedStats() {
  return { total: denies.total, since: new Date(denies.since).toISOString(), distinctIps: denies.byIp.size };
}
