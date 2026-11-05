import { expect, type Page, type Route } from "@playwright/test";
import { ALWAYS_ON, minsAgo } from "./cub-helpers";

/**
 * Shared Teams Arena UI fixtures for the database-free suites (playwright.ui.config.ts): the production ranking
 * rules over a fixed roster, and a display whose settings, standings, cub activity and live stream are answered by
 * the test inside the browser. Nothing is written anywhere.
 */
export const ROSTER: Record<string, string[]> = {
  sigma: ["Arsam Idrees", "Sahibzada Hassan Mehboob", "Muhammad Adeel Afzal", "Kanwal Farooq", "Ali Sikandar", "Haris Malik", "Syed Farhan", "Alishba", "Ali Baloch", "Rajab Rehan"],
  alpha: ["Rehan Ali", "Urwah Malik", "Rayyan Mughal", "Mansoor Arshad", "Uswa E Husna", "Muhammad Ehsan Zahid", "Hina Javed", "Roger Robinson", "Abdul Hadi", "Adil Faryad"],
  panthers: ["Syed Noroz Ali Kazmi", "Hamna Nasir", "Syed Ali Asghar Zaidi", "Muhammad Balaj", "Jonathan", "Syeda Zubia Farhan", "Sumaiya Majeed", "Mudassir Tanveer", "M Ishaq", "Noor Kiyani"],
};
ROSTER.falcons = ["Faris Khan", "Fatima Noor"];
ROSTER.eagles = ["Ehsan Ali", "Erum Shah", "Ebad Raza"];
export const META: Record<string, [string, string, number]> = {
  alpha: ["Team Alpha", "#22D3FF", 1],
  panthers: ["Team Panthers", "#A855F7", 2],
  sigma: ["Team Sigma", "#8B5CF6", 3],
  falcons: ["Team Falcons", "#34D399", 4],
  eagles: ["Team Eagles", "#F97316", 5],
};
/** Today's production competition: two active teams (Team Alpha archived). */
export const TWO = ["panthers", "sigma"];
export type Figs = Record<string, Array<[number, number]>>; // per member index: [validated, submitted]

/** The server's response shape, ranked with the production rules (validated ↓, submitted ↓, name; equal → shared rank). */
export function standings(period: string, figs: Figs, slugs: string[] = ["alpha", "panthers", "sigma"]) {
  const share = <T extends { validated: number; submitted: number }>(xs: T[]) =>
    xs.map((x, i) => ({ ...x, rank: xs.findIndex((y) => y.validated === x.validated && y.submitted === x.submitted) + 1 || i + 1, tied: xs.filter((y) => y.validated === x.validated && y.submitted === x.submitted).length > 1 }));
  const teams = slugs.map((slug) => {
    const members = ROSTER[slug]
      .map((name, i) => {
        const [validated, submitted] = figs[slug]?.[i] ?? [0, 0];
        return { userCode: `UI-${slug.toUpperCase()}-${i}`, name, designation: (i < 5 ? "senior" : "junior") as "senior" | "junior", validated, submitted, closeRate: submitted ? Math.round((validated / submitted) * 1000) / 10 : null };
      })
      .sort((a, b) => b.validated - a.validated || b.submitted - a.submitted || a.name.localeCompare(b.name));
    const validated = members.reduce((s, m) => s + m.validated, 0);
    const submitted = members.reduce((s, m) => s + m.submitted, 0);
    const [name, color, order] = META[slug];
    return { id: `team_${slug}`, name, slug, logoUrl: ["alpha", "panthers", "sigma"].includes(slug) ? `/teams/team-${slug}.webp` : null, color, accentSecondary: null, displayOrder: order, leaderUserCode: null, members: share(members), validated, submitted, closeRate: submitted ? Math.round((validated / submitted) * 1000) / 10 : null, memberCount: members.length };
  });
  teams.sort((a, b) => b.validated - a.validated || b.submitted - a.submitted || a.displayOrder - b.displayOrder);
  const ranked = share(teams);
  const top = share(
    ranked.flatMap((t) => t.members.filter((m) => m.validated > 0).map((m) => ({ ...m, teamId: t.id, teamName: t.name, teamSlug: t.slug, teamLogoUrl: t.logoUrl, teamColor: t.color }))).sort((a, b) => b.validated - a.validated || b.submitted - a.submitted || a.name.localeCompare(b.name)),
  ).slice(0, 3);
  const label: Record<string, string> = { day: "Today · Nov 5, 2026", week: "This Week · Nov 2 – Nov 5, 2026", month: "This Month · Nov 1 – Nov 5, 2026" };
  const leaderTeamId = ranked[0].rank === 1 && !ranked[0].tied && ranked[0].validated > 0 && ranked.length > 1 ? ranked[0].id : null;
  return { ok: true, period, from: "2026-11-01", to: "2026-11-05", label: label[period], teams: ranked, top, leaderTeamId, attribution: "", generatedAt: new Date().toISOString() };
}

