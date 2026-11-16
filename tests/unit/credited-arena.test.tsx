import React from "react";
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

const mocks = vi.hoisted(() => ({ query: vi.fn(), getSummary: vi.fn(), getClosers: vi.fn(), getStates: vi.fn() }));
vi.mock("@/database/client", () => ({ getDbPool: () => ({ query: mocks.query }) }));
vi.mock("@/backend/safequote/client", () => ({ getSafeQuoteClient: () => ({ isConfigured: () => true, ...mocks }) }));
// Render the same current store snapshot the browser subscribes to (SSR normally uses its initial seed).
vi.mock("@/frontend/stores/arena-store", async (original) => {
  const actual = await original<typeof import("@/frontend/stores/arena-store")>();
  return { ...actual, useArenaStore: Object.assign((selector: (s: ReturnType<typeof actual.useArenaStore.getState>) => unknown) => selector(actual.useArenaStore.getState()), actual.useArenaStore) };
});

beforeEach(() => {
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
    expect(screen).toContain(">1.5<");
    expect(screen).toMatch(/75(?:\.0)?%/);
    expect(targetProgress(summary.data.validated, 2)).toMatchObject({ completed: 1.5, remaining: 0.5, percent: 75 });
  });
  it("does not silently return raw counts if credited SQL fails", async () => {
    mocks.query.mockRejectedValue(new Error("database unavailable"));
    expect((await summaryGET(request("summary", ""))).status).toBe(500);
    expect((await closersGET(request("closers", ""))).status).toBe(500);
  });
});
