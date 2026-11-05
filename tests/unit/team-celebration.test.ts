import { beforeEach, describe, expect, it } from "vitest";
import { MASCOT_THEMES, celebrationMs, headlineFor, parseSaleTeam, routeSale, themeFor, verifiedTeamTotal, type SaleTeamInfo } from "@/lib/teams/celebration";
import { useTeamCelebrationStore, TEAM_QUEUE_MAX } from "@/store/team-celebration-store";
import { routeTeamSale } from "@/components/arena/ArenaEventBridge";
import { playTeamStinger, stingerFor } from "@/lib/audio/team-stingers";
import { TEAM_STINGERS } from "@/lib/audio/synth";
import type { CelebrationEvent } from "@/types";

const SIGMA: SaleTeamInfo = { id: "team_sigma", slug: "sigma", name: "Team Sigma", active: true, logoUrl: "/teams/team-sigma.webp", color: "#8B5CF6", accentSecondary: null, businessDate: "2026-11-05" };
const PANTHERS: SaleTeamInfo = { ...SIGMA, id: "team_panthers", slug: "panthers", name: "Team Panthers", logoUrl: "/teams/team-panthers.webp" };
const NOVA: SaleTeamInfo = { ...SIGMA, id: "team_nova", slug: "nova", name: "Team Nova", logoUrl: null };

const sale = (caseId: string, saleTeam?: SaleTeamInfo | null): CelebrationEvent => ({
  id: `celeb_sale_${caseId}`,
  tier: "sale",
  headline: "SALE VALIDATED!",
  subline: "",
  agentId: "UI-1",
  agentName: "Ali Sikandar",
  teamName: "FE Sales Arena",
  teamColor: "#36E0B5",
  value: null,
  createdAt: "2026-11-05T15:00:00Z",
  preview: false,
  ...(saleTeam !== undefined ? { saleTeam } : {}),
});
const on = { teamsScreen: true, enabled: true, competingTeamIds: new Set(["team_sigma", "team_panthers"]) };

describe("routing: which presentation a sale gets on one display", () => {
  it("Teams Arena + competing team → the team celebration", () => {
    expect(routeSale(sale("1", SIGMA), on)).toEqual({ presentation: "team", reason: "teams-screen" });
    expect(routeSale(sale("2", PANTHERS), on).presentation).toBe("team");
  });
  it("Daily / Weekly / Monthly / Spin & Win (not Teams Arena) → the standard sale card, always", () => {
    expect(routeSale(sale("1", SIGMA), { ...on, teamsScreen: false })).toEqual({ presentation: "standard", reason: "not-teams-screen" });
  });
  it("unsafe or uncertain attribution never shows a team animal: standard card instead", () => {
    expect(routeSale(sale("1"), on).reason).toBe("attribution-unknown"); // no team field (old server / failed lookup)
    expect(routeSale(sale("1", null), on).reason).toBe("unassigned");
    expect(routeSale(sale("1", { ...SIGMA, active: false }), on).reason).toBe("team-inactive"); // archived team
    expect(routeSale(sale("1", NOVA), on).reason).toBe("team-not-competing"); // not on this display's standings
    for (const r of [sale("1"), sale("1", null), sale("1", { ...SIGMA, active: false }), sale("1", NOVA)]) expect(routeSale(r, on).presentation).toBe("standard");
  });
  it("Admin switch off → standard card; non-sale tiers untouched", () => {
    expect(routeSale(sale("1", SIGMA), { ...on, enabled: false }).reason).toBe("disabled");
    expect(routeSale({ ...sale("1", SIGMA), tier: "milestone" }, on).reason).toBe("not-a-sale");
  });
  it("before this display has standings, the server's active flag decides", () => {
    expect(routeSale(sale("1", NOVA), { ...on, competingTeamIds: null }).presentation).toBe("team");
  });
});

