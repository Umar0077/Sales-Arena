import type { Pool, PoolClient } from "pg";
import { writeAudit } from "../auth/guard";
import { arenaBroadcaster } from "../events/broadcaster";
import { calendarFrom, readArenaConfig } from "../settings/arena-config";
import { businessToday } from "@/lib/time/business";
import type { Designation } from "@/lib/teams/ranking";

/**
 * Teams, effective-dated memberships and Senior / Junior designations (PostgreSQL is the only source).
 *
 * Dates are BUSINESS dates (YYYY-MM-DD in the arena's business timezone); ranges are [from, to): a change
 * "from D" makes D the first day under the new arrangement. An agent has at most one open membership and
 * one open designation; history is never deleted except a same-day correction of a row that never counted.
 * Every change is one transaction with a per-agent lock and an audit row, and is broadcast as
 * "teams.updated" so open Live Arena screens refresh their standings.
 */

export class TeamError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
export interface Actor {
  adminId: string;
  ip: string | null;
  userAgent: string | null;
}
type Db = Pool | PoolClient;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const STATIC_LOGO = /^\/teams\/[a-z0-9-]{1,60}\.(webp|png|svg|jpg)$/;
const DATA_LOGO = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
export const MAX_LOGO_CHARS = 400_000; // ≈ 300 KB image

export async function todayBusiness(db: Db): Promise<string> {
  return businessToday(calendarFrom((await readArenaConfig(db)).values));
}
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function dateArg(v: unknown, today: string, label: string, opts: { maxPastDays?: number } = {}): string {
  if (v === undefined || v === null || v === "") return today;
  const s = String(v);
  if (!YMD.test(s) || Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())) throw new TeamError(`${label} must be a date (YYYY-MM-DD).`);
  if (s > addDays(today, 31)) throw new TeamError(`${label} can be at most 31 days ahead.`);
  if (s < addDays(today, -(opts.maxPastDays ?? 400))) throw new TeamError(`${label} is too far in the past.`);
  return s;
}
const designationArg = (v: unknown): Designation | null => {
  if (v === undefined || v === null || v === "") return null;
  if (v === "senior" || v === "junior") return v;
  throw new TeamError("Designation must be Senior or Junior.");
};

// ------------------------------------------------------------------ teams

export interface TeamRow {
  id: string;
  name: string;
  slug: string | null;
  logoUrl: string | null;
  color: string;
  accentSecondary: string | null;
  leaderUserCode: string | null;
  leaderName: string | null;
  displayOrder: number;
  active: boolean;
  memberCount: number;
}

export async function listTeams(db: Db, opts: { activeOnly?: boolean } = {}): Promise<TeamRow[]> {
  const { rows } = await db.query(
    `SELECT t.id, t.name, t.slug, t.logo_url, t.color, t.accent_secondary, t.leader_user_code, la.name AS leader_name, t.display_order, t.active,
            (SELECT COUNT(*)::int FROM team_memberships m WHERE m.team_id = t.id AND m.effective_to IS NULL) AS member_count
       FROM teams t LEFT JOIN agents la ON la.user_code = t.leader_user_code
      WHERE t.slug IS NOT NULL ${opts.activeOnly ? "AND t.active" : ""}
      ORDER BY t.display_order, t.name`,
  );
  return rows.map((r) => ({
    id: r.id, name: r.name, slug: r.slug, logoUrl: r.logo_url, color: r.color, accentSecondary: r.accent_secondary,
    leaderUserCode: r.leader_user_code, leaderName: r.leader_name, displayOrder: Number(r.display_order), active: r.active, memberCount: Number(r.member_count),
  }));
}

