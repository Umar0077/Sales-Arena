import { beforeAll, describe, expect, it, vi } from "vitest";
import { pool, resetDatabase, req, setSetting } from "./helpers";
import { ingestValidatedSale } from "@/backend/sales/ingest";
import { creditedMetrics } from "@/backend/sales/credited-metrics";
import { getCompanySaleWeight, sqlCarrierWeight } from "@/shared/sales/weighting";
import { GET as summaryGET } from "@/app/api/arena/summary/route";
import { GET as closersGET } from "@/app/api/arena/closers/route";
import { computeStandings, safeQuoteClosers } from "@/backend/teams/standings";
import { arenaBroadcaster } from "@/backend/events/broadcaster";
import { SafeQuoteCloserItemSchema, SafeQuoteSummarySchema } from "@/backend/safequote/schemas";

vi.mock("@/backend/safequote/client", () => ({ getSafeQuoteClient: () => ({
  isConfigured: () => true,
  getSummary: async () => SafeQuoteSummarySchema.parse({ submitted: 2, validated: 2, closeRate: 100 }),
  getClosers: async () => ({ closers: [SafeQuoteCloserItemSchema.parse({ userCode: "CLS-MANSOOR", name: "Mansoor Arshad", submitted: 2, validated: 2, closeRate: 100 })] }),
}) }));

describe("credited PostgreSQL metrics and unmodified sale delivery", () => {
  beforeAll(async () => {
    await resetDatabase();
    await setSetting("arena.config", { values: { businessTimezone: "Asia/Karachi" } });
  });
  it("SQL and JavaScript agree for all carrier variants, including null and unknown", async () => {
    const carriers = ["Aetna", "Gerber", " GERBER LIFE ", "Corebridge Financial", "AIG / corebridge", "Other", "", null];
    const result = await pool().query("SELECT carrier, " + sqlCarrierWeight("carrier") + " AS credit FROM unnest($1::text[]) AS t(carrier)", [carriers]);
    expect(result.rows.map((r) => Number(r.credit))).toEqual(carriers.map((c) => getCompanySaleWeight(c)));
  });
  it("Mansoor gets two sale events, two raw records, 1.5 credits and 75% across current/historical APIs and Teams", async () => {
    const events: string[] = [];
    const off = arenaBroadcaster.subscribe((e) => { if (e.type === "sale.validated") events.push(e.type); });
    const sale = (caseId: string, carrier: string) => ({ caseId, carrier, userCode: "CLS-MANSOOR", closerName: "Mansoor Arshad", validatedAt: "2026-11-16T19:00:00.000Z", premium: 10 });
    try {
      await ingestValidatedSale(pool(), sale("MANSOOR-AETNA", "Aetna"), "sse");
      await ingestValidatedSale(pool(), sale("MANSOOR-COREBRIDGE", "Corebridge Financial"), "sse");
      await ingestValidatedSale(pool(), sale("MANSOOR-COREBRIDGE", "Corebridge Financial"), "sse");
    } finally { off(); }
    expect(events).toHaveLength(2);
    expect((await pool().query("SELECT carrier FROM validated_sales ORDER BY carrier")).rows).toEqual([{ carrier: "Aetna" }, { carrier: "Corebridge Financial" }]);
    // 19:00 UTC is exactly midnight Nov 17 in Karachi: inclusive lower / exclusive upper bounds.
    expect((await creditedMetrics({ from: "2026-11-16", to: "2026-11-16" })).get("all")).toBeUndefined();
    for (const range of ["from=2026-11-17&to=2026-11-17", "from=2026-11-16&to=2026-11-22", "from=2026-11-01&to=2026-11-30", ""]) {
      const summary = await (await summaryGET(req("/api/arena/summary?" + range))).json();
      const closers = await (await closersGET(req("/api/arena/closers?" + range))).json();
      expect(summary.data).toMatchObject({ validated: 1.5, rawValidated: 2, submitted: 2, closeRate: 75 });
      expect(closers.closers[0]).toMatchObject({ counts: { validated: 1.5, submitted: 2, pending: 0 }, rate: 75 });
      expect(closers.rawClosers[0].validated).toBe(2);
    }
    expect((await safeQuoteClosers("2026-11-17", "2026-11-17")).get("CLS-MANSOOR")).toEqual({ submitted: 2, validated: 1.5, closeRate: 75 });
    expect((await pool().query("SELECT COUNT(*)::int AS n FROM validated_sales")).rows[0].n).toBe(2);
  });
});