describe("themes, headline, payload parsing", () => {
  it("preset mascots by stable slug; every other team (incl. new ones) gets its crest", () => {
    expect(themeFor(SIGMA)).toBe("lion");
    expect(themeFor(PANTHERS)).toBe("panther");
    expect(themeFor(NOVA)).toBe("crest");
    expect(themeFor({ slug: "alpha" })).toBe("crest");
    expect(Object.isFrozen(MASCOT_THEMES)).toBe(true);
    // A renamed Sigma keeps its lion (slug), a team NAMED "Sigma" with another slug does not get it.
    expect(themeFor({ ...SIGMA, name: "Sigma Lions" } as SaleTeamInfo)).toBe("lion");
    expect(themeFor({ slug: "sigma-2" })).toBe("crest");
  });
  it("headline uses the actual team name", () => {
    expect(headlineFor("Team Sigma")).toBe("TEAM SIGMA GOT A SALE!");
    expect(headlineFor("Team Panthers")).toBe("TEAM PANTHERS GOT A SALE!");
    expect(headlineFor("  Falcons ")).toBe("FALCONS GOT A SALE!");
  });
  it("parseSaleTeam: null stays null (unassigned), malformed is unknown, unsafe logos and colours are dropped", () => {
    expect(parseSaleTeam(null)).toBeNull();
    expect(parseSaleTeam(undefined)).toBeUndefined();
    expect(parseSaleTeam({ id: "", slug: "x", name: "X" })).toBeUndefined();
    expect(parseSaleTeam("team_sigma")).toBeUndefined();
    const t = parseSaleTeam({ ...SIGMA, logoUrl: "https://evil.example/x.png", color: "red;}", accentSecondary: "#ABCDEF" })!;
    expect(t.logoUrl).toBeNull();
    expect(t.color).toBe("#7568FF");
    expect(t.accentSecondary).toBe("#ABCDEF");
    expect(parseSaleTeam({ ...SIGMA, logoUrl: "//evil.example/x.png" })!.logoUrl).toBeNull();
    expect(parseSaleTeam(SIGMA)).toEqual(SIGMA);
    expect(parseSaleTeam({ ...SIGMA, active: false })!.active).toBe(false);
  });
});

describe("verified team total: never a guessed number", () => {
  const latest = (v: number, period = "day") => ({ period, teams: [{ id: "team_sigma", validated: v }] });
  it("shown only after the standings grew past the figure at arrival, same period", () => {
    expect(verifiedTeamTotal({ period: "day", validated: 14 }, latest(15), "team_sigma")).toBe(15);
    expect(verifiedTeamTotal({ period: "day", validated: 14 }, latest(14), "team_sigma")).toBeNull(); // not refreshed yet
    expect(verifiedTeamTotal({ period: "day", validated: 14 }, latest(20, "week"), "team_sigma")).toBeNull(); // other period
    expect(verifiedTeamTotal(null, latest(15), "team_sigma")).toBeNull();
    expect(verifiedTeamTotal({ period: "day", validated: 1 }, latest(5), "team_panthers")).toBeNull();
  });
  it("durations stay short (rapid sales never pile up)", () => {
    expect(celebrationMs("full", false)).toBeLessThanOrEqual(6000);
    expect(celebrationMs("lite", false)).toBeLessThan(celebrationMs("full", false));
    expect(celebrationMs("full", true)).toBeLessThan(celebrationMs("lite", false));
  });
});

