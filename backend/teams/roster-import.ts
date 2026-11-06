import type { Pool } from "pg";
import { writeAudit } from "../auth/guard";
import { getSafeQuoteClient } from "../safequote/client";
import { agentIdFor, initialsFor, normalizeUserCode } from "../sales/ingest";
import { calendarFrom, readArenaConfig } from "../settings/arena-config";
import { periodInfo } from "@/shared/time/business";
import { INITIAL_ROSTER } from "@/shared/teams/initial-roster";
import { matchRosterName, type Candidate, type MatchStatus } from "@/shared/teams/matching";
import { assignMember, broadcastTeams, createTeam, TeamError, type Actor } from "./repo";

/**
 * Initial roster import (Owner only).
 *
 * preview(): READ-ONLY. Matches every roster name to real identities: the PostgreSQL agents table and Safe
 * Quote's closer list (the authoritative user codes). Classifies each as exact / possible / multiple /
 * unmatched, flags codes proposed twice and agents already in a team, and lists the sheet's header-row
 * names as possible leaders (never as members). Writes nothing.
 *
 * apply(): the Owner's confirmed choices only. Every user code is re-checked against those two sources (a
 * code is never invented), each code may be used once, unresolved rows are skipped and reported. Teams,
 * memberships and designations are written in ONE transaction, audited, then broadcast.
 */

export interface PreviewMember {
  rosterName: string;
  designation: "senior" | "junior";
  status: MatchStatus | "duplicate";
  candidates: Array<Candidate & { score: number; reason: string; currentTeam: string | null }>;
  note: string | null;
}
export interface PreviewTeam {
  slug: string;
  name: string;
  logoUrl: string;
  exists: boolean;
  leaderReference: string | null;
  leaderCandidates: Array<Candidate & { score: number; reason: string }>;
  members: PreviewMember[];
}

async function loadCandidates(pool: Pool): Promise<{ candidates: Candidate[]; safeQuote: "ok" | "unavailable" }> {
  const byCode = new Map<string, Candidate>();
  for (const r of (await pool.query(`SELECT user_code, name FROM agents`)).rows) byCode.set(r.user_code, { userCode: r.user_code, name: r.name, sources: ["agents"] });
  let safeQuote: "ok" | "unavailable" = "ok";
  try {
    const sq = await getSafeQuoteClient().getClosers(undefined, true); // all-time closer list, fresh (identity check)
    for (const c of sq.closers) {
      const code = normalizeUserCode(String(c.userCode || ""));
      if (!code) continue;
      const cur = byCode.get(code);
      if (cur) {
        if (!cur.sources.includes("safequote")) cur.sources.push("safequote");
        if (cur.name === code && c.name) cur.name = c.name;
      } else byCode.set(code, { userCode: code, name: c.name || code, sources: ["safequote"] });
    }
  } catch {
    safeQuote = "unavailable";
  }
  return { candidates: [...byCode.values()].filter((c) => !/^test\b/i.test(c.name)), safeQuote };
}

export async function defaultEffectiveFrom(pool: Pool): Promise<string> {
  // The first day of the current business month: Teams Arena's "This Month" then covers the whole month.
  return periodInfo("month", calendarFrom((await readArenaConfig(pool)).values)).startDay;
}

export async function previewRoster(pool: Pool) {
  const { candidates, safeQuote } = await loadCandidates(pool);
  const current = new Map<string, string>(
    (await pool.query(`SELECT m.user_code, t.name FROM team_memberships m JOIN teams t ON t.id = m.team_id WHERE m.effective_to IS NULL`)).rows.map((r) => [r.user_code, r.name]),
  );
  const existing = new Set((await pool.query(`SELECT slug FROM teams WHERE slug IS NOT NULL`)).rows.map((r) => r.slug));
  const teams: PreviewTeam[] = INITIAL_ROSTER.map((t) => ({
    slug: t.slug,
    name: t.name,
    logoUrl: t.logoUrl,
    exists: existing.has(t.slug),
    leaderReference: t.leaderReference,
    leaderCandidates: t.leaderReference ? matchRosterName(t.leaderReference, candidates).candidates : [],
    members: t.members.map((m) => {
      const r = matchRosterName(m.name, candidates);
      return {
        rosterName: m.name,
        designation: m.designation,
        status: r.status,
        candidates: r.candidates.map((c) => ({ ...c, currentTeam: current.get(c.userCode) ?? null })),
        note: null,
      };
    }),
  }));
  // The same identity suggested for two roster rows is never resolved automatically.
  const firstChoice = new Map<string, number>();
  for (const t of teams) for (const m of t.members) if (m.status === "exact" || m.status === "possible") firstChoice.set(m.candidates[0].userCode, (firstChoice.get(m.candidates[0].userCode) ?? 0) + 1);
  for (const t of teams)
    for (const m of t.members)
      if ((m.status === "exact" || m.status === "possible") && (firstChoice.get(m.candidates[0].userCode) ?? 0) > 1) {
        m.status = "duplicate";
        m.note = "The same agent is the best match for more than one roster name. Choose manually.";
      }
  const all = teams.flatMap((t) => t.members);
  const count = (s: PreviewMember["status"]) => all.filter((m) => m.status === s).length;
  return {
    teams,
    summary: { total: all.length, exact: count("exact"), possible: count("possible"), multiple: count("multiple"), duplicate: count("duplicate"), unmatched: count("unmatched") },
    candidates: candidates.sort((a, b) => a.name.localeCompare(b.name)),
    safeQuote,
    effectiveFromDefault: await defaultEffectiveFrom(pool),
    readOnly: true,
  };
}