export const MONTH: Figs = {
  sigma: [[4, 8], [3, 4], [3, 3], [1, 4], [1, 3], [1, 1]],
  alpha: [[3, 6], [1, 6], [1, 1], [0, 1], [0, 1]],
  panthers: [[2, 4], [2, 3], [1, 4], [0, 1]],
};

/** A display with no database behind it: global settings, cub activity, standings and the stream come from the test. */
export async function display(page: Page, opts: { figs?: Figs; cub?: boolean; slugs?: string[]; values?: Record<string, unknown> } = {}) {
  const st = { figs: opts.figs ?? MONTH, slugs: opts.slugs ?? ["alpha", "panthers", "sigma"], requests: [] as string[], events: "", deliveries: 0, served: 0 };
  const values = {
    arenaEnabled: true,
    arenaModes: { daily: true, weekly: true, monthly: true, teams: true, spin: true },
    defaultArenaMode: "daily",
    showModeSelector: true,
    teamsTabVisible: true,
    liveSyncSeconds: 120,
    celebrationPopups: true,
    saleCelebrationStyle: "toast",
    announceCash: true,
    rewardCategories: { daily: { active: true, showOnArena: true }, weekly: { active: true, showOnArena: true }, monthly: { active: true, showOnArena: true } },
    arenaCub: { enabled: true, ...ALWAYS_ON, allowOnLiveArena: opts.cub !== false, screens: { daily: true, weekly: true, monthly: true, teams: true, spin: false } },
    ...(opts.values ?? {}),
  };
  const config = { revision: 1, values, screen: null };
  await page.route("**/api/arena/config", (r) => r.fulfill({ json: { ok: true, ...config } }));
  await page.route("**/api/arena/mode", (r) => r.fulfill({ json: { ok: true, live: true, display: null, config } }));
  await page.route("**/api/arena/cub", (r) => r.fulfill({ json: { ok: true, lastSaleAt: minsAgo(2), serverNow: new Date().toISOString() } }));
  await page.route("**/api/arena/teams?**", (r: Route) => {
    const period = new URL(r.request().url()).searchParams.get("period") ?? "day";
    st.requests.push(period);
    return r.fulfill({ json: standings(period, st.figs, st.slugs) });
  });
  // Stream: the first connection only says "ready"; later ones wait for events from the test (no reconnect storm).
  await page.route("**/api/arena/stream", async (route) => {
    const body = (events: string) => ({ status: 200, headers: { "content-type": "text/event-stream" }, body: `retry: 1000\n\nevent: ready\ndata: {}\n\n${events}` });
    if (st.served++ === 0) return route.fulfill(body("")).catch(() => {});
    const until = Date.now() + 5 * 60_000;
    while (st.deliveries <= 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
    if (st.deliveries <= 0) return route.abort().catch(() => {});
    st.deliveries--;
    await route.fulfill(body(st.events)).catch(() => {});
  });
  return {
    st,
    stream(events: string, times = 1) {
      st.events = events;
      st.deliveries = times;
    },
  };
}
export const errorsOf = (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  // Database-backed endpoints answer 503 in this no-database mode: expected, not a UI error.
  page.on("console", (m) => m.type() === "error" && !/503|Service Unavailable/.test(m.text()) && errors.push(m.text()));
  return errors;
};
export async function openTeams(page: Page, cards = 3) {
  await page.goto("/?screen=teams");
  await expect(page.getByTestId("team-card")).toHaveCount(cards, { timeout: 120_000 });
}
