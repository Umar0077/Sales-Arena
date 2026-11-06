/**
 * Roster name → real agent identity matching (pure). Never decides anything by itself: it classifies, and
 * the Owner confirms. Only an identical full name (after case / spacing / punctuation normalisation) with a
 * single candidate is "exact"; anything else (extra honorifics or surnames, a one-letter spelling
 * difference) is at most "possible" and needs a person to confirm it.
 */

export type MatchStatus = "exact" | "possible" | "multiple" | "unmatched";

export interface Candidate {
  userCode: string;
  name: string;
  /** Where it was found: the PostgreSQL agents table and / or Safe Quote's closer list. */
  sources: Array<"agents" | "safequote">;
}

export interface MatchResult {
  status: MatchStatus;
  /** Best candidates, most likely first (exact: one; possible: one; multiple: several). */
  candidates: Array<Candidate & { score: number; reason: string }>;
}

export const normalizeName = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Common honorific / given-name prefixes in the roster ("Muhammad", "M", "Syed", "Sahibzada"…). */
const PREFIXES = new Set(["muhammad", "mohammad", "mohammed", "muhammed", "m", "md", "syed", "syeda", "sayed", "sahibzada", "raja", "hafiz", "mr", "ms", "mrs"]);

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
/** Same token, or one edit apart for tokens of 4+ letters ("uswah" / "uswa"). */
const tokenLike = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && editDistance(a, b) <= 1);

function score(roster: string, cand: string): { score: number; reason: string } | null {
  const r = normalizeName(roster);
  const c = normalizeName(cand);
  if (!r || !c) return null;
  if (r === c) return { score: 100, reason: "Identical name" };
  const rt = r.split(" ").filter((t) => !PREFIXES.has(t));
  const ct = c.split(" ");
  const core = ct.filter((t) => !PREFIXES.has(t));
  if (!rt.length) return null;
  const exactAll = rt.every((t) => ct.includes(t));
  const fuzzyAll = rt.every((t) => ct.some((x) => tokenLike(t, x)));
  if (!fuzzyAll) return null;
  if (exactAll && rt.length === core.length) return { score: 90, reason: "Same name apart from a title / prefix" };
  if (exactAll) return { score: rt.length >= 2 ? 80 : 60, reason: rt.length >= 2 ? "Full roster name contained in a longer name" : "First name only matches" };
  return { score: rt.length >= 2 ? 55 : 40, reason: "Similar spelling" };
}

export function matchRosterName(rosterName: string, candidates: Candidate[]): MatchResult {
  const scored = candidates
    .map((c) => ({ c, s: score(rosterName, c.name) }))
    .filter((x): x is { c: Candidate; s: { score: number; reason: string } } => x.s !== null)
    .sort((a, b) => b.s.score - a.s.score || a.c.name.localeCompare(b.c.name))
    .map((x) => ({ ...x.c, score: x.s.score, reason: x.s.reason }));
  if (!scored.length) return { status: "unmatched", candidates: [] };
  const identical = scored.filter((x) => x.score === 100);
  if (identical.length === 1) return { status: "exact", candidates: identical };
  if (identical.length > 1) return { status: "multiple", candidates: identical };
  const top = scored[0].score;
  const best = scored.filter((x) => x.score === top);
  return best.length === 1 ? { status: "possible", candidates: scored.slice(0, 3) } : { status: "multiple", candidates: scored.slice(0, 5) };
}

/** A Safe Quote / PostgreSQL user code an Admin may type in after checking it (never generated here). */
export const USER_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,63}$/;