export interface TeamInput {
  name?: unknown;
  logoUrl?: unknown;
  color?: unknown;
  accentSecondary?: unknown;
  leaderUserCode?: unknown;
  displayOrder?: unknown;
  active?: unknown;
}
function cleanTeam(input: TeamInput, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (input.name !== undefined || !partial) {
    const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
    if (name.length < 2 || name.length > 60) throw new TeamError("Team name must be 2–60 characters.");
    out.name = name;
  }
  if (input.logoUrl !== undefined) {
    const v = input.logoUrl;
    if (v !== null && (typeof v !== "string" || v.length > MAX_LOGO_CHARS || !(STATIC_LOGO.test(v) || DATA_LOGO.test(v))))
      throw new TeamError("The logo must be a PNG, JPEG or WebP image under 300 KB.");
    out.logo_url = v;
  }
  if (input.color !== undefined || !partial) {
    const c = input.color ?? "#7568FF";
    if (typeof c !== "string" || !HEX.test(c)) throw new TeamError("Accent colour must be a hex colour like #22D3FF.");
    out.color = c;
  }
  if (input.accentSecondary !== undefined) {
    const c = input.accentSecondary;
    if (c !== null && (typeof c !== "string" || !HEX.test(c))) throw new TeamError("Second accent must be a hex colour like #F5C451.");
    out.accent_secondary = c;
  }
  if (input.displayOrder !== undefined) {
    const n = Number(input.displayOrder);
    if (!Number.isInteger(n) || n < 0 || n > 999) throw new TeamError("Display order must be a whole number 0–999.");
    out.display_order = n;
  }
  if (input.active !== undefined) {
    if (typeof input.active !== "boolean") throw new TeamError("Active must be on or off.");
    out.active = input.active;
  }
  if (input.leaderUserCode !== undefined) {
    const v = input.leaderUserCode;
    if (v !== null && (typeof v !== "string" || !v.trim())) throw new TeamError("Choose a verified agent as team leader, or none.");
    out.leader_user_code = v === null ? null : String(v).trim().toUpperCase();
  }
  return out;
}
const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/^team\s+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "team";

async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
const uniqueViolation = (e: unknown) => (e as { code?: string })?.code === "23505";
export const broadcastTeams = (reason: string) => arenaBroadcaster.broadcast("teams.updated", { reason, at: new Date().toISOString() });

async function checkLeader(c: Db, code: unknown) {
  if (code === null || code === undefined) return;
  const ok = await c.query(`SELECT 1 FROM agents WHERE user_code = $1`, [code]);
  if (!ok.rowCount) throw new TeamError("The team leader must be an existing agent (verified user code).");
}

export async function createTeam(pool: Pool, input: TeamInput & { slug?: unknown }, actor: Actor, client?: PoolClient): Promise<TeamRow> {
  const v = cleanTeam(input, false);
  const slug = typeof input.slug === "string" && /^[a-z0-9-]{2,40}$/.test(input.slug) ? input.slug : slugify(String(v.name));
  const run = async (c: PoolClient) => {
    await checkLeader(c, v.leader_user_code);
    const order = v.display_order ?? Number((await c.query(`SELECT COALESCE(MAX(display_order), 0) + 1 AS n FROM teams WHERE slug IS NOT NULL`)).rows[0].n);
    const id = `team_${slug}`;
    try {
      await c.query(
        `INSERT INTO teams (id, name, color, slug, logo_url, accent_secondary, leader_user_code, display_order, active, lead_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Unassigned')`,
        [id, v.name, v.color, slug, v.logo_url ?? null, v.accent_secondary ?? null, v.leader_user_code ?? null, order, v.active ?? true],
      );
    } catch (e) {
      if (uniqueViolation(e)) throw new TeamError("A team with this name already exists.", 409);
      throw e;
    }
    await writeAudit(c, { adminId: actor.adminId, action: "team.created", targetType: "team", targetId: id, details: { name: v.name, slug, color: v.color }, ip: actor.ip, userAgent: actor.userAgent });
    return id;
  };
  const id = client ? await run(client) : await tx(pool, run);
  if (!client) broadcastTeams("team.created");
  return (await listTeams(client ?? pool)).find((t) => t.id === id)!;
}

export async function updateTeam(pool: Pool, id: string, input: TeamInput, actor: Actor): Promise<TeamRow> {
  const v = cleanTeam(input, true);
  if (!Object.keys(v).length) throw new TeamError("Nothing to change.");
  await tx(pool, async (c) => {
    const cur = (await c.query(`SELECT id, name, color, logo_url, accent_secondary, leader_user_code, display_order, active FROM teams WHERE id = $1 AND slug IS NOT NULL FOR UPDATE`, [id])).rows[0];
    if (!cur) throw new TeamError("Team not found.", 404);
    await checkLeader(c, v.leader_user_code);
    const keys = Object.keys(v);
    try {
      await c.query(`UPDATE teams SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = NOW() WHERE id = $1`, [id, ...keys.map((k) => v[k])]);
    } catch (e) {
      if (uniqueViolation(e)) throw new TeamError("A team with this name already exists.", 409);
      throw e;
    }
    const from: Record<string, unknown> = {};
    for (const k of keys) from[k] = k === "logo_url" ? (cur[k] ? "(image)" : null) : cur[k];
    const to = Object.fromEntries(keys.map((k) => [k, k === "logo_url" ? (v[k] ? "(image)" : null) : v[k]]));
    await writeAudit(c, { adminId: actor.adminId, action: "team.updated", targetType: "team", targetId: id, details: { from, to }, ip: actor.ip, userAgent: actor.userAgent });
  });
  broadcastTeams("team.updated");
  return (await listTeams(pool)).find((t) => t.id === id)!;
}

