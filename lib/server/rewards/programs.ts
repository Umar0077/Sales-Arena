import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { writeAudit } from "../auth/guard";
import { arenaBroadcaster } from "../events/broadcaster";

/**
 * Daily / weekly / monthly reward programs (PostgreSQL reward_programs). Any number per category.
 * Never hard-deleted: "delete" archives, so earned awards and history always keep their program.
 *
 * Mid-period edits: a change applies from the next evaluation. Awards already earned are never
 * changed, revoked or regenerated (each award stores a snapshot and the program revision).
 * Pausing stops new awards immediately; re-activating counts only sales validated after that moment.
 */

export const REWARD_TYPES = ["cash", "physical", "voucher", "badge", "time_off", "custom"] as const;
export type RewardType = (typeof REWARD_TYPES)[number];
export type ProgramKind = "daily" | "weekly" | "monthly";
export type TierPolicy = "highest_tier" | "additive";
export type ProgramStatus = "active" | "paused" | "scheduled" | "expired" | "archived";

export interface RewardProgram {
  id: string;
  kind: ProgramKind;
  name: string;
  description: string;
  rewardType: RewardType;
  amount: number;
  currency: string;
  prizeLabel: string;
  salesRequired: number;
  /** Most awards one agent can earn from this program in one period. */
  maxAwards: number;
  /** Most awards across all agents in one period (null = no limit). */
  maxTotalAwards: number | null;
  startDate: string | null;
  endDate: string | null;
  scopeType: "all" | "campaign" | "agents";
  scopeIds: string[];
  stackable: boolean;
  /** highest_tier: competes with the other cash tiers of the same kind + group (only the highest achieved counts). additive: pays independently. */
  tierPolicy: TierPolicy;
  /** Programs compete only within the same kind and reward group. */
  rewardGroup: string;
  /**
   * Who may earn it, by the agent's sales designation on the sale's business date: "senior", "junior" or
   * "all" (every agent, the behaviour before designations existed). Junior programmes always use their own
   * "junior…" reward groups, so Senior and Junior tier chains never supersede each other.
   */
  audience: Audience;
  /** Program Active: new awards can be earned. */
  enabled: boolean;
  /** Show on Live Arena: popups / cards for this program appear publicly. */
  showOnArena: boolean;
  headline: string;
  message: string;
  rewardLine: string;
  sound: string;
  accent: string;
  popupSeconds: number;
  leaderboardCount: number;
  activeSince: string | null;
  archivedAt: string | null;
  revision: number;
  status: ProgramStatus;
  createdAt: string;
  updatedAt: string;
}

export type Audience = "all" | "senior" | "junior";
export const AUDIENCES: Audience[] = ["all", "senior", "junior"];

