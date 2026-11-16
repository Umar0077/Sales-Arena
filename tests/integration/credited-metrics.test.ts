import { beforeAll, describe, expect, it, vi } from "vitest";
import { pool, resetDatabase, req, setSetting } from "./helpers";
import { ingestValidatedSale } from "@/backend/sales/ingest";
import { creditedMetrics } from "@/backend/sales/credited-metrics";
import { getCompanySaleWeight, sqlCarrierWeight } from "@/shared/sales/weighting";
import { GET as summaryGET } from "@/app/api/arena/summary/route";
import { GET as closersGET } from "@/app/api/arena/closers/route";
import { safeQuoteClosers } from "@/backend/teams/standings";
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