// ------------------------------------------------------------------ memberships and designations

const lockAgent = (c: PoolClient, code: string) => c.query(`SELECT pg_advisory_xact_lock(hashtext('team-agent:' || $1))`, [code]);

async function requireAgent(c: Db, userCode: unknown) {
  const code = typeof userCode === "string" ? userCode.trim().toUpperCase() : "";
  if (!code) throw new TeamError("Choose an agent.");
  const a = (await c.query(`SELECT user_code, name, active FROM agents WHERE user_code = $1`, [code])).rows[0];
  if (!a) throw new TeamError("No agent with that user code exists. Import / verify the agent first.", 404);
  return a as { user_code: string; name: string; active: boolean };
}

/** Sets the designation from a date (closing the previous one). Same-day change corrects in place. */
async function setDesignationTx(c: PoolClient, code: string, designation: Designation, from: string, actor: Actor, why: string) {
  const open = (await c.query(`SELECT id, designation, effective_from::text AS f FROM agent_designations WHERE user_code = $1 AND effective_to IS NULL FOR UPDATE`, [code])).rows[0];
  if (open?.designation === designation) return false;
  if ((await c.query(`SELECT 1 FROM agent_designations WHERE user_code = $1 AND effective_to IS NOT NULL AND effective_to > $2`, [code, from])).rowCount)
    throw new TeamError("This date overlaps earlier designation history. Choose a later date.");
  if (open && open.f > from) throw new TeamError(`The current designation starts on ${open.f}. Choose that date or later.`);
  if (open && open.f === from) await c.query(`UPDATE agent_designations SET designation = $2, set_by = $3 WHERE id = $1`, [open.id, designation, actor.adminId]);
  else {
    if (open) await c.query(`UPDATE agent_designations SET effective_to = $2 WHERE id = $1`, [open.id, from]);
    await c.query(`INSERT INTO agent_designations (user_code, designation, effective_from, set_by) VALUES ($1, $2, $3, $4)`, [code, designation, from, actor.adminId]);
  }
  await writeAudit(c, { adminId: actor.adminId, action: "agent.designation_set", targetType: "agent", targetId: code, details: { from: open?.designation ?? null, to: designation, effectiveFrom: from, why }, ip: actor.ip, userAgent: actor.userAgent });
  return true;
}

export interface AssignInput {
  userCode?: unknown;
  teamId?: unknown;
  effectiveFrom?: unknown;
  designation?: unknown;
  note?: unknown;
}

