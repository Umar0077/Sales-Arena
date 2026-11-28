import { creditClosers, creditedMetrics } from "@/backend/sales/credited-metrics";
import type { Pool } from "pg";
import { getSafeQuoteClient } from "../safequote/client";
import { calendarFrom, readArenaConfig } from "../settings/arena-config";
import { getPeriodDateRange, type RewardPeriod } from "@/shared/time/business";
import { closeRateOf, leaderOf, rankTeams, rankTeamsByRaw, topPerformers, type Designation, type MemberStats, type RankedTeam, type TeamInput, type TopPerformer } from "@/shared/teams/ranking";

/**
 * Teams Arena standings for Today / This Week / This Month (read-only).
 *
 * Figures: Safe Quote submitted leads plus PostgreSQL credited sales and recomputed close rate: the same
 * numbers as the Daily / Weekly / Monthly screens (one request per date range, cached by the client).
 * Membership: PostgreSQL team_memberships, by business DAY. Each day's figures count for the team the agent
 * belonged to on that day: an agent who transferred inside the period gets their figures fetched separately
 * for the days before and after the transfer, so past results never move when someone changes team.
 * Every member is listed, including members with no leads and no sales (zeros). A bounded number of queries:
 * one membership query, one designation query, and shared credited metrics per distinct date range.
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

type CloserStats = { submitted: number; validated: number; closeRate: number };
type CloserFetcher = (from: string, to: string) => Promise<Map<string, CloserStats>>;

function makeSafeQuoteClosers(pool?: Pool, fresh = false): CloserFetcher {
  return async (from, to) => {
    const [res, totals] = await Promise.all([
      getSafeQuoteClient().getClosers({ from, to }, fresh),
      creditedMetrics({ from, to }, "user", pool),
    ]);
    const m = new Map<string, CloserStats>();
    for (const c of res.closers) {
      const code = String(c.userCode || "").trim().toUpperCase();
      if (!code) continue;
      const t = totals.get(code);
      const validated = t?.validated ?? 0;
      const prev = m.get(code);
      const submitted = (prev?.submitted ?? 0) + c.submitted;
      const combinedValidated = prev ? prev.validated : validated;
      m.set(code, {
        submitted,
        validated: combinedValidated,
        closeRate: submitted > 0 ? (combinedValidated / submitted) * 100 : 0,
      });
    }
    // Include any verified closer who has PostgreSQL validated_sales in [from, to] even if Safe Quote's /closers list lagged.
    for (const [code, t] of totals.entries()) {
      if (!code || code === "ALL" || m.has(code)) continue;
      m.set(code, {
        submitted: 0,
        validated: t.validated,
        closeRate: 0,
      });
    }
    void creditClosers;
    return m;
  };
}

export const safeQuoteClosers: CloserFetcher = makeSafeQuoteClosers();

export async function computeStandings(
  pool: Pool,
  period: RewardPeriod,
  opts: { now?: Date; fresh?: boolean; closers?: CloserFetcher } = {},
): Promise<Standings> {
  const cfg = (await readArenaConfig(pool)).values;
  const clock = calendarFrom(cfg);
  const range = getPeriodDateRange(period, clock, opts.now);
  const fetchClosers = opts.closers ?? makeSafeQuoteClosers(pool, opts.fresh === true);

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
      // The credited close rate for whole-period figures; recompute after combining transfer segments.
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
  // Count unique validated transactions independently of credited rankings and upstream closer rows.
  // EXISTS attributes a case once per team on the sale's business date, even if membership rows transferred inside the period.
  const [actual, memberActual] = await Promise.all([
    pool.query(
      `SELECT t.id, COUNT(DISTINCT s.case_id)::int AS raw
         FROM teams t JOIN validated_sales s ON s.status = 'validated'
          AND s.validated_at >= ($1::date::timestamp AT TIME ZONE $3)
          AND s.validated_at < (($2::date + 1)::timestamp AT TIME ZONE $3)
          AND EXISTS (
            SELECT 1 FROM team_memberships m WHERE m.team_id = t.id AND m.user_code = s.user_code
             AND m.effective_from <= (s.validated_at AT TIME ZONE $3)::date
             AND (m.effective_to IS NULL OR m.effective_to > (s.validated_at AT TIME ZONE $3)::date)
          )
        WHERE t.slug IS NOT NULL AND t.active GROUP BY t.id`,
      [range.from, range.to, clock.timezone],
    ),
    pool.query(
      `SELECT m.team_id, UPPER(TRIM(s.user_code)) AS user_code, COUNT(DISTINCT s.case_id)::int AS raw
         FROM team_memberships m
         JOIN teams t ON t.id = m.team_id AND t.slug IS NOT NULL AND t.active
         JOIN validated_sales s ON UPPER(TRIM(s.user_code)) = UPPER(TRIM(m.user_code)) AND s.status = 'validated'
          AND s.validated_at >= ($1::date::timestamp AT TIME ZONE $3)
          AND s.validated_at < (($2::date + 1)::timestamp AT TIME ZONE $3)
          AND m.effective_from <= (s.validated_at AT TIME ZONE $3)::date
          AND (m.effective_to IS NULL OR m.effective_to > (s.validated_at AT TIME ZONE $3)::date)
        GROUP BY m.team_id, UPPER(TRIM(s.user_code))`,
      [range.from, range.to, clock.timezone],
    ),
  ]);
  const rawByTeam = new Map((actual?.rows ?? []).map((r) => [r.id, Number(r.raw)]));
  const rawByMember = new Map((memberActual?.rows ?? []).map((r) => [`${r.team_id}|${r.user_code}`, Number(r.raw)]));
  const useDbRaw = !opts.closers || rawByTeam.size > 0;
  const baseRanked = rankTeams(inputs).map((t) => ({
    ...t,
    rawValidated: useDbRaw ? (rawByTeam.get(t.id) ?? 0) : undefined,
    members: t.members.map((m) => ({
      ...m,
      rawValidated: useDbRaw ? (rawByMember.get(`${t.id}|${m.userCode.toUpperCase()}`) ?? 0) : m.rawValidated,
    })),
  }));
  const teams = useDbRaw
    ? rankTeamsByRaw(baseRanked)
    : baseRanked.map((t) => ({ ...t, rawValidated: rawByTeam.get(t.id) ?? 0 }));
  return {
    period,
    from: range.from,
    to: range.to,
    label: range.detailedLabel,
    teams,
    top: topPerformers(teams, 3),
    leaderTeamId: leaderOf(teams),
    attribution: "Each business day's figures count for the team the agent belonged to on that day (submitted leads, raw validated sales, credited sales and credited close rate).",
    generatedAt: new Date().toISOString(),
  };
}

const KEY = Symbol.for("sales_arena.team_standings");
const g = globalThis as unknown as { [KEY]?: Map<string, { at: number; p: Promise<Standings> }> };
const memo = (g[KEY] ??= new Map());

/** Shared by every display for MEMO_MS (one computation for many screens). */
export function cachedStandings(pool: Pool, period: RewardPeriod, opts: { fresh?: boolean } = {}): Promise<Standings> {
  if (!opts.fresh) {
    const m = memo.get(period);
    if (m && Date.now() - m.at < MEMO_MS) return m.p;
  }
  const p = computeStandings(pool, period, { fresh: opts.fresh });
  memo.set(period, { at: Date.now(), p });
  p.catch(() => memo.get(period)?.p === p && memo.delete(period));
  return p;
}
export const invalidateStandingsCache = () => memo.clear();
export const __resetStandingsMemo = invalidateStandingsCache;
export { addDays as __addDays };
