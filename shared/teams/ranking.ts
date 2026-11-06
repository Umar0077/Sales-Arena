/**
 * Teams Arena ranking rules (pure; used by the server API and the tests).
 *
 * Teams:   validated sales ↓, then submitted leads ↓, then the Admin display order, then name.
 * Members: validated sales ↓, then submitted leads ↓, then name (case-insensitive), then user code.
 * Equal validated AND submitted figures share a placement ("tied"), shown as the same rank; the list order
 * among tied entries is the deterministic tie-break above. Nothing is random, nothing uses cash amounts.
 */

export type Designation = "senior" | "junior";

export interface MemberStats {
  userCode: string;
  name: string;
  designation: Designation | null;
  submitted: number;
  validated: number;
  /** Safe Quote policy close rate for the period (%), null when there were no submitted leads. */
  closeRate: number | null;
  /** Membership ended inside the selected period (shown for the days they counted). */
  former?: boolean;
}

export interface RankedMember extends MemberStats {
  rank: number;
  tied: boolean;
}

export interface TeamInput {
  id: string;
  name: string;
  slug: string | null;
  logoUrl: string | null;
  color: string;
  accentSecondary: string | null;
  displayOrder: number;
  leaderUserCode: string | null;
  members: MemberStats[];
}

export interface RankedTeam extends Omit<TeamInput, "members"> {
  rank: number;
  tied: boolean;
  validated: number;
  submitted: number;
  closeRate: number | null;
  memberCount: number;
  members: RankedMember[];
}

export interface TopPerformer extends RankedMember {
  teamId: string;
  teamName: string;
  teamSlug: string | null;
  teamLogoUrl: string | null;
  teamColor: string;
}

const byName = (a: { name: string; userCode?: string }, b: { name: string; userCode?: string }) =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || (a.userCode ?? "").localeCompare(b.userCode ?? "");

export function compareMembers(a: MemberStats, b: MemberStats): number {
  return b.validated - a.validated || b.submitted - a.submitted || byName(a, b);
}

/** Competition ranking (1, 1, 3): entries with equal validated AND submitted share a rank. */
function assignRanks<T extends { validated: number; submitted: number }>(sorted: T[]): Array<T & { rank: number; tied: boolean }> {
  const out: Array<T & { rank: number; tied: boolean }> = [];
  sorted.forEach((x, i) => {
    const prev = out[i - 1];
    const same = prev && prev.validated === x.validated && prev.submitted === x.submitted;
    out.push({ ...x, rank: same ? prev.rank : i + 1, tied: false });
  });
  for (const x of out) x.tied = out.filter((y) => y.rank === x.rank).length > 1;
  return out;
}

export function rankMembers(members: MemberStats[]): RankedMember[] {
  return assignRanks([...members].sort(compareMembers));
}

export const closeRateOf = (validated: number, submitted: number): number | null => (submitted > 0 ? Math.round((validated / submitted) * 1000) / 10 : null);

export function rankTeams(teams: TeamInput[]): RankedTeam[] {
  const totals = teams.map((t) => {
    const validated = t.members.reduce((s, m) => s + m.validated, 0);
    const submitted = t.members.reduce((s, m) => s + m.submitted, 0);
    return {
      ...t,
      validated,
      submitted,
      closeRate: closeRateOf(validated, submitted),
      memberCount: t.members.filter((m) => !m.former).length,
      members: rankMembers(t.members),
    };
  });
  totals.sort((a, b) => b.validated - a.validated || b.submitted - a.submitted || a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
  return assignRanks(totals);
}

/** Overall top performers across all teams (only members with at least one validated sale qualify). */
export function topPerformers(teams: RankedTeam[], n = 3): TopPerformer[] {
  const all = teams.flatMap((t) =>
    t.members.map((m) => ({ ...m, teamId: t.id, teamName: t.name, teamSlug: t.slug, teamLogoUrl: t.logoUrl, teamColor: t.color })),
  );
  const ranked = assignRanks(all.filter((m) => m.validated > 0).sort(compareMembers));
  return ranked.slice(0, n);
}

/** The leading team id, or null when there is no data or the lead is shared. */
export function leaderOf(teams: Pick<RankedTeam, "id" | "rank" | "tied" | "validated">[]): string | null {
  const first = teams.find((t) => t.rank === 1);
  if (!first || first.tied || first.validated === 0) return null;
  return first.id;
}