/** Assigns or transfers an agent (one transaction). Returns what happened. */
export async function assignMember(pool: Pool, input: AssignInput, actor: Actor, client?: PoolClient): Promise<{ action: "assigned" | "transferred" | "corrected" | "unchanged"; userCode: string; teamId: string }> {
  const run = async (c: PoolClient) => {
    const today = await todayBusiness(c);
    const agent = await requireAgent(c, input.userCode);
    const code = agent.user_code;
    const teamId = typeof input.teamId === "string" ? input.teamId : "";
    const team = (await c.query(`SELECT id, name, active FROM teams WHERE id = $1 AND slug IS NOT NULL`, [teamId])).rows[0];
    if (!team) throw new TeamError("Team not found.", 404);
    if (!team.active) throw new TeamError("That team is inactive. Activate it first.");
    const from = dateArg(input.effectiveFrom, today, "Effective date");
    const designation = designationArg(input.designation);
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 300) || null : null;
    await lockAgent(c, code);

    const open = (await c.query(`SELECT id, team_id, effective_from::text AS f FROM team_memberships WHERE user_code = $1 AND effective_to IS NULL FOR UPDATE`, [code])).rows[0];
    if ((await c.query(`SELECT 1 FROM team_memberships WHERE user_code = $1 AND effective_to IS NOT NULL AND effective_to > $2`, [code, from])).rowCount)
      throw new TeamError("This date overlaps the agent's earlier team history. Choose a later date.");
    let action: "assigned" | "transferred" | "corrected" | "unchanged";
    if (open?.team_id === teamId) action = "unchanged";
    else if (open && open.f > from) throw new TeamError(`The agent's current team membership starts on ${open.f}. Choose that date or later.`);
    else if (open && open.f === from) {
      // Started the same day: a correction of that assignment, not a transfer (it never counted for a full day).
      await c.query(`UPDATE team_memberships SET team_id = $2, assigned_by = $3, note = $4, updated_at = NOW() WHERE id = $1`, [open.id, teamId, actor.adminId, note]);
      action = "corrected";
    } else {
      if (open) await c.query(`UPDATE team_memberships SET effective_to = $2, ended_by = $3, updated_at = NOW() WHERE id = $1`, [open.id, from, actor.adminId]);
      await c.query(`INSERT INTO team_memberships (team_id, user_code, effective_from, assigned_by, note) VALUES ($1, $2, $3, $4, $5)`, [teamId, code, from, actor.adminId, note]);
      action = open ? "transferred" : "assigned";
    }
    if (action !== "unchanged")
      await writeAudit(c, { adminId: actor.adminId, action: `team.member_${action}`, targetType: "agent", targetId: code, details: { team: team.name, teamId, fromTeamId: open?.team_id ?? null, effectiveFrom: from, note }, ip: actor.ip, userAgent: actor.userAgent });
    const changedDesignation = designation ? await setDesignationTx(c, code, designation, from, actor, "team assignment") : false;
    if (action === "unchanged" && !changedDesignation) throw new TeamError(`${agent.name} is already in ${team.name}.`, 409);
    return { action, userCode: code, teamId };
  };
  try {
    const r = client ? await run(client) : await tx(pool, run);
    if (!client) broadcastTeams("team.member");
    return r;
  } catch (e) {
    if (uniqueViolation(e)) throw new TeamError("This agent already has an active team membership.", 409);
    throw e;
  }
}

/** Ends an agent's team membership from a date (the agent no longer counts from that day). */
export async function removeMember(pool: Pool, input: { userCode?: unknown; effectiveFrom?: unknown; note?: unknown }, actor: Actor) {
  const r = await tx(pool, async (c) => {
    const today = await todayBusiness(c);
    const agent = await requireAgent(c, input.userCode);
    const from = dateArg(input.effectiveFrom, today, "Removal date");
    await lockAgent(c, agent.user_code);
    const open = (await c.query(`SELECT m.id, m.team_id, t.name AS team, m.effective_from::text AS f FROM team_memberships m JOIN teams t ON t.id = m.team_id WHERE m.user_code = $1 AND m.effective_to IS NULL FOR UPDATE`, [agent.user_code])).rows[0];
    if (!open) throw new TeamError(`${agent.name} is not in a team.`, 404);
    if (open.f > from) throw new TeamError(`The membership starts on ${open.f}. Choose that date or later.`);
    if (open.f === from) await c.query(`DELETE FROM team_memberships WHERE id = $1`, [open.id]); // never counted for a day
    else await c.query(`UPDATE team_memberships SET effective_to = $2, ended_by = $3, updated_at = NOW() WHERE id = $1`, [open.id, from, actor.adminId]);
    await writeAudit(c, { adminId: actor.adminId, action: "team.member_removed", targetType: "agent", targetId: agent.user_code, details: { team: open.team, teamId: open.team_id, effectiveFrom: from, startedOn: open.f, note: typeof input.note === "string" ? input.note.slice(0, 300) : null }, ip: actor.ip, userAgent: actor.userAgent });
    return { userCode: agent.user_code, teamId: open.team_id as string };
  });
  broadcastTeams("team.member");
  return r;
}