describe("five actual transactions versus four credits", () => {
  it("deduplicates replays and respects team membership dates and validation status", async () => {
    await resetDatabase();
    await setSetting("arena.config", { values: { businessTimezone: "Asia/Karachi", weekStartDay: 1 } });
    const cases = [
      ["M1", "MANSOOR", "Corebridge Financial"], ["M2", "MANSOOR", "Corebridge Financial"],
      ["M3", "MANSOOR", "Aetna"], ["A1", "ADEEL", "Aetna"], ["R1", "ROGER", "Aetna"],
    ];
    let events = 0;
    const off = arenaBroadcaster.subscribe((e) => { if (e.type === "sale.validated") events++; });
    try {
      for (const [caseId, userCode, carrier] of [...cases, ...cases]) {
        await ingestValidatedSale(pool(), { caseId, userCode, carrier, validatedAt: "2026-11-17T08:00:00Z", premium: 10 }, "sse");
      }
    } finally { off(); }
    expect(events).toBe(5);
    expect((await creditedMetrics({ from: "2026-11-17", to: "2026-11-17" })).get("all")).toEqual({ rawValidated: 5, validated: 4 });
    expect((await creditedMetrics({ from: "2026-11-17", to: "2026-11-17" }, "user")).get("MANSOOR")).toEqual({ rawValidated: 3, validated: 2 });
    await pool().query("INSERT INTO teams (id, name, slug) VALUES ('sigma', 'Team Sigma', 'sigma'), ('old', 'Old Team', 'old')");
    for (const code of ["MANSOOR", "ADEEL", "ROGER"]) {
      await pool().query("INSERT INTO team_memberships (team_id, user_code, effective_from) VALUES ('sigma', $1, '2026-11-17')", [code]);
    }
    // An earlier sale belongs to the old team. A returned transaction never counts.
    await pool().query("INSERT INTO team_memberships (team_id, user_code, effective_from, effective_to) VALUES ('old', 'MANSOOR', '2026-11-01', '2026-11-17')");
    await ingestValidatedSale(pool(), { caseId: "EARLIER", userCode: "MANSOOR", carrier: "Gerber Life", validatedAt: "2026-11-16T08:00:00Z", premium: 10 }, "backfill");
    await ingestValidatedSale(pool(), { caseId: "RETURNED", userCode: "MANSOOR", carrier: "Aetna", validatedAt: "2026-11-17T08:00:00Z", premium: 10 }, "backfill");
    await pool().query("UPDATE validated_sales SET status = 'returned' WHERE case_id = 'RETURNED'");
    const closers = async () => new Map([
      ["MANSOOR", { submitted: 3, validated: 2, closeRate: 200 / 3 }],
      ["ADEEL", { submitted: 1, validated: 1, closeRate: 100 }],
      ["ROGER", { submitted: 1, validated: 1, closeRate: 100 }],
    ]);
    for (const period of ["day", "week", "month"] as const) {
      const result = await computeStandings(pool(), period, { now: new Date("2026-11-17T10:00:00Z"), closers });
      expect(result.teams.find((t) => t.id === "sigma")?.rawValidated).toBe(5);
      expect(result.teams.find((t) => t.id === "old")?.rawValidated).toBe(period === "day" ? 0 : 1);
    }
  });
});
