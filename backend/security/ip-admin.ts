import type { Pool, PoolClient } from "pg";
import { writeAudit } from "../auth/guard";
import { arenaBroadcaster } from "../events/broadcaster";
import { displayNetwork, ipInNetwork, networksOverlap, parseIp, parseNetwork } from "@/shared/security/ip";
import { decide, deniedStats, invalidatePolicyCache, isEffective, loadPolicy, ruleFor, type Policy, type PolicyRule } from "./ip-policy";

/**
 * IP perimeter management (Owner only). Every change: one transaction that locks the settings row
 * (so changes are serialised), simulates the resulting policy and refuses anything that would lock
 * administrators out, writes the change + an audit row, bumps the policy revision, commits, and only
 * then invalidates the cache and notifies open streams.
 */

export class IpSecurityError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
export type Actor = { adminId: string; email: string; ip: string | null; userAgent: string | null };

export interface RuleView {
  id: number;
  network: string;
  cidr: string;
  label: string;
  description: string;
  notes: string;
  active: boolean;
  allowManagement: boolean;
  expiresAt: string | null;
  status: "active" | "inactive" | "expired" | "archived";
  createdVia: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  archivedAt: string | null;
}
export interface SettingsView {
  enabled: boolean;
  protectArena: boolean;
  protectPairing: boolean;
  protectAdmin: boolean;
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

function toView(r: Record<string, unknown>, now = Date.now()): RuleView {
  const expiresAt = iso(r.expires_at);
  const archivedAt = iso(r.archived_at);
  const status = archivedAt ? "archived" : !r.active ? "inactive" : expiresAt && new Date(expiresAt).getTime() <= now ? "expired" : "active";
  return {
    id: Number(r.id),
    cidr: String(r.network),
    network: displayNetwork(String(r.network)),
    label: String(r.label),
    description: String(r.description ?? ""),
    notes: String(r.notes ?? ""),
    active: Boolean(r.active),
    allowManagement: Boolean(r.allow_management),
    expiresAt,
    status,
    createdVia: String(r.created_via ?? "admin"),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    createdBy: (r.created_by_email as string) ?? null,
    updatedBy: (r.updated_by_email as string) ?? null,
    archivedAt,
  };
}

const RULE_SELECT = `SELECT r.*, r.network::text AS network, cu.email AS created_by_email, uu.email AS updated_by_email
  FROM ip_whitelist_rules r LEFT JOIN admin_users cu ON cu.id = r.created_by LEFT JOIN admin_users uu ON uu.id = r.updated_by`;

export async function readSettings(db: Pool | PoolClient): Promise<SettingsView> {
  const r = (
    await db.query(`SELECT s.*, u.email FROM ip_security_settings s LEFT JOIN admin_users u ON u.id = s.updated_by WHERE s.id = 1`)
  ).rows[0];
  return {
    enabled: Boolean(r?.enabled),
    protectArena: r ? Boolean(r.protect_arena) : true,
    protectPairing: r ? Boolean(r.protect_pairing) : true,
    protectAdmin: r ? Boolean(r.protect_admin) : false,
    revision: Number(r?.revision ?? 0),
    updatedAt: iso(r?.updated_at),
    updatedBy: r?.email ?? null,
  };
}

export async function listRules(db: Pool | PoolClient, includeArchived = false): Promise<RuleView[]> {
  const { rows } = await db.query(`${RULE_SELECT} ${includeArchived ? "" : "WHERE r.archived_at IS NULL"} ORDER BY r.archived_at NULLS FIRST, r.label, r.id`);
  return rows.map((r) => toView(r));
}

/** Everything the Admin page shows, including what THIS connection is allowed to reach. */
export async function overview(pool: Pool, currentIp: string | null) {
  const [settings, rules, policy] = await Promise.all([readSettings(pool), listRules(pool, true), loadPolicy(pool)]);
  const hit = ruleFor(policy, currentIp);
  const matched = hit ? rules.find((r) => r.id === hit.id) : undefined;
  const asIf = { ...policy, enabled: true };
  const recent = (
    await pool.query(
      `SELECT a.action, a.target_id, a.details, a.ip_address, a.created_at, a.actor, u.email
         FROM audit_logs a LEFT JOIN admin_users u ON u.id = a.admin_id
        WHERE a.action LIKE 'ip_security.%' ORDER BY a.id DESC LIMIT 15`,
    )
  ).rows.map((a) => ({ action: a.action, targetId: a.target_id, details: a.details, ip: a.ip_address, at: iso(a.created_at), by: a.email ?? a.actor }));
  const live = rules.filter((r) => r.status !== "archived");
  return {
    settings,
    rules,
    current: {
      ip: currentIp,
      matchedRule: matched ? { id: matched.id, label: matched.label, network: matched.network, status: matched.status, allowManagement: matched.allowManagement } : null,
      // What would happen with the restriction ON (and what happens now).
      arenaAllowedWhenOn: decide(asIf, "arena", currentIp).allowed || !policy.protectArena,
      adminAllowedWhenOn: decide({ ...asIf, protectAdmin: true }, "admin", currentIp).allowed,
      arenaAllowedNow: decide(policy, "arena", currentIp).allowed,
      adminAllowedNow: decide(policy, "admin", currentIp).allowed,
    },
    stats: {
      enabled: settings.enabled,
      activeRules: live.filter((r) => r.status === "active").length,
      managementRules: live.filter((r) => r.status === "active" && r.allowManagement).length,
      totalRules: live.length,
      archivedRules: rules.length - live.length,
      denied: deniedStats(),
    },
    recent,
  };
}

// ---------------------------------------------------------------- safety

/** Returns why this policy would lock administrators out, or null when it is safe. */
export function lockoutProblem(p: Policy, currentIp: string | null, opts: { enabling?: boolean } = {}, now = Date.now()): string | null {
  if (!p.enabled) return null;
  const mgmt = p.rules.filter((r) => isEffective(r, now) && r.allowManagement);
  if (!mgmt.length) return "At least one active Admin-access rule (a management network) is required while IP restriction is on.";
  if (!mgmt.some((r) => r.expiresAt === null))
    return "Keep at least one active Admin-access rule without an expiry date, so access cannot lapse on its own.";
  const parsed = parseIp(currentIp);
  const included = !!parsed && mgmt.some((r) => ipInNetwork(parsed, r));
  if ((opts.enabling || p.protectAdmin) && !included)
    return currentIp
      ? `Your current IP (${currentIp}) is not covered by an active Admin-access rule. Add it first ("Whitelist my current IP"), or you would lock yourself out.`
      : "Your current IP could not be verified through the trusted proxy, so IP restriction cannot be changed from this connection.";
  return null;
}

// ---------------------------------------------------------------- input

type Input = Record<string, unknown>;
interface RuleFields {
  cidr: string;
  label: string;
  description: string;
  notes: string;
  active: boolean;
  allowManagement: boolean;
  expiresAt: Date | null;
}
const text = (v: unknown, field: string, max: number, required = false) => {
  if (v === undefined || v === null) {
    if (required) throw new IpSecurityError(`${field} is required.`);
    return "";
  }
  if (typeof v !== "string") throw new IpSecurityError(`${field} must be text.`);
  const s = v.trim();
  if (required && !s) throw new IpSecurityError(`${field} is required.`);
  if (s.length > max) throw new IpSecurityError(`${field} must be at most ${max} characters.`);
  if (/[<>]/.test(s)) throw new IpSecurityError(`${field} cannot contain < or >.`);
  return s;
};
const bool = (v: unknown, field: string, d: boolean) => {
  if (v === undefined) return d;
  if (typeof v !== "boolean") throw new IpSecurityError(`${field} must be on or off.`);
  return v;
};

export function normalizeRule(input: Input, base?: RuleView): RuleFields {
  const has = (k: string) => k in input;
  const net = parseNetwork(String(has("network") ? input.network : base?.cidr ?? ""));
  if (!net.ok) throw new IpSecurityError(net.error);
  let expiresAt: Date | null = base?.expiresAt ? new Date(base.expiresAt) : null;
  if (has("expiresAt")) {
    const v = input.expiresAt;
    if (v === null || v === "") expiresAt = null;
    else {
      const d = new Date(String(v));
      if (Number.isNaN(d.getTime())) throw new IpSecurityError("Expiration must be a valid date and time.");
      if (d.getTime() <= Date.now()) throw new IpSecurityError("Expiration must be in the future.");
      expiresAt = d;
    }
  }
  return {
    cidr: net.network.cidr,
    label: has("label") ? text(input.label, "Rule label", 80, true) : base!.label,
    description: has("description") ? text(input.description, "Description", 500) : base?.description ?? "",
    notes: has("notes") ? text(input.notes, "Notes", 1000) : base?.notes ?? "",
    active: bool(input.active, "Status", base?.active ?? true),
    allowManagement: bool(input.allowManagement, "Admin access", base?.allowManagement ?? false),
    expiresAt,
  };
}

// ---------------------------------------------------------------- mutations

async function lockedState(c: PoolClient) {
  await c.query(`SELECT 1 FROM ip_security_settings WHERE id = 1 FOR UPDATE`);
  return loadPolicy(c);
}

function asRule(id: number, f: RuleFields): PolicyRule {
  const n = parseNetwork(f.cidr);
  if (!n.ok) throw new IpSecurityError(n.error);
  return { ...n.network, id, label: f.label, active: f.active, allowManagement: f.allowManagement, expiresAt: f.expiresAt ? f.expiresAt.getTime() : null };
}

function overlapping(policy: Policy, candidate: PolicyRule, ignoreId?: number) {
  return policy.rules.find((r) => r.id !== ignoreId && networksOverlap(r, candidate));
}

function pgFriendly(err: unknown): never {
  const code = (err as { code?: string })?.code;
  if (code === "23P01" || code === "23505") throw new IpSecurityError("That network overlaps an existing rule. Edit the existing rule instead.", 409);
  if (code === "22P02") throw new IpSecurityError("PostgreSQL rejected that network address.");
  throw err;
}

async function finish(c: PoolClient, actor: Actor, action: string, targetId: string | null, details: Record<string, unknown>) {
  const rev = (await c.query(`UPDATE ip_security_settings SET revision = revision + 1, updated_at = NOW(), updated_by = $1 WHERE id = 1 RETURNING revision`, [actor.adminId])).rows[0].revision;
  await writeAudit(c, { adminId: actor.adminId, action, targetType: "ip_security", targetId, details: { ...details, revision: Number(rev) }, ip: actor.ip, userAgent: actor.userAgent });
  return Number(rev);
}

async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

function published(revision: number) {
  invalidatePolicyCache();
  arenaBroadcaster.broadcast("security.policy.updated", { revision });
}

const snapshot = (f: RuleFields | RuleView) => ({
  network: "cidr" in f ? displayNetwork(f.cidr) : undefined,
  label: f.label,
  active: f.active,
  allowManagement: f.allowManagement,
  expiresAt: f.expiresAt ? new Date(f.expiresAt).toISOString() : null,
});

export async function createRule(pool: Pool, input: Input, actor: Actor, via: "admin" | "current_ip" = "admin"): Promise<RuleView> {
  const f = normalizeRule(input);
  let id = 0;
  const revision = await tx(pool, async (c) => {
    const policy = await lockedState(c);
    const clash = overlapping(policy, asRule(0, f));
    if (clash) throw new IpSecurityError(`That network overlaps the existing rule "${clash.label}" (${displayNetwork(clash.cidr)}). Edit that rule instead.`, 409);
    try {
      id = Number(
        (
          await c.query(
            `INSERT INTO ip_whitelist_rules (network, label, description, notes, active, allow_management, expires_at, created_by, updated_by, created_via)
             VALUES ($1::cidr, $2, $3, $4, $5, $6, $7, $8, $8, $9) RETURNING id`,
            [f.cidr, f.label, f.description, f.notes, f.active, f.allowManagement, f.expiresAt, actor.adminId, via],
          )
        ).rows[0].id,
      );
    } catch (err) {
      pgFriendly(err);
    }
    const action = via === "current_ip" ? "ip_security.current_ip_whitelisted" : "ip_security.rule.created";
    return finish(c, actor, action, String(id), { new: snapshot(f) });
  });
  published(revision);
  return (await listRules(pool, true)).find((r) => r.id === id)!;
}

/** Edit, activate/deactivate (active), or archive (archived: true). */
export async function updateRule(pool: Pool, id: number, input: Input, actor: Actor): Promise<RuleView> {
  const revision = await tx(pool, async (c) => {
    const policy = await lockedState(c);
    const cur = (await c.query(`${RULE_SELECT} WHERE r.id = $1 FOR UPDATE OF r`, [id])).rows[0];
    if (!cur) throw new IpSecurityError("Rule not found.", 404);
    const base = toView(cur);
    if (base.archivedAt) throw new IpSecurityError("This rule is archived and cannot be changed.", 409);
    const archive = input.archived === true;
    const { archived: _a, ...fields } = input;
    const f = normalizeRule(fields, base);
    const next: Policy = { ...policy, rules: archive ? policy.rules.filter((r) => r.id !== id) : policy.rules.map((r) => (r.id === id ? asRule(id, f) : r)) };
    if (!archive) {
      const clash = overlapping(policy, asRule(id, f), id);
      if (clash) throw new IpSecurityError(`That network overlaps the existing rule "${clash.label}" (${displayNetwork(clash.cidr)}).`, 409);
    }
    const problem = lockoutProblem(next, actor.ip);
    if (problem) throw new IpSecurityError(`Refused: ${problem}`, 409);
    let action: string;
    if (archive) {
      await c.query(`UPDATE ip_whitelist_rules SET archived_at = NOW(), archived_by = $2, active = FALSE, updated_by = $2, updated_at = NOW() WHERE id = $1`, [id, actor.adminId]);
      action = "ip_security.rule.archived";
    } else {
      try {
        await c.query(
          `UPDATE ip_whitelist_rules SET network = $2::cidr, label = $3, description = $4, notes = $5, active = $6, allow_management = $7,
             expires_at = $8, updated_by = $9, updated_at = NOW() WHERE id = $1`,
          [id, f.cidr, f.label, f.description, f.notes, f.active, f.allowManagement, f.expiresAt, actor.adminId],
        );
      } catch (err) {
        pgFriendly(err);
      }
      const onlyStatus = Object.keys(fields).length === 1 && "active" in fields;
      action = onlyStatus ? (f.active ? "ip_security.rule.activated" : "ip_security.rule.deactivated") : "ip_security.rule.updated";
    }
    return finish(c, actor, action, String(id), { old: snapshot(base), new: archive ? { archived: true } : snapshot(f) });
  });
  published(revision);
  return (await listRules(pool, true)).find((r) => r.id === id)!;
}

/** Master switch and protection scopes. Turning restriction ON needs `confirm: true` and a safe policy. */
export async function saveSettings(pool: Pool, input: Input, actor: Actor): Promise<SettingsView> {
  const revision = await tx(pool, async (c) => {
    const policy = await lockedState(c);
    const next: Policy = {
      ...policy,
      enabled: bool(input.enabled, "IP restriction", policy.enabled),
      protectArena: bool(input.protectArena, "Live Arena scope", policy.protectArena),
      protectPairing: bool(input.protectPairing, "Display pairing scope", policy.protectPairing),
      protectAdmin: bool(input.protectAdmin, "Admin Panel scope", policy.protectAdmin),
    };
    const enabling = next.enabled && !policy.enabled;
    if (enabling && input.confirm !== true) throw new IpSecurityError("Confirm that you want to turn IP restriction on.", 428);
    if (next.enabled && !next.protectArena && !next.protectPairing && !next.protectAdmin)
      throw new IpSecurityError("Choose at least one area to protect, or turn IP restriction off.");
    const problem = lockoutProblem(next, actor.ip, { enabling });
    if (problem) throw new IpSecurityError(`Refused: ${problem}`, 409);
    await c.query(`UPDATE ip_security_settings SET enabled = $1, protect_arena = $2, protect_pairing = $3, protect_admin = $4 WHERE id = 1`, [
      next.enabled, next.protectArena, next.protectPairing, next.protectAdmin,
    ]);
    const changed: Record<string, { from: boolean; to: boolean }> = {};
    for (const k of ["enabled", "protectArena", "protectPairing", "protectAdmin"] as const) if (policy[k] !== next[k]) changed[k] = { from: policy[k], to: next[k] };
    const action = "enabled" in changed ? (next.enabled ? "ip_security.restriction.enabled" : "ip_security.restriction.disabled") : "ip_security.scope.updated";
    return finish(c, actor, action, "settings", { changed });
  });
  published(revision);
  return readSettings(pool);
}

/** "Whitelist my current IP": exact /32 or /128 from the server-observed IP only. */
export async function whitelistCurrentIp(pool: Pool, input: Input, actor: Actor): Promise<RuleView> {
  const ip = parseIp(actor.ip);
  if (!ip || !actor.ip) throw new IpSecurityError("Your IP could not be verified through the trusted proxy, so it cannot be whitelisted.", 409);
  if (input.confirm !== true) throw new IpSecurityError("Confirm that you want to whitelist this IP.", 428);
  return createRule(
    pool,
    { network: actor.ip, label: input.label ?? "", description: "Added with “Whitelist my current IP”.", active: true, allowManagement: input.allowManagement !== false, expiresAt: input.expiresAt ?? null },
    actor,
    "current_ip",
  );
}
