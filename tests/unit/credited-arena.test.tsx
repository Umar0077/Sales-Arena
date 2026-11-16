import React from "react";
import { rankTeams, topPerformers } from "@/shared/teams/ranking";
import { TeamsScreen } from "@/frontend/components/arena/screens/TeamsScreen";
import type { TeamStandings } from "@/frontend/hooks/use-team-standings";
import { GET as teamsGET } from "@/app/api/arena/teams/route";
import { __resetStandingsMemo } from "@/backend/teams/standings";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { SafeQuoteCloserItemSchema, SafeQuoteSummarySchema } from "@/backend/safequote/schemas";
import { GET as summaryGET } from "@/app/api/arena/summary/route";
import { GET as closersGET } from "@/app/api/arena/closers/route";
import { GET as statesGET } from "@/app/api/arena/states/route";
import { useArenaStore } from "@/frontend/stores/arena-store";
import { LiveLeaderboard } from "@/frontend/components/arena/LiveLeaderboard";
import { TopPerformersPodium } from "@/frontend/components/arena/TopPerformersPodium";
import { KpiBar } from "@/frontend/components/arena/KpiBar";
import { PeriodScreen } from "@/frontend/components/arena/screens/PeriodScreen";
import { computeArenaStatistics } from "@/frontend/features/sales/stats";
import { targetProgress } from "@/shared/live/targets";

const mocks = vi.hoisted(() => ({ query: vi.fn(), getSummary: vi.fn(), getClosers: vi.fn(), getStates: vi.fn(), teams: null as TeamStandings | null }));
vi.mock("@/frontend/hooks/use-team-standings", () => ({ useTeamStandings: () => ({ data: mocks.teams, status: "ok" }) }));
vi.mock("@/database/client", () => ({ getDbPool: () => ({ query: mocks.query }) }));
vi.mock("@/backend/safequote/client", () => ({ getSafeQuoteClient: () => ({ isConfigured: () => true, ...mocks }) }));
// Render the same current store snapshot the browser subscribes to (SSR normally uses its initial seed).
vi.mock("@/frontend/stores/arena-store", async (original) => {
  const actual = await original<typeof import("@/frontend/stores/arena-store")>();
  return { ...actual, useArenaStore: Object.assign((selector: (s: ReturnType<typeof actual.useArenaStore.getState>) => unknown) => selector(actual.useArenaStore.getState()), actual.useArenaStore) };
});

beforeEach(() => {
  mocks.teams = null;
  __resetStandingsMemo();
  useArenaStore.getState().enterLiveMode();
  mocks.getSummary.mockResolvedValue(SafeQuoteSummarySchema.parse({ submitted: 2, validated: 2, closeRate: 100 }));
  mocks.getClosers.mockResolvedValue({ closers: [SafeQuoteCloserItemSchema.parse({ userCode: "CLS-MANSOOR", name: "Mansoor Arshad", submitted: 2, validated: 2, closeRate: 100 })] });
  mocks.getStates.mockResolvedValue({ states: [{ state: "TX", submitted: 2, validated: 2, closeRate: 100 }] });
  mocks.query.mockImplementation(async (sql: string) => sql.includes("FROM validated_sales")
    ? { rows: [{ key: sql.includes("user_code") ? "CLS-MANSOOR" : sql.includes("TRIM(state)") ? "TX" : "all", credited: "1.5", raw: 2 }] }
    : { rows: [] });
});

const request = (path: string, range: string) => new NextRequest("http://arena.test/api/arena/" + path + range);
describe("Mansoor Arshad: Aetna + Corebridge = 1.5 credits / 2 leads = 75%", () => {
  it.each(["day", "week", "month"] as const)("preserves API fractions through the %s store, leaderboard, podium and KPI rendering", async (period) => {
    const range = "?from=2026-11-16&to=2026-11-16&fresh=true";
    const summary = await (await summaryGET(request("summary", range))).json();
    const closers = await (await closersGET(request("closers", range))).json();
    const states = await (await statesGET(request("states", range))).json();
    expect(summary.data).toMatchObject({ validated: 1.5, rawValidated: 2, submitted: 2, closeRate: 75 });
    expect(closers.closers[0]).toMatchObject({ counts: { validated: 1.5, submitted: 2, pending: 0 }, rate: 75, rank: 1 });
    expect(closers.rawClosers[0].validated).toBe(2);
    expect(states.states[0]).toMatchObject({ validated: 1.5, submitted: 2, closeRate: 75 });
    useArenaStore.getState().setDataSourceMode("production");
    useArenaStore.getState().setPeriodMetrics(period, { summary: summary.data, closers: closers.closers });
    const board = renderToStaticMarkup(<LiveLeaderboard period={period} />);
    const podium = renderToStaticMarkup(<TopPerformersPodium rows={closers.closers} title="Top 3" subtitle="Credited sales" />);
    for (const html of [board, podium]) {
      expect(html).toContain("Mansoor Arshad");
      expect(html).toContain(">1.5<");
      expect(html).toContain("75%");
    }
    const screen = renderToStaticMarkup(period === "day"
      ? <KpiBar stats={computeArenaStatistics(useArenaStore.getState())} />
      : <PeriodScreen kind={period === "week" ? "weekly" : "monthly"} />);
    // The main total counts two transactions; credited performance remains 1.5.
    expect(screen).toMatch(period === "day"
      ? /kpi-number"><span>2<\/span>/
      : /data-testid="period-validated"><span>2<\/span>/);
    expect(useArenaStore.getState().periodMetrics?.[period]?.summary?.validated).toBe(1.5);
    expect(screen).toMatch(/75(?:\.0)?%/);
    expect(targetProgress(summary.data.validated, 2)).toMatchObject({ completed: 1.5, remaining: 0.5, percent: 75 });
    const teams = rankTeams([{ id: "sigma", name: "Team Sigma", slug: "sigma", logoUrl: null, color: "#7568FF", accentSecondary: null, displayOrder: 0, leaderUserCode: null,
      members: [{ userCode: "CLS-MANSOOR", name: "Mansoor Arshad", designation: null, submitted: 2, validated: 1.5, closeRate: 75 }] }])
      .map((team) => ({ ...team, rawValidated: 2 }));
    mocks.teams = { period, from: "2026-11-16", to: "2026-11-16", label: "Test period", teams, top: topPerformers(teams), leaderTeamId: "sigma", attribution: "", generatedAt: "" };
    const teamsHtml = renderToStaticMarkup(<TeamsScreen />);
    expect(teamsHtml).toMatch(/data-testid="team-validated" data-value="2"><span>2<\/span>/);
    expect(teamsHtml).toMatch(/data-testid="member-validated">1.5</);
  });
  it("does not silently return raw counts if credited SQL fails", async () => {
    mocks.query.mockRejectedValue(new Error("database unavailable"));
    expect((await summaryGET(request("summary", ""))).status).toBe(500);
    expect((await closersGET(request("closers", ""))).status).toBe(500);
  });
});


