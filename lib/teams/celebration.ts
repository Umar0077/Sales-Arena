/**
 * Teams Arena sale celebrations: pure rules (no React, no stores), unit-tested.
 *
 * A genuine validated sale (committed in PostgreSQL, then published on the live stream or recovered by the
 * background sync) carries the server's team attribution: the team the agent belonged to on the sale's
 * business day, found by user_code (lib/server/teams/attribution.ts). This module decides HOW one display
 * presents it. It never creates, changes or values anything: it is presentation only.
 */

/** The server's team attribution, as published on the sale event. */
export interface SaleTeamInfo {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  /** Static logo path only (uploaded logos come from the standings this display already has). */
  logoUrl: string | null;
  color: string;
  accentSecondary: string | null;
  businessDate: string;
}

/** Celebration themes. A preset mascot exists only for the official Sigma and Panthers identities. */
export type CelebrationTheme = "lion" | "panther" | "crest";

/**
 * Preset mascot themes, keyed by the team's stable slug (not by its display name, which an Admin can edit).
 * Any other team, including teams created later in Team Management, gets the crest celebration with its own
 * uploaded logo and colours. A future mascot is one line here plus its component; the sale, bonus and
 * routing code does not change.
 */
export const MASCOT_THEMES: Readonly<Record<string, CelebrationTheme>> = Object.freeze({
  sigma: "lion",
  panthers: "panther",
});

export function themeFor(team: Pick<SaleTeamInfo, "slug">): CelebrationTheme {
  return MASCOT_THEMES[team.slug] ?? "crest";
}

/** "Team Sigma" → "TEAM SIGMA GOT A SALE!"; any other name is used exactly as configured. */
export function headlineFor(teamName: string): string {
  return `${teamName.trim().toUpperCase()} GOT A SALE!`;
}

export type RouteReason =
  | "teams-screen"
  | "not-teams-screen"
  | "disabled"
  | "not-a-sale"
  | "attribution-unknown"
  | "unassigned"
  | "team-inactive"
  | "team-not-competing";

export interface RouteDecision {
  presentation: "team" | "standard";
  reason: RouteReason;
}

/**
 * Where a sale goes on THIS display:
 *  - "team": the Teams Arena celebration (and NOT the standard sale popup, so one sale never shows twice);
 *  - "standard": the existing sale popup, exactly as before.
 *
 * Teams celebration only when ALL hold: the Teams Arena screen is on screen here, the Admin switch is on, the
 * event is a live sale with server attribution, the agent had a team that day, and that team is active (and,
 * once this display has standings, is one of the competing teams). Anything uncertain falls back to the
 * standard popup: a sale is never shown with the wrong team's animal and never dropped.
 */
export function routeSale(
  event: { tier: string; preview?: boolean; saleTeam?: SaleTeamInfo | null },
  ctx: { teamsScreen: boolean; enabled: boolean; competingTeamIds: ReadonlySet<string> | null },
): RouteDecision {
  if (event.tier !== "sale") return { presentation: "standard", reason: "not-a-sale" };
  if (!ctx.teamsScreen) return { presentation: "standard", reason: "not-teams-screen" };
  if (!ctx.enabled) return { presentation: "standard", reason: "disabled" };
  if (event.saleTeam === undefined) return { presentation: "standard", reason: "attribution-unknown" };
  if (event.saleTeam === null) return { presentation: "standard", reason: "unassigned" };
  if (!event.saleTeam.active) return { presentation: "standard", reason: "team-inactive" };
  if (ctx.competingTeamIds && !ctx.competingTeamIds.has(event.saleTeam.id)) return { presentation: "standard", reason: "team-not-competing" };
  return { presentation: "team", reason: "teams-screen" };
}

/** Accepts only a well-formed attribution from an event payload (anything else = unknown). */
export function parseSaleTeam(v: unknown): SaleTeamInfo | null | undefined {
  if (v === null) return null;
  if (!v || typeof v !== "object") return undefined;
  const t = v as Record<string, unknown>;
  if (typeof t.id !== "string" || !t.id || typeof t.slug !== "string" || typeof t.name !== "string" || !t.name.trim()) return undefined;
  const color = typeof t.color === "string" && /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : "#7568FF";
  const second = typeof t.accentSecondary === "string" && /^#[0-9a-f]{6}$/i.test(t.accentSecondary) ? t.accentSecondary : null;
  const logo = typeof t.logoUrl === "string" && t.logoUrl.startsWith("/") && !t.logoUrl.startsWith("//") ? t.logoUrl : null;
  return {
    id: t.id,
    slug: t.slug,
    name: t.name.trim(),
    active: t.active !== false,
    logoUrl: logo,
    color,
    accentSecondary: second,
    businessDate: typeof t.businessDate === "string" ? t.businessDate : "",
  };
}

/**
 * The team total shown on a celebration, only when it is VERIFIED: the standings refreshed after the sale and
 * the team's validated count is higher than it was when the sale arrived (same period). Otherwise nothing is
 * shown (never a guessed or optimistic number).
 */
export function verifiedTeamTotal(
  baseline: { period: string; validated: number } | null,
  latest: { period: string; teams: ReadonlyArray<{ id: string; validated: number }> } | null,
  teamId: string,
): number | null {
  if (!baseline || !latest || latest.period !== baseline.period) return null;
  const now = latest.teams.find((t) => t.id === teamId)?.validated;
  return typeof now === "number" && now > baseline.validated ? now : null;
}

/** On-screen time of one celebration (ms). Short, so rapid sales never build a long backlog. */
export function celebrationMs(mode: "full" | "lite", reducedMotion: boolean): number {
  return reducedMotion ? 3800 : mode === "lite" ? 4200 : 5600;
}
