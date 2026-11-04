import type { Pool } from "pg";
import { getSafeQuoteClient } from "../safequote/client";
import { calendarFrom, readArenaConfig } from "../settings/arena-config";
import { getPeriodDateRange, type RewardPeriod } from "@/lib/time/business";
import { closeRateOf, leaderOf, rankTeams, topPerformers, type Designation, type MemberStats, type RankedTeam, type TeamInput, type TopPerformer } from "@/lib/teams/ranking";

/**
 * Teams Arena standings for Today / This Week / This Month (read-only).
 *
 * Figures: Safe Quote's per-closer submitted leads, validated sales and close rate for the period: the same
 * numbers as the Daily / Weekly / Monthly screens (one request per date range, cached by the client).
 * Membership: PostgreSQL team_memberships, by business DAY. Each day's figures count for the team the agent
 * belonged to on that day: an agent who transferred inside the period gets their figures fetched separately
 * for the days before and after the transfer, so past results never move when someone changes team.
 * Every member is listed, including members with no leads and no sales (zeros). A bounded number of queries:
 * one membership query, one designation query, one Safe Quote request per distinct date range.
 */

export const PERIODS: Record<string, RewardPeriod> = { day: "day", week: "week", month: "month" };
const MEMO_MS = 2000;

export interface Standings {
  period: RewardPeriod;
  from: string;
  to: string;
  label: string;
  teams: RankedTeam[];
  top: TopPerformer[];
  leaderTeamId: string | null;
  attribution: string;
  generatedAt: string;
}

const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

interface Seg {
  teamId: string;
  userCode: string;
  name: string;
  from: string;
  to: string; // inclusive
  open: boolean;
}

type CloserFetcher = (from: string, to: string) => Promise<Map<string, { submitted: number; validated: number; closeRate: number }>>;

export const safeQuoteClosers: CloserFetcher = async (from, to) => {
  const res = await getSafeQuoteClient().getClosers({ from, to });
  const m = new Map<string, { submitted: number; validated: number; closeRate: number }>();
  for (const c of res.closers) {
    const code = String(c.userCode || "").trim().toUpperCase();
    if (!code) continue;
    const prev = m.get(code);
    // A closer listed twice (should not happen) is summed, never double-ranked.
    m.set(code, prev ? { submitted: prev.submitted + c.submitted, validated: prev.validated + c.validated, closeRate: c.closeRate } : { submitted: c.submitted, validated: c.validated, closeRate: c.closeRate });
  }
  return m;
};