describe("Teams celebration queue (store) and the bridge's routing", () => {
  beforeEach(() => {
    const s = useTeamCelebrationStore.getState();
    s.clear();
    useTeamCelebrationStore.setState({ seen: [], mounted: false, latest: null });
  });
  const mount = (validated = { sigma: 14, panthers: 12 }) => {
    useTeamCelebrationStore.getState().setMounted(true);
    useTeamCelebrationStore.getState().setLatest({
      period: "day",
      label: "Today",
      teams: [
        { id: "team_sigma", name: "Team Sigma", validated: validated.sigma, logoUrl: SIGMA.logoUrl, color: SIGMA.color, accentSecondary: null },
        { id: "team_panthers", name: "Team Panthers", validated: validated.panthers, logoUrl: PANTHERS.logoUrl, color: PANTHERS.color, accentSecondary: null },
      ],
    });
  };

  it("not on Teams Arena: the bridge leaves the sale to the standard card (returns false, nothing queued)", () => {
    expect(routeTeamSale(sale("A", SIGMA), true)).toBe(false);
    expect(useTeamCelebrationStore.getState().queue).toHaveLength(0);
  });
  it("on Teams Arena: queued once with the arrival baseline; stream + sync + other-tab repeats are consumed, never replayed", () => {
    mount();
    expect(routeTeamSale(sale("A", SIGMA), true)).toBe(true);
    expect(routeTeamSale(sale("A", SIGMA), true)).toBe(true); // repeat: handled (no standard card) but not queued again
    const st = useTeamCelebrationStore.getState();
    expect(st.queue).toHaveLength(1);
    expect(st.queue[0].baseline).toEqual({ period: "day", validated: 14 });
    st.next();
    useTeamCelebrationStore.getState().finish();
    expect(routeTeamSale(sale("A", SIGMA), true)).toBe(true); // after it was shown: still never replays
    expect(useTeamCelebrationStore.getState().queue).toHaveLength(0);
  });
  it("two quick sales queue in arrival order, one at a time", () => {
    mount();
    routeTeamSale(sale("S1", SIGMA), true);
    routeTeamSale(sale("P1", PANTHERS), true);
    const st = useTeamCelebrationStore.getState();
    expect(st.next()!.team.slug).toBe("sigma");
    expect(useTeamCelebrationStore.getState().next()).toBeNull(); // one on screen at a time
    useTeamCelebrationStore.getState().finish();
    expect(useTeamCelebrationStore.getState().next()!.team.slug).toBe("panthers");
  });
  it("leaving Teams Arena: drain gives every waiting sale back (for the standard card)", () => {
    mount();
    routeTeamSale(sale("S1", SIGMA), true);
    routeTeamSale(sale("S2", SIGMA), true);
    const left = useTeamCelebrationStore.getState().drain();
    expect(left.map((i) => i.event.id)).toEqual(["celeb_sale_S1", "celeb_sale_S2"]);
    expect(left[0].event.saleTeam).toEqual(SIGMA); // the original event, unchanged
  });
  it("unassigned / archived / unknown / switch off → standard card (bridge returns false)", () => {
    mount();
    expect(routeTeamSale(sale("U", null), true)).toBe(false);
    expect(routeTeamSale(sale("X", { ...SIGMA, active: false }), true)).toBe(false);
    expect(routeTeamSale(sale("K"), true)).toBe(false);
    expect(routeTeamSale(sale("O", SIGMA), false)).toBe(false);
    expect(routeTeamSale({ ...sale("P", SIGMA), preview: true }, true)).toBe(false);
    expect(useTeamCelebrationStore.getState().queue).toHaveLength(0);
  });
  it("a burst above any real rate is capped (oldest folded), never unbounded", () => {
    mount();
    for (let i = 0; i < TEAM_QUEUE_MAX + 5; i++) routeTeamSale(sale(`B${i}`, i % 2 ? SIGMA : PANTHERS), true);
    const q = useTeamCelebrationStore.getState().queue;
    expect(q).toHaveLength(TEAM_QUEUE_MAX);
    expect(q[q.length - 1].event.id).toBe(`celeb_sale_B${TEAM_QUEUE_MAX + 4}`);
  });
});

describe("stingers", () => {
  it("one original stinger per theme, short", () => {
    expect(stingerFor("lion")).toBe("royal");
    expect(stingerFor("panther")).toBe("electric");
    expect(stingerFor("crest")).toBe("neutral");
    for (const k of ["royal", "electric", "neutral"] as const) {
      const data = TEAM_STINGERS[k]();
      expect(data.length / 44100).toBeLessThanOrEqual(2.5);
      expect(Math.max(...Array.from(data, Math.abs))).toBeLessThanOrEqual(1);
    }
  });
  it("respects the master sound switch, the Sale category and the Teams stinger switch", () => {
    expect(playTeamStinger("lion", { soundEnabled: false, saleCategory: true, teamSaleSound: true })).toBe("muted");
    expect(playTeamStinger("lion", { soundEnabled: true, saleCategory: false, teamSaleSound: true })).toBe("muted");
    expect(playTeamStinger("lion", { soundEnabled: true, saleCategory: true, teamSaleSound: false })).toBe("muted");
    // Sound allowed but no browser audio context unlocked: stays silent (autoplay policy), never queued.
    expect(playTeamStinger("panther", { soundEnabled: true, saleCategory: true, teamSaleSound: true })).toBe("locked");
  });
});