export async function setDesignation(pool: Pool, input: { userCode?: unknown; designation?: unknown; effectiveFrom?: unknown }, actor: Actor) {
  const r = await tx(pool, async (c) => {
    const today = await todayBusiness(c);
    const agent = await requireAgent(c, input.userCode);
    const designation = designationArg(input.designation);
    if (!designation) throw new TeamError("Choose Senior or Junior.");
    const from = dateArg(input.effectiveFrom, today, "Effective date");
    await lockAgent(c, agent.user_code);
    if (!(await setDesignationTx(c, agent.user_code, designation, from, actor, "admin"))) throw new TeamError(`${agent.name} is already ${designation === "senior" ? "a Senior" : "a Junior"}.`, 409);
    return { userCode: agent.user_code, designation, effectiveFrom: from };
  });
  broadcastTeams("designation");
  return r;
}

/** The agent's designation on a business date (reward eligibility, standings). */
export async function designationOn(db: Db, userCode: string, ymd: string): Promise<Designation | null> {
  const r = await db.query(
    `SELECT designation FROM agent_designations WHERE user_code = $1 AND effective_from <= $2 AND (effective_to IS NULL OR effective_to > $2) ORDER BY effective_from DESC LIMIT 1`,
    [userCode, ymd],
  );
  return (r.rows[0]?.designation as Designation) ?? null;
}

// ------------------------------------------------------------------ admin view

export interface AdminMember {
  userCode: string;
  name: string;
  agentActive: boolean;
  teamId: string;
  effectiveFrom: string;
  designation: Designation | null;
  designationFrom: string | null;
}

export async function adminTeamsView(db: Db) {
  const [teams, members, unassigned] = await Promise.all([
    listTeams(db),
    db.query(
      `SELECT m.user_code, a.name, a.active, m.team_id, m.effective_from::text AS f, d.designation, d.effective_from::text AS df
         FROM team_memberships m JOIN agents a ON a.user_code = m.user_code
         LEFT JOIN agent_designations d ON d.user_code = m.user_code AND d.effective_to IS NULL
        WHERE m.effective_to IS NULL ORDER BY a.name`,
    ),
    db.query(
      `SELECT a.user_code, a.name, a.active, d.designation
         FROM agents a LEFT JOIN agent_designations d ON d.user_code = a.user_code AND d.effective_to IS NULL
        WHERE NOT EXISTS (SELECT 1 FROM team_memberships m WHERE m.user_code = a.user_code AND m.effective_to IS NULL)
        ORDER BY a.active DESC, a.name LIMIT 500`,
    ),
  ]);
  return {
    teams,
    members: members.rows.map(
      (r): AdminMember => ({ userCode: r.user_code, name: r.name, agentActive: r.active, teamId: r.team_id, effectiveFrom: r.f, designation: r.designation ?? null, designationFrom: r.df ?? null }),
    ),
    unassigned: unassigned.rows.map((r) => ({ userCode: r.user_code as string, name: r.name as string, active: r.active as boolean, designation: (r.designation as Designation) ?? null })),
  };
}

export async function teamHistory(db: Db, opts: { userCode?: string; teamId?: string; limit?: number } = {}) {
  const limit = Math.min(500, Math.max(1, opts.limit ?? 200));
  const params: unknown[] = [];
  let where = "TRUE";
  if (opts.userCode) {
    params.push(opts.userCode.toUpperCase());
    where += ` AND m.user_code = $${params.length}`;
  }
  if (opts.teamId) {
    params.push(opts.teamId);
    where += ` AND m.team_id = $${params.length}`;
  }
  params.push(limit);
  const { rows } = await db.query(
    `SELECT m.id, m.user_code, a.name, t.name AS team, m.team_id, m.effective_from::text AS f, m.effective_to::text AS t_, m.note,
            ab.email AS assigned_by, eb.email AS ended_by, m.created_at
       FROM team_memberships m JOIN agents a ON a.user_code = m.user_code JOIN teams t ON t.id = m.team_id
       LEFT JOIN admin_users ab ON ab.id = m.assigned_by LEFT JOIN admin_users eb ON eb.id = m.ended_by
      WHERE ${where} ORDER BY m.created_at DESC, m.id DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => ({
    id: Number(r.id), userCode: r.user_code, name: r.name, team: r.team, teamId: r.team_id, effectiveFrom: r.f, effectiveTo: r.t_ ?? null,
    note: r.note ?? null, assignedBy: r.assigned_by ?? null, endedBy: r.ended_by ?? null, createdAt: new Date(r.created_at).toISOString(),
  }));
}