export async function computeStandings(pool: Pool, period: RewardPeriod, opts: { now?: Date; closers?: CloserFetcher } = {}): Promise<Standings> {
  const cfg = (await readArenaConfig(pool)).values;
  const clock = calendarFrom(cfg);
  const range = getPeriodDateRange(period, clock, opts.now);
  const fetchClosers = opts.closers ?? safeQuoteClosers;

  const [teamsRes, segRes] = await Promise.all([
    pool.query(`SELECT id, name, slug, logo_url, color, accent_secondary, display_order, leader_user_code FROM teams WHERE slug IS NOT NULL AND active ORDER BY display_order, name`),
    pool.query(
      `SELECT m.team_id, m.user_code, a.name, GREATEST(m.effective_from, $1::date)::text AS seg_from,
              LEAST(COALESCE(m.effective_to - 1, $2::date), $2::date)::text AS seg_to, (m.effective_to IS NULL) AS open
         FROM team_memberships m JOIN agents a ON a.user_code = m.user_code JOIN teams t ON t.id = m.team_id AND t.active AND t.slug IS NOT NULL
        WHERE m.effective_from <= $2::date AND (m.effective_to IS NULL OR m.effective_to > $1::date)`,
      [range.from, range.to],
    ),
  ]);
  const segs: Seg[] = segRes.rows.map((r) => ({ teamId: r.team_id, userCode: r.user_code, name: r.name, from: r.seg_from, to: r.seg_to, open: r.open }));
  const codes = [...new Set(segs.map((s) => s.userCode))];
  // Designation shown: the one in force on the last day of the period (today for the current period).
  const desig = codes.length
    ? await pool.query(
        `SELECT DISTINCT ON (user_code) user_code, designation FROM agent_designations
          WHERE user_code = ANY($1) AND effective_from <= $2::date AND (effective_to IS NULL OR effective_to > $2::date)
          ORDER BY user_code, effective_from DESC`,
        [codes, range.to],
      )
    : { rows: [] };
  const designationOf = new Map<string, Designation>(desig.rows.map((r) => [r.user_code, r.designation]));

  // One Safe Quote request per distinct date range (the whole period, plus split ranges for transfers).
  const ranges = new Map<string, Promise<Awaited<ReturnType<CloserFetcher>>>>();
  const statsFor = (from: string, to: string) => {
    const k = `${from}|${to}`;
    if (!ranges.has(k)) ranges.set(k, fetchClosers(from, to));
    return ranges.get(k)!;
  };
  const full = segs.length ? await statsFor(range.from, range.to) : new Map();
  const multi = new Set(codes.filter((c) => segs.filter((s) => s.userCode === c).length > 1));

  const members = new Map<string, MemberStats & { teamId: string }>(); // key team|code
  for (const s of segs) {
    if (s.from > s.to) continue;
    const src = multi.has(s.userCode) ? await statsFor(s.from, s.to) : full;
    const st = src.get(s.userCode.toUpperCase());
    const key = `${s.teamId}|${s.userCode}`;
    const prev = members.get(key);
    const submitted = (prev?.submitted ?? 0) + (st?.submitted ?? 0);
    const validated = (prev?.validated ?? 0) + (st?.validated ?? 0);
    const whole = !multi.has(s.userCode);
    members.set(key, {
      teamId: s.teamId,
      userCode: s.userCode,
      name: s.name,
      designation: designationOf.get(s.userCode) ?? null,
      submitted,
      validated,
      // Safe Quote's own close rate when the figures are the whole period's; otherwise recomputed.
      closeRate: whole && st && st.submitted > 0 ? Math.round(st.closeRate * 10) / 10 : closeRateOf(validated, submitted),
      // Left this team inside the period (and not back in it): listed for the days they counted.
      former: !segs.some((x) => x.userCode === s.userCode && x.teamId === s.teamId && x.open),
    });
  }
  // A former member is listed only if they have figures for their days in this team (no empty rows).
  const list = [...members.values()].filter((m) => !m.former || m.submitted > 0 || m.validated > 0);

  const inputs: TeamInput[] = teamsRes.rows.map((t) => ({
    id: t.id, name: t.name, slug: t.slug, logoUrl: t.logo_url, color: t.color, accentSecondary: t.accent_secondary,
    displayOrder: Number(t.display_order), leaderUserCode: t.leader_user_code,
    members: list.filter((m) => m.teamId === t.id).map((m) => ({ userCode: m.userCode, name: m.name, designation: m.designation, submitted: m.submitted, validated: m.validated, closeRate: m.closeRate, former: m.former })),
  }));
  const teams = rankTeams(inputs);
  return {
    period,
    from: range.from,
    to: range.to,
    label: range.detailedLabel,
    teams,
    top: topPerformers(teams, 3),
    leaderTeamId: leaderOf(teams),
    attribution: "Each business day's figures count for the team the agent belonged to on that day (Safe Quote submitted leads, validated sales and close rate).",
    generatedAt: new Date().toISOString(),
  };
}

const KEY = Symbol.for("sales_arena.team_standings");
const g = globalThis as unknown as { [KEY]?: Map<string, { at: number; p: Promise<Standings> }> };
const memo = (g[KEY] ??= new Map());

/** Shared by every display for MEMO_MS (one computation for many screens). */
export function cachedStandings(pool: Pool, period: RewardPeriod): Promise<Standings> {
  const m = memo.get(period);
  if (m && Date.now() - m.at < MEMO_MS) return m.p;
  const p = computeStandings(pool, period);
  memo.set(period, { at: Date.now(), p });
  p.catch(() => memo.get(period)?.p === p && memo.delete(period));
  return p;
}
export const __resetStandingsMemo = () => memo.clear();
export { addDays as __addDays };