export class ProgramError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export const COLS = `id, kind, name, description, reward_type, amount, currency, prize_label, sales_required, max_awards, max_total_awards,
  to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date, scope_type, scope_ids, stackable,
  tier_policy, reward_group, audience, enabled, show_on_arena, headline, message, reward_line, sound, accent, popup_seconds, leaderboard_count, active_since,
  archived_at, revision, created_at, updated_at`;

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function rowToProgram(r: Record<string, unknown>, today = todayIn(process.env.SALES_ARENA_TIMEZONE || "America/New_York")): RewardProgram {
  const p = {
    id: String(r.id),
    kind: r.kind as ProgramKind,
    name: String(r.name),
    description: String(r.description ?? ""),
    rewardType: (r.reward_type as RewardType) ?? "cash",
    amount: Number(r.amount),
    currency: String(r.currency ?? "Rs."),
    prizeLabel: String(r.prize_label ?? ""),
    salesRequired: Number(r.sales_required),
    maxAwards: Number(r.max_awards),
    maxTotalAwards: r.max_total_awards == null ? null : Number(r.max_total_awards),
    startDate: (r.start_date as string) ?? null,
    endDate: (r.end_date as string) ?? null,
    scopeType: (r.scope_type as RewardProgram["scopeType"]) ?? "all",
    scopeIds: (r.scope_ids as string[]) ?? [],
    stackable: r.stackable !== false,
    tierPolicy: (r.tier_policy as TierPolicy) ?? "highest_tier",
    rewardGroup: String(r.reward_group ?? "default"),
    audience: (AUDIENCES.includes(r.audience as Audience) ? r.audience : "all") as Audience,
    enabled: Boolean(r.enabled),
    showOnArena: r.show_on_arena !== false,
    headline: String(r.headline),
    message: String(r.message),
    rewardLine: String(r.reward_line),
    sound: String(r.sound),
    accent: String(r.accent),
    popupSeconds: Number(r.popup_seconds),
    leaderboardCount: Number(r.leaderboard_count),
    activeSince: iso(r.active_since),
    archivedAt: iso(r.archived_at),
    revision: Number(r.revision ?? 1),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
  const status: ProgramStatus = p.archivedAt
    ? "archived"
    : !p.enabled
      ? "paused"
      : p.endDate && today > p.endDate
        ? "expired"
        : p.startDate && today < p.startDate
          ? "scheduled"
          : "active";
  return { ...p, status };
}

const KIND_WORD: Record<ProgramKind, string> = { daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY" };
const PERIOD_WORD: Record<ProgramKind, string> = { daily: "TODAY", weekly: "THIS WEEK", monthly: "THIS MONTH" };

type Input = Record<string, unknown>;
const text = (v: unknown, field: string, max: number, required = false): string => {
  if (v === undefined || v === null) {
    if (required) throw new ProgramError(`${field} is required.`);
    return "";
  }
  if (typeof v !== "string") throw new ProgramError(`${field} must be text.`);
  const s = v.trim();
  if (required && !s) throw new ProgramError(`${field} is required.`);
  if (s.length > max) throw new ProgramError(`${field} must be at most ${max} characters.`);
  return s;
};
const int = (v: unknown, field: string, min: number, max: number): number => {
  const n = Number(v);
  if (v === "" || v === null || !Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) throw new ProgramError(`${field} must be a whole number from ${min} to ${max}.`);
  return n;
};
const date = (v: unknown, field: string): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new ProgramError(`${field} must be a date (YYYY-MM-DD).`);
  return v;
};

/**
 * Audience and reward group together: a Junior programme's group always starts with "junior" (default
 * "junior"); any other programme's group never does. An existing programme's audience is changed only through
 * the Owner's reviewed eligibility change (rewards/audience.ts), never by an ordinary edit.
 */
function audienceAndGroup(rawAudience: unknown, rawGroup: string, base?: RewardProgram): { audience: Audience; rewardGroup: string } {
  const audience = (rawAudience ?? base?.audience ?? "all") as Audience;
  if (!AUDIENCES.includes(audience)) throw new ProgramError("Choose who can earn it: Senior, Junior or all agents.");
  if (base && audience !== base.audience) throw new ProgramError("A programme's Senior / Junior audience is changed only through the Owner's eligibility review.", 409);
  if (audience === "junior") {
    const group = !rawGroup || rawGroup === "default" ? "junior" : rawGroup;
    if (!group.startsWith("junior")) throw new ProgramError('A Junior programme\'s reward group must start with "junior" (e.g. "junior").');
    return { audience, rewardGroup: group };
  }
  const group = rawGroup || "default";
  if (group.startsWith("junior")) throw new ProgramError('Reward groups starting with "junior" are reserved for Junior programmes.');
  return { audience, rewardGroup: group };
}

/** Validates a full program (create) or a partial patch merged onto the current one (edit). */
export function normalizeProgram(input: Input, base?: RewardProgram): Omit<RewardProgram, "id" | "status" | "activeSince" | "archivedAt" | "revision" | "createdAt" | "updatedAt"> {
  const get = <K extends keyof RewardProgram>(k: K): unknown => (k in input ? input[k] : base?.[k]);
  const kind = get("kind");
  if (kind !== "daily" && kind !== "weekly" && kind !== "monthly") throw new ProgramError("Choose Daily, Weekly or Monthly.");
  if (base && kind !== base.kind) throw new ProgramError("A program's period cannot change. Create a new program instead.");
  const rewardType = get("rewardType") ?? "cash";
  if (!REWARD_TYPES.includes(rewardType as RewardType)) throw new ProgramError("Choose a reward type.");
  const cash = rewardType === "cash";
  const amountRaw = get("amount") ?? 0;
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000) throw new ProgramError("Cash amount must be 0 or more.");
  if (cash && amount <= 0) throw new ProgramError("Enter the cash bonus amount.");
  const prizeLabel = text(get("prizeLabel"), "Prize", 128);
  if (!cash && !prizeLabel) throw new ProgramError("Enter the prize or reward name.");
  const startDate = date(get("startDate"), "Start date");
  const endDate = date(get("endDate"), "End date");
  if (startDate && endDate && endDate < startDate) throw new ProgramError("End date must be on or after the start date.");
  const scopeType = get("scopeType") ?? "all";
  if (scopeType !== "all" && scopeType !== "campaign" && scopeType !== "agents") throw new ProgramError("Choose who is eligible.");
  const rawIds = get("scopeIds") ?? [];
  if (!Array.isArray(rawIds) || rawIds.length > 500 || rawIds.some((x) => typeof x !== "string" || !x.trim() || x.length > 64)) throw new ProgramError("Eligible agents / campaigns list is invalid.");
  const scopeIds = [...new Set((rawIds as string[]).map((x) => (scopeType === "agents" ? x.trim().toUpperCase() : x.trim())))];
  if (scopeType !== "all" && !scopeIds.length) throw new ProgramError(scopeType === "agents" ? "Add at least one agent code." : "Choose at least one campaign.");
  const maxTotal = get("maxTotalAwards");
  const k = kind as ProgramKind;
  const flag = (key: keyof RewardProgram, d: boolean) => {
    const v = get(key);
    if (v === undefined) return d;
    if (typeof v !== "boolean") throw new ProgramError(`${key} must be on or off.`);
    return v;
  };
  return {
    kind: k,
    name: text(get("name"), "Name", 80, true),
    description: text(get("description"), "Description", 500),
    rewardType: rewardType as RewardType,
    amount: cash ? Math.round(amount * 100) / 100 : 0,
    currency: text(get("currency") ?? "Rs.", "Currency", 8, true),
    prizeLabel: cash ? "" : prizeLabel,
    salesRequired: int(get("salesRequired"), "Validated sales required", 1, 1000),
    maxAwards: int(get("maxAwards") ?? 1, "Awards per agent per period", 1, 100),
    maxTotalAwards: maxTotal === null || maxTotal === undefined || maxTotal === "" ? null : int(maxTotal, "Total awards per period", 1, 100_000),
    startDate,
    endDate,
    scopeType: scopeType as RewardProgram["scopeType"],
    scopeIds: scopeType === "all" ? [] : scopeIds,
    stackable: flag("stackable", true),
    // Cash tiers in one kind + group compete (highest achieved only) unless set to additive. Non-cash rewards are independent.
    tierPolicy: !cash ? "additive" : (() => {
      const v = get("tierPolicy") ?? "highest_tier";
      if (v !== "highest_tier" && v !== "additive") throw new ProgramError("Choose a tier policy: highest tier only, or additive.");
      return v as TierPolicy;
    })(),
    ...audienceAndGroup(get("audience"), text(get("rewardGroup"), "Reward group", 64).toLowerCase(), base),
    enabled: flag("enabled", false),
    showOnArena: flag("showOnArena", true),
    headline: text(get("headline"), "Popup headline", 120) || `${KIND_WORD[k]} BONUS UNLOCKED!`,
    message: text(get("message"), "Popup message", 160) || "{name}",
    rewardLine: text(get("rewardLine"), "Reward line", 160) || (cash ? "{amount} BONUS EARNED" : "{amount} EARNED"),
    sound: text(get("sound"), "Sound", 32) || (k === "daily" ? "target" : "special"),
    accent: /^#[0-9a-fA-F]{6}$/.test(String(get("accent") ?? "")) ? String(get("accent")) : k === "daily" ? "#FFC857" : k === "weekly" ? "#22D3FF" : "#B58CFF",
    popupSeconds: int(get("popupSeconds") ?? 7, "Popup seconds", 3, 30),
    leaderboardCount: int(get("leaderboardCount") ?? 10, "Leaderboard rows", 3, 15),
  };
}
export { PERIOD_WORD };

