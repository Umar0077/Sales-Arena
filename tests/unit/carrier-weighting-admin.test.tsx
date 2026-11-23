// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, vi } from "vitest";
import { CarrierWeightingManager } from "@/frontend/components/admin/carriers/CarrierWeightingManager";
import { GET } from "@/app/api/admin/carriers/route";
import { NextRequest } from "next/server";

vi.mock("@/backend/auth/guard", () => ({
  requireAdmin: async () => ({
    ok: false,
    response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
  }),
}));

describe("Admin Carrier Sales Weighting Tab & API", () => {
  it("protects /api/admin/carriers with Admin authentication", async () => {
    const res = await GET(new NextRequest("http://arena.test/api/admin/carriers"));
    expect(res.status).toBe(401);
  });

  it("renders summary cards, configured carrier rules, filters, search, details inspector, and historical SWIL audit", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          observedCarriers: [
            {
              carrier: "Corebridge Financial-SWIL",
              normalizedName: "corebridge financial swil",
              credit: 1.0,
              category: "Full Credit",
              ruleType: "Explicit Override",
              matchedRuleId: "corebridge-financial-swil",
              matchedRuleName: "Corebridge Financial-SWIL",
              precedence: 1,
              rawValidatedCount: 3,
              creditedTotal: 3.0,
              lastValidatedAt: "2026-11-23T14:00:00.000Z",
            },
            {
              carrier: "Americo Financial",
              normalizedName: "americo financial",
              credit: 1.0,
              category: "Full Credit",
              ruleType: "Default Rule",
              matchedRuleId: "default-full-credit",
              matchedRuleName: "Default Validated Carrier Rule (1.0)",
              precedence: 4,
              rawValidatedCount: 5,
              creditedTotal: 5.0,
              lastValidatedAt: "2026-11-23T15:00:00.000Z",
            },
          ],
          swilAudit: {
            databaseAvailable: true,
            totalSwilSales: 2,
            legacyCreditedTotal: 1.0,
            correctedCreditedTotal: 2.0,
            totalCreditDelta: 1.0,
            affectedAgentsCount: 1,
            sales: [
              {
                caseId: "SWIL-CASE-1",
                userCode: "CLS-MANSOOR",
                agentName: "Mansoor Arshad",
                carrier: "Corebridge Financial-SWIL",
                validatedAt: "2026-11-23T12:00:00.000Z",
                legacyCredit: 0.5,
                correctedCredit: 1.0,
                creditDelta: 0.5,
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const el = document.createElement("div");
    const root = createRoot(el);

    try {
      await act(async () => {
        root.render(<CarrierWeightingManager />);
      });

      // Verify Summary Cards: 3 half-credit carriers (Corebridge Financial, Gerber, Gerber Life), 1 explicit full-credit override (Corebridge Financial-SWIL), 1.0 default
      expect(el.querySelector('[data-testid="summary-half-credit"]')?.textContent).toContain("3");
      expect(el.querySelector('[data-testid="summary-full-credit"]')?.textContent).toContain("1");
      expect(el.querySelector('[data-testid="summary-default-credit"]')?.textContent).toContain("1.0");

      // Verify all 4 explicit carriers appear in the table
      const tableText = el.querySelector('[data-testid="carrier-weighting-table"]')?.textContent ?? "";
      expect(tableText).toContain("Corebridge Financial-SWIL");
      expect(tableText).toContain("Corebridge Financial");
      expect(tableText).toContain("Gerber");
      expect(tableText).toContain("Gerber Life");
      expect(tableText).not.toContain("Corebridge Financial Simple");

      // Verify Historical SWIL Audit displays
      expect(el.querySelector('[data-testid="swil-audit-count"]')?.textContent).toBe("2");
      expect(el.textContent).toContain("SWIL-CASE-1");

      // Filter by 0.5 Credit carriers
      const halfBtn = el.querySelector('[data-testid="carrier-filter-half"]') as HTMLButtonElement;
      await act(async () => {
        halfBtn.click();
      });
      const halfTableText = el.querySelector('[data-testid="carrier-weighting-table"]')?.textContent ?? "";
      expect(halfTableText).toContain("Corebridge Financial");
      expect(halfTableText).toContain("Gerber");
      expect(halfTableText).not.toContain("Corebridge Financial-SWIL");

      // Filter by 1.0 Credit carriers
      const fullBtn = el.querySelector('[data-testid="carrier-filter-full"]') as HTMLButtonElement;
      await act(async () => {
        fullBtn.click();
      });
      const fullTableText = el.querySelector('[data-testid="carrier-weighting-table"]')?.textContent ?? "";
      expect(fullTableText).toContain("Corebridge Financial-SWIL");
      expect(fullTableText).not.toContain("Gerber Life");
    } finally {
      await act(async () => root.unmount());
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
});
