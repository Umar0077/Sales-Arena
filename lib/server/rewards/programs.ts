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

export class ProgramError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const COLS = `id, kind, name, description, reward_type, amount, currency, prize_label, sales_required, max_awards, max_total_awards,
  to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date, scope_type, scope_ids, stackable,
  enabled, show_on_arena, headline, message, reward_line, sound, accent, popup_seconds, leaderboard_count, active_since,
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

async function snapshot(c: PoolClient, id: string, action: string, adminId: string) {
  const row = (await c.query(`SELECT ${COLS} FROM reward_programs WHERE id = $1`, [id])).rows[0];
  const p = rowToProgram(row);
  await c.query(`INSERT INTO reward_program_history (program_id, revision, action, snapshot, admin_id) VALUES ($1, $2, $3, $4, $5)`, [id, p.revision, action, JSON.stringify(p), adminId]);
  return p;
}

const VALUES_SQL = `kind = $2, name = $3, description = $4, reward_type = $5, amount = $6, currency = $7, prize_label = $8, sales_required = $9,
  max_awards = $10, max_total_awards = $11, start_date = $12, end_date = $13, scope_type = $14, scope_ids = $15, stackable = $16, enabled = $17,
  show_on_arena = $18, headline = $19, message = $20, reward_line = $21, sound = $22, accent = $23, popup_seconds = $24, leaderboard_count = $25`;
const valuesOf = (n: ReturnType<typeof normalizeProgram>) => [
  n.kind, n.name, n.description, n.rewardType, n.amount, n.currency, n.prizeLabel, n.salesRequired, n.maxAwards, n.maxTotalAwards,
  n.startDate, n.endDate, n.scopeType, n.scopeIds, n.stackable, n.enabled, n.showOnArena, n.headline, n.message, n.rewardLine,
  n.sound, n.accent, n.popupSeconds, n.leaderboardCount,
];

function publish(p: RewardProgram, action: string) {
  arenaBroadcaster.broadcast("rewards.program.updated", { programId: p.id, kind: p.kind, revision: p.revision, action });
}

export async function createProgram(pool: Pool, input: Input, actor: Actor): Promise<RewardProgram> {
  const n = normalizeProgram(input);
  const id = `rp_${randomBytes(6).toString("hex")}`;
  const client = await pool.connect();
  let p: RewardProgram;
  try {
    await client.query("BEGIN");
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
    const row = (await client.query(`SELECT ${COLS} FROM reward_programs WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!row) throw new ProgramError("Reward program not found.", 404);
    const cur = rowToProgram(row);
    const { archived, ...fields } = input;
    if (cur.archivedAt && archived !== false) throw new ProgramError("This program is archived. Restore it before editing.", 409);
    const n = normalizeProgram(fields, cur);
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
         revision = revision + 1, updated_by = $26, updated_at = NOW() WHERE id = $1`,
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