type Actor = { adminId: string; ip: string | null; userAgent: string | null };

export async function listPrograms(db: Pool | PoolClient, opts: { includeArchived?: boolean; kind?: string; publicOnly?: boolean } = {}): Promise<RewardProgram[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (!opts.includeArchived) where.push("archived_at IS NULL");
  if (opts.publicOnly) where.push("enabled AND show_on_arena");
  if (opts.kind) {
    params.push(opts.kind);
    where.push(`kind = $${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT ${COLS} FROM reward_programs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY kind, sales_required, created_at`,
    params,
  );
  return rows.map((r) => rowToProgram(r));
}

export async function snapshot(c: PoolClient, id: string, action: string, adminId: string | null) {
  const row = (await c.query(`SELECT ${COLS} FROM reward_programs WHERE id = $1`, [id])).rows[0];
  const p = rowToProgram(row);
  await c.query(`INSERT INTO reward_program_history (program_id, revision, action, snapshot, admin_id) VALUES ($1, $2, $3, $4, $5)`, [id, p.revision, action, JSON.stringify(p), adminId]);
  return p;
}

const VALUES_SQL = `kind = $2, name = $3, description = $4, reward_type = $5, amount = $6, currency = $7, prize_label = $8, sales_required = $9,
  max_awards = $10, max_total_awards = $11, start_date = $12, end_date = $13, scope_type = $14, scope_ids = $15, stackable = $16, enabled = $17,
  show_on_arena = $18, headline = $19, message = $20, reward_line = $21, sound = $22, accent = $23, popup_seconds = $24, leaderboard_count = $25,
  tier_policy = $26, reward_group = $27, audience = $28`;
const valuesOf = (n: ReturnType<typeof normalizeProgram>) => [
  n.kind, n.name, n.description, n.rewardType, n.amount, n.currency, n.prizeLabel, n.salesRequired, n.maxAwards, n.maxTotalAwards,
  n.startDate, n.endDate, n.scopeType, n.scopeIds, n.stackable, n.enabled, n.showOnArena, n.headline, n.message, n.rewardLine,
  n.sound, n.accent, n.popupSeconds, n.leaderboardCount, n.tierPolicy, n.rewardGroup, n.audience,
];

export function publish(p: Pick<RewardProgram, "id" | "kind" | "revision">, action: string) {
  arenaBroadcaster.broadcast("rewards.program.updated", { programId: p.id, kind: p.kind, revision: p.revision, action });
}

export async function createProgram(pool: Pool, input: Input, actor: Actor): Promise<RewardProgram> {
  const n = normalizeProgram(input);
  const id = `rp_${randomBytes(6).toString("hex")}`;
  const client = await pool.connect();
  let p: RewardProgram;
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($$reward_programs$$))`); // serialise duplicate checks
    if (n.enabled) await assertNoDuplicate(client, n);
    await client.query(
      `INSERT INTO reward_programs (id, kind, name, headline, message, reward_line, created_by, updated_by, revision, active_since)
       VALUES ($1, $2, $3, '', '', '', $4, $4, 1, CASE WHEN $5::boolean THEN NOW() END)`,
      [id, n.kind, n.name, actor.adminId, n.enabled],
    );
    await client.query(`UPDATE reward_programs SET ${VALUES_SQL}, updated_at = NOW() WHERE id = $1`, [id, ...valuesOf(n)]);
    p = await snapshot(client, id, "created", actor.adminId);
    await writeAudit(client, { adminId: actor.adminId, action: "reward_program.created", targetType: "reward_program", targetId: id, details: { program: p }, ip: actor.ip, userAgent: actor.userAgent });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  publish(p, "created");
  return p;
}

/** Edit / activate / pause / show-hide / archive / restore. `archived: true|false` archives or restores. */
export async function updateProgram(pool: Pool, id: string, input: Input, actor: Actor): Promise<RewardProgram> {
  const client = await pool.connect();
  let p: RewardProgram;
  let action = "edited";
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($$reward_programs$$))`); // serialise duplicate checks
    const row = (await client.query(`SELECT ${COLS} FROM reward_programs WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!row) throw new ProgramError("Reward program not found.", 404);
    const cur = rowToProgram(row);
    const { archived, ...fields } = input;
    if (cur.archivedAt && archived !== false) throw new ProgramError("This program is archived. Restore it before editing.", 409);
    const n = normalizeProgram(fields, cur);
    if (archived !== true && n.enabled) await assertNoDuplicate(client, n, id);
    let activeSinceSql = "active_since";
    let archivedSql = "archived_at";
    if (archived === true) {
      n.enabled = false;
      archivedSql = "NOW()";
      action = "archived";
    } else if (archived === false && cur.archivedAt) {
      n.enabled = false; // restored programs come back paused
      archivedSql = "NULL";
      action = "restored";
    } else if (n.enabled && !cur.enabled) {
      activeSinceSql = "NOW()"; // counting starts now: sales made while paused never count
      action = "activated";
    } else if (!n.enabled && cur.enabled) action = "paused";
    else if (n.showOnArena !== cur.showOnArena && Object.keys(fields).length === 1) action = n.showOnArena ? "shown" : "hidden";
    await client.query(
      `UPDATE reward_programs SET ${VALUES_SQL}, active_since = ${activeSinceSql}, archived_at = ${archivedSql},
         revision = revision + 1, updated_by = $29, updated_at = NOW() WHERE id = $1`,
      [id, ...valuesOf(n), actor.adminId],
    );
    p = await snapshot(client, id, action, actor.adminId);
    const changed = Object.fromEntries(
      (Object.keys(n) as (keyof typeof n)[]).filter((k) => JSON.stringify(n[k]) !== JSON.stringify(cur[k])).map((k) => [k, { from: cur[k], to: n[k] }]),
    );
    await writeAudit(client, { adminId: actor.adminId, action: `reward_program.${action}`, targetType: "reward_program", targetId: id, details: { revision: p.revision, changed }, ip: actor.ip, userAgent: actor.userAgent });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  publish(p, action);
  return p;
}

export async function programHistory(db: Pool | PoolClient, id: string) {
  const { rows } = await db.query(
    `SELECT h.revision, h.action, h.snapshot, h.created_at, u.email FROM reward_program_history h
       LEFT JOIN admin_users u ON u.id = h.admin_id WHERE h.program_id = $1 ORDER BY h.revision DESC LIMIT 100`,
    [id],
  );
  return rows.map((r) => ({ revision: r.revision, action: r.action, snapshot: r.snapshot, at: iso(r.created_at), by: r.email ?? null }));
}

/** Programs that would pay the same milestone twice: same period, threshold, eligibility and reward type. */
export function programSignature(p: Pick<RewardProgram, "kind" | "salesRequired" | "scopeType" | "scopeIds" | "rewardType"> & Partial<Pick<RewardProgram, "tierPolicy" | "rewardGroup" | "audience">>): string {
  return [p.kind, p.salesRequired, p.scopeType, [...p.scopeIds].sort().join(","), p.rewardType, p.tierPolicy ?? "highest_tier", p.rewardGroup ?? "default", p.audience ?? "all"].join("|");
}

/** Ids of the newer copies among identical active programs (the oldest of each group is kept). */
export function duplicateProgramIds(programs: RewardProgram[]): Set<string> {
  const groups = new Map<string, RewardProgram[]>();
  for (const p of programs) {
    if (!p.enabled || p.archivedAt) continue;
    const k = programSignature(p);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const out = new Set<string>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (const p of g.slice(1)) out.add(p.id);
  }
  return out;
}

/** Duplicate groups for the Admin warning (all members, oldest first). */
export function duplicateProgramGroups(programs: RewardProgram[]) {
  const groups = new Map<string, RewardProgram[]>();
  for (const p of programs) {
    if (!p.enabled || p.archivedAt) continue;
    const k = programSignature(p);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => g.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map((p) => ({ id: p.id, name: p.name, kind: p.kind, salesRequired: p.salesRequired, amount: p.amount, currency: p.currency, createdAt: p.createdAt })));
}

/** Refuses a second ACTIVE program that would pay the same milestone (kind, threshold, eligibility, reward type). */
export async function assertNoDuplicate(db: PoolClient, n: ReturnType<typeof normalizeProgram>, selfId?: string) {
  // Same audience only: a Junior 2-sale tier never clashes with the Senior 2-sale tier.
  // Unchanged for existing (audience "all") programmes; a Junior programme is compared with Junior ones only.
  const sig = programSignature({ kind: n.kind, salesRequired: n.salesRequired, scopeType: n.scopeType, scopeIds: n.scopeIds, rewardType: n.rewardType, audience: n.audience, rewardGroup: n.audience === "junior" ? n.rewardGroup : undefined });
  const same = (p: RewardProgram) => programSignature(p) === sig;
  const all = await listPrograms(db);
  // A Junior programme may only run once the Owner has scoped the "all agents" programmes of that period
  // (otherwise a Junior would earn from both); and an "all agents" programme may not start next to Junior ones.
  const mixed = all.find(
    (p) => p.id !== selfId && p.enabled && p.kind === n.kind && ((n.audience === "junior" && p.audience === "all") || (n.audience === "all" && p.audience === "junior")),
  );
  if (mixed)
    throw new ProgramError(
      n.audience === "junior"
        ? `"${mixed.name}" is active for ALL agents. Apply the Senior / Junior eligibility review (Owner) before activating a Junior ${n.kind} programme, so no Junior earns from both.`
        : `Active Junior ${n.kind} programmes exist ("${mixed.name}"). Choose Senior as the audience instead of all agents.`,
      409,
    );
  const clash = all.find((p) => p.id !== selfId && p.enabled && same(p));
  if (clash)
    throw new ProgramError(
      `An active ${n.kind} program already pays for ${n.salesRequired} validated sales: "${clash.name}". Edit or pause that program instead, so the same milestone is never paid twice.`,
      409,
    );
}