export interface ApplyInput {
  confirm?: unknown;
  effectiveFrom?: unknown;
  leaders?: unknown; // { [slug]: userCode | null }
  members?: unknown; // [{ teamSlug, rosterName, userCode }]
}

export async function applyRoster(pool: Pool, input: ApplyInput, actor: Actor) {
  if (input.confirm !== true) throw new TeamError("Confirm the import first.");
  const effectiveFrom = typeof input.effectiveFrom === "string" ? input.effectiveFrom : await defaultEffectiveFrom(pool);
  const rows = Array.isArray(input.members) ? (input.members as Array<Record<string, unknown>>) : [];
  if (rows.length > 200) throw new TeamError("Too many rows.");
  const { candidates } = await loadCandidates(pool);
  const known = new Map(candidates.map((c) => [c.userCode, c]));

  const used = new Set<string>();
  const plan: Array<{ slug: string; rosterName: string; designation: "senior" | "junior"; userCode: string; name: string; fromSafeQuote: boolean }> = [];
  const skipped: Array<{ team: string; rosterName: string; reason: string }> = [];
  for (const r of rows) {
    const team = INITIAL_ROSTER.find((t) => t.slug === r.teamSlug);
    const member = team?.members.find((m) => m.name === r.rosterName);
    if (!team || !member) throw new TeamError(`"${String(r.rosterName)}" is not on the supplied roster for that team.`);
    const code = typeof r.userCode === "string" ? normalizeUserCode(r.userCode) : "";
    if (!code) {
      skipped.push({ team: team.name, rosterName: member.name, reason: "No verified identity chosen" });
      continue;
    }
    const cand = known.get(code);
    if (!cand) throw new TeamError(`User code ${code} (for ${member.name}) is not in the agents table or Safe Quote's closer list. Codes are never invented.`);
    if (used.has(code)) throw new TeamError(`${cand.name} (${code}) was chosen for more than one roster name.`);
    used.add(code);
    plan.push({ slug: team.slug, rosterName: member.name, designation: member.designation, userCode: code, name: cand.name, fromSafeQuote: !cand.sources.includes("agents") });
  }
  const leaders = (input.leaders && typeof input.leaders === "object" ? input.leaders : {}) as Record<string, unknown>;
  for (const [slug, code] of Object.entries(leaders)) {
    if (code === null || code === "") continue;
    if (!INITIAL_ROSTER.some((t) => t.slug === slug)) throw new TeamError("Unknown team for a leader.");
    if (typeof code !== "string" || !known.has(normalizeUserCode(code))) throw new TeamError("A team leader must be a verified agent (user code).");
  }

  const c = await pool.connect();
  const result = { teamsCreated: 0, assigned: 0, unchanged: 0, agentsAdded: 0, skipped };
  try {
    await c.query("BEGIN");
    for (const t of INITIAL_ROSTER) {
      const exists = (await c.query(`SELECT id FROM teams WHERE slug = $1`, [t.slug])).rows[0];
      if (!exists) {
        await createTeam(pool, { name: t.name, slug: t.slug, logoUrl: t.logoUrl, color: t.color, accentSecondary: t.accentSecondary, displayOrder: t.displayOrder }, actor, c);
        result.teamsCreated++;
      }
    }
    // Real Safe Quote closers not yet in PostgreSQL get their agents row (same id scheme as live ingestion).
    const ensureAgent = async (code: string, name: string) => {
      const ins = await c.query(`INSERT INTO agents (id, user_code, name, initials, active) VALUES ($1, $2, $3, $4, TRUE) ON CONFLICT DO NOTHING`, [agentIdFor(code), code, name, initialsFor(name)]);
      if (ins.rowCount) result.agentsAdded++;
    };
    for (const p of plan) {
      if (p.fromSafeQuote) await ensureAgent(p.userCode, p.name);
      const teamId = (await c.query(`SELECT id FROM teams WHERE slug = $1`, [p.slug])).rows[0].id as string;
      try {
        await assignMember(pool, { userCode: p.userCode, teamId, effectiveFrom, designation: p.designation, note: `Initial roster import: ${p.rosterName}` }, actor, c);
        result.assigned++;
      } catch (e) {
        if (e instanceof TeamError && e.status === 409) result.unchanged++;
        else throw e;
      }
    }
    for (const [slug, code] of Object.entries(leaders)) {
      if (typeof code !== "string" || !code) continue;
      const cc = normalizeUserCode(code);
      if (known.get(cc)?.sources.includes("agents") === false) await ensureAgent(cc, known.get(cc)!.name);
      await c.query(`UPDATE teams SET leader_user_code = $2, updated_at = NOW() WHERE slug = $1`, [slug, cc]);
    }
    await writeAudit(c, {
      adminId: actor.adminId,
      action: "teams.roster_imported",
      targetType: "teams",
      targetId: "initial-roster",
      details: { effectiveFrom, ...result, members: plan.map((p) => ({ team: p.slug, rosterName: p.rosterName, userCode: p.userCode, designation: p.designation })), leaders },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
  broadcastTeams("roster.imported");
  return { effectiveFrom, ...result };
}