describe("actual transaction totals remain separate from credited performance", () => {
  it.each(["day", "week", "month"] as const)("shows five transactions, four credits and Mansoor's two credits in %s and Teams", async (period) => {
    const people = [
      { userCode: "MANSOOR", name: "Mansoor Arshad", submitted: 3, validated: 3, credits: 2 },
      { userCode: "ADEEL", name: "Adeel Afzal", submitted: 1, validated: 1, credits: 1 },
      { userCode: "ROGER", name: "Roger Robinson", submitted: 1, validated: 1, credits: 1 },
    ];
    mocks.getSummary.mockResolvedValue(SafeQuoteSummarySchema.parse({ submitted: 5, validated: 5, closeRate: 100 }));
    mocks.getClosers.mockResolvedValue({ closers: people.map((p) => SafeQuoteCloserItemSchema.parse(p)) });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("COUNT(DISTINCT s.case_id)")) return { rows: [{ id: "sigma", raw: 5 }] };
      if (sql.includes("FROM validated_sales")) return { rows: sql.includes("UPPER(TRIM(user_code))")
        ? people.map((p) => ({ key: p.userCode, credited: String(p.credits), raw: p.validated }))
        : [{ key: "all", credited: "4", raw: 5 }] };
      if (sql.includes("FROM teams WHERE")) return { rows: [{ id: "sigma", name: "Team Sigma", slug: "sigma", color: "#7568FF", display_order: 0 }] };
      if (sql.includes("FROM team_memberships m JOIN")) return { rows: people.map((p) => ({ team_id: "sigma", user_code: p.userCode, name: p.name, seg_from: "2026-11-01", seg_to: "2026-11-30", open: true })) };
      return { rows: [] };
    });
    const summary = await (await summaryGET(request("summary", ""))).json();
    const closers = await (await closersGET(request("closers", ""))).json();
    expect(summary.data).toMatchObject({ rawValidated: 5, validated: 4, submitted: 5, closeRate: 80 });
    expect(closers.closers[0]).toMatchObject({ counts: { validated: 2, submitted: 3 }, agent: { name: "Mansoor Arshad" } });
    useArenaStore.getState().setDataSourceMode("production");
    useArenaStore.getState().setPeriodMetrics(period, { summary: summary.data, closers: closers.closers });
    const screen = renderToStaticMarkup(period === "day" ? <KpiBar stats={computeArenaStatistics(useArenaStore.getState())} /> : <PeriodScreen kind={period === "week" ? "weekly" : "monthly"} />);
    expect(screen).toMatch(period === "day" ? /kpi-number"><span>5<\/span>/ : /data-testid="period-validated"><span>5<\/span>/);
    expect(screen).toMatch(/80(?:\.0)?%/);
    const teamResponse = await teamsGET(request("teams", "?period=" + period));
    expect(teamResponse.status).toBe(200);
    mocks.teams = await teamResponse.json();
    expect(mocks.teams!.teams[0]).toMatchObject({ rawValidated: 5, validated: 4, submitted: 5, closeRate: 80 });
    const teamsHtml = renderToStaticMarkup(<TeamsScreen />);
    expect(teamsHtml).toMatch(/data-testid="team-validated" data-value="5"><span>5<\/span>/);
    expect(teamsHtml).toMatch(/data-testid="member-validated">2</);
    expect(targetProgress(summary.data.validated, 5)).toMatchObject({ completed: 4, remaining: 1, percent: 80 });
    expect(useArenaStore.getState().periodMetrics?.[period]?.summary?.validated).toBe(4);
  });
});
