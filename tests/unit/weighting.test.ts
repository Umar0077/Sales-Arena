import { describe, it, expect } from "vitest";
import {
  getCompanySaleWeight,
  getValidatedSaleCredit,
  addCredits,
  roundCredit,
  formatSalesCount,
} from "@/shared/sales/weighting";
import { leadCountsByAgent, rankClosers, closedRate } from "@/shared/sales/leads";
import { targetProgress } from "@/shared/live/targets";
import { achievedTiers, planTierAward, type TierSale } from "@/backend/rewards/engine";
import type { RewardProgram } from "@/backend/rewards/programs";
import type { Sale, Agent } from "@/shared/types";

describe("Company-based 0.5 Sales Weighting Rule", () => {
  describe("getCompanySaleWeight", () => {
    it("assigns 0.5 to Gerber and its naming variations (case-insensitive)", () => {
      expect(getCompanySaleWeight("Gerber")).toBe(0.5);
      expect(getCompanySaleWeight("gerber")).toBe(0.5);
      expect(getCompanySaleWeight("GERBER")).toBe(0.5);
      expect(getCompanySaleWeight("Gerber Life")).toBe(0.5);
      expect(getCompanySaleWeight("Gerber Life Insurance Company")).toBe(0.5);
      expect(getCompanySaleWeight(undefined, "Gerber Whole Life")).toBe(0.5);
    });

    it("assigns 0.5 to Corebridge Financial and its naming variations (case-insensitive)", () => {
      expect(getCompanySaleWeight("Corebridge")).toBe(0.5);
      expect(getCompanySaleWeight("corebridge")).toBe(0.5);
      expect(getCompanySaleWeight("Corebridge Financial")).toBe(0.5);
      expect(getCompanySaleWeight("COREBRIDGE FINANCIAL")).toBe(0.5);
      expect(getCompanySaleWeight("AIG / Corebridge")).toBe(0.5);
      expect(getCompanySaleWeight(undefined, "Corebridge Term")).toBe(0.5);
    });

    it("assigns 1.0 to any other insurance carrier", () => {
      expect(getCompanySaleWeight("Americo")).toBe(1.0);
      expect(getCompanySaleWeight("Mutual of Omaha")).toBe(1.0);
      expect(getCompanySaleWeight("Aetna")).toBe(1.0);
      expect(getCompanySaleWeight("Transamerica")).toBe(1.0);
      expect(getCompanySaleWeight("American Amicable")).toBe(1.0);
      expect(getCompanySaleWeight("")).toBe(1.0);
      expect(getCompanySaleWeight(null, null)).toBe(1.0);
    });
  });

  describe("getValidatedSaleCredit", () => {
    it("returns 0 for unvalidated, pending, rejected, or duplicate leads regardless of carrier", () => {
      expect(getValidatedSaleCredit({ status: "pending", carrier: "Americo" })).toBe(0);
      expect(getValidatedSaleCredit({ status: "pending", carrier: "Gerber" })).toBe(0);
      expect(getValidatedSaleCredit({ status: "rejected", carrier: "Corebridge Financial" })).toBe(0);
      expect(getValidatedSaleCredit({ status: "duplicate", carrier: "Gerber" })).toBe(0);
      expect(getValidatedSaleCredit({ status: undefined, carrier: "Americo" })).toBe(0);
    });

    it("returns company weight for approved/validated sales", () => {
      expect(getValidatedSaleCredit({ status: "approved", carrier: "Americo" })).toBe(1.0);
      expect(getValidatedSaleCredit({ status: "approved", carrier: "Gerber" })).toBe(0.5);
      expect(getValidatedSaleCredit({ status: "approved", carrier: "Corebridge Financial" })).toBe(0.5);
      expect(getValidatedSaleCredit({ status: "validated", carrier: "Gerber" })).toBe(0.5);
      expect(getValidatedSaleCredit({ status: "validated", carrier: "Corebridge" })).toBe(0.5);
    });
  });

  describe("Half-Unit Arithmetic & Formatting", () => {
    it("addCredits performs exact half-unit addition without IEEE floating-point drift", () => {
      expect(addCredits(0.5, 0.5)).toBe(1.0);
      expect(addCredits(1.0, 0.5)).toBe(1.5);
      expect(addCredits(1.5, 0.5)).toBe(2.0);
      expect(addCredits(0.5, 0.5 + 0.5 + 0.5)).toBe(2.0);
    });

    it("formatSalesCount formats integers bare and half-units with one decimal", () => {
      expect(formatSalesCount(0)).toBe("0");
      expect(formatSalesCount(0.5)).toBe("0.5");
      expect(formatSalesCount(1)).toBe("1");
      expect(formatSalesCount(1.5)).toBe("1.5");
      expect(formatSalesCount(2)).toBe("2");
      expect(formatSalesCount(2.5)).toBe("2.5");
      expect(formatSalesCount(11)).toBe("11");
      expect(formatSalesCount(11.5)).toBe("11.5");
    });
  });

  describe("Prompt Test Case: Arsam Idrees Sales & Bonus Recalculation", () => {
    const makeSale = (id: string, carrier: string, status: "approved" | "pending" = "approved"): Sale => ({
      id,
      agentId: "agt_arsam",
      teamId: "t_sigma",
      campaignId: "cmp_fe",
      status,
      product: `${carrier} Policy`,
      value: 100,
      createdAt: new Date().toISOString(),
      approvedAt: status === "approved" ? new Date().toISOString() : null,
      source: "safequote-api",
      carrier,
    });

    it("calculates 8 Americo + 4 Corebridge + 2 Gerber = 11.0 credited sales (14 submitted)", () => {
      const sales: Sale[] = [
        ...Array.from({ length: 8 }, (_, i) => makeSale(`am_${i}`, "Americo")),
        ...Array.from({ length: 4 }, (_, i) => makeSale(`cb_${i}`, "Corebridge Financial")),
        ...Array.from({ length: 2 }, (_, i) => makeSale(`gb_${i}`, "Gerber")),
      ];

      const counts = leadCountsByAgent(sales).get("agt_arsam");
      expect(counts).toBeDefined();
      expect(counts?.submitted).toBe(14);
      expect(counts?.validated).toBe(11.0); // 8*1.0 + 4*0.5 + 2*0.5 = 11.0
      expect(counts?.pending).toBe(0);
      expect(closedRate(counts!)).toBeCloseTo((11.0 / 14) * 100, 2);
    });

    const makeProgram = (salesRequired: number, amount: number, id: string): RewardProgram => ({
      id,
      name: `${salesRequired} Sales Tier`,
      kind: "daily",
      rewardType: "cash",
      amount,
      currency: "PKR",
      prizeLabel: "",
      salesRequired,
      maxAwards: 1,
      maxTotalAwards: null,
      startDate: null,
      endDate: null,
      enabled: true,
      audience: "all",
      scopeType: "all",
      scopeIds: [],
      tierPolicy: "highest_tier",
      rewardGroup: "default",
      stackable: false,
      showOnArena: true,
      revision: 1,
      createdAt: "2026-01-01T00:00:00Z",
      activeSince: null,
      description: "",
      headline: "",
      message: "",
      rewardLine: "",
      sound: "default",
      accent: "#FFD700",
      popupSeconds: 5,
      leaderboardCount: 10,
      archivedAt: null,
      status: "active",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    it("highest-tier bonus engine qualifies Arsam Idrees using 11 credits, not 14 raw sales", () => {
      // 8 Americo (8.0) + 4 Corebridge (2.0) + 2 Gerber (1.0) = 11.0 credits
      const tierSales: TierSale[] = [
        ...Array.from({ length: 8 }, (_, i) => ({
          id: `am_${i}`,
          caseId: `CASE_AM_${i}`,
          validatedAt: new Date(2026, 9, 15, 10, i),
          source: "live",
          approved: false,
          carrier: "Americo",
        })),
        ...Array.from({ length: 4 }, (_, i) => ({
          id: `cb_${i}`,
          caseId: `CASE_CB_${i}`,
          validatedAt: new Date(2026, 9, 15, 11, i),
          source: "live",
          approved: false,
          carrier: "Corebridge Financial",
        })),
        ...Array.from({ length: 2 }, (_, i) => ({
          id: `gb_${i}`,
          caseId: `CASE_GB_${i}`,
          validatedAt: new Date(2026, 9, 15, 12, i),
          source: "live",
          approved: false,
          carrier: "Gerber",
        })),
      ];

      const mockPrograms: RewardProgram[] = [
        makeProgram(10, 5000, "p_tier_10"),
        makeProgram(12, 8000, "p_tier_12"),
        makeProgram(14, 12000, "p_tier_14"),
      ];

      const window = {
        key: "2026-10-15",
        start: new Date(2026, 9, 15, 0, 0, 0),
        end: new Date(2026, 9, 15, 23, 59, 59),
        detailedLabel: "Oct 15",
      };

      // In the old unweighted engine, 14 sales achieved Tier 14 (12,000 PKR).
      // In the new weighted engine, 11 credits ONLY achieves Tier 10 (5,000 PKR).
      const achieved = achievedTiers(mockPrograms, tierSales, window, null);
      expect(achieved).toHaveLength(1);
      expect(achieved[0].program.id).toBe("p_tier_10");
      expect(achieved[0].credits).toBe(11.0);

      // Verify planTierAward identifies the correct trigger sale
      const plan = planTierAward(achieved, [], "ARSAM", "2026-10-15", () => false);
      expect(plan).not.toBeNull();
      expect(plan?.program.id).toBe("p_tier_10");
      expect(plan?.incrementAmount).toBe(5000);
      expect(plan?.trigger.id).toBe("cb_3"); // 8 Americo (8.0) + 4 Corebridge (2.0) = 10.0 credits! cb_3 is the trigger!
    });
  });

  describe("Target Progress with Fractional Units", () => {
    it("preserves half-unit completed and remaining without integer truncation", () => {
      const p1 = targetProgress(2.5, 10);
      expect(p1.completed).toBe(2.5);
      expect(p1.target).toBe(10);
      expect(p1.remaining).toBe(7.5);
      expect(p1.percent).toBe(25);

      const p2 = targetProgress(0.5, 8);
      expect(p2.completed).toBe(0.5);
      expect(p2.remaining).toBe(7.5);
      expect(p2.percent).toBeCloseTo((0.5 / 8) * 100);

      const p3 = targetProgress(11.5, 10);
      expect(p3.completed).toBe(11.5);
      expect(p3.remaining).toBe(0);
      expect(p3.percent).toBe(115);
    });
  });

  describe("Leaderboard Ranking with Weighted Sales", () => {
    it("ranks by weighted validated sales first, then submitted leads", () => {
      const agentA: Agent = {
        id: "agt_a",
        name: "Agent Americo",
        initials: "AA",
        teamId: "t1",
        campaignId: "c1",
        active: true,
        title: "Closer",
        hue: 100,
        joinedAt: "2026-01-01",
      };
      const agentG: Agent = {
        id: "agt_g",
        name: "Agent Gerber",
        initials: "AG",
        teamId: "t1",
        campaignId: "c1",
        active: true,
        title: "Closer",
        hue: 200,
        joinedAt: "2026-01-01",
      };

      // Agent G has 3 Gerber sales = 1.5 credits (3 submitted)
      // Agent A has 2 Americo sales = 2.0 credits (2 submitted)
      const sales: Sale[] = [
        {
          id: "s_g1",
          agentId: "agt_g",
          teamId: "t1",
          campaignId: "c1",
          status: "approved",
          product: "Gerber",
          value: 50,
          createdAt: "2026-10-15T10:00:00Z",
          approvedAt: "2026-10-15T10:00:00Z",
          source: "safequote-api",
          carrier: "Gerber",
        },
        {
          id: "s_g2",
          agentId: "agt_g",
          teamId: "t1",
          campaignId: "c1",
          status: "approved",
          product: "Gerber",
          value: 50,
          createdAt: "2026-10-15T10:01:00Z",
          approvedAt: "2026-10-15T10:01:00Z",
          source: "safequote-api",
          carrier: "Gerber",
        },
        {
          id: "s_g3",
          agentId: "agt_g",
          teamId: "t1",
          campaignId: "c1",
          status: "approved",
          product: "Gerber",
          value: 50,
          createdAt: "2026-10-15T10:02:00Z",
          approvedAt: "2026-10-15T10:02:00Z",
          source: "safequote-api",
          carrier: "Gerber",
        },
        {
          id: "s_a1",
          agentId: "agt_a",
          teamId: "t1",
          campaignId: "c1",
          status: "approved",
          product: "Americo",
          value: 50,
          createdAt: "2026-10-15T10:00:00Z",
          approvedAt: "2026-10-15T10:00:00Z",
          source: "safequote-api",
          carrier: "Americo",
        },
        {
          id: "s_a2",
          agentId: "agt_a",
          teamId: "t1",
          campaignId: "c1",
          status: "approved",
          product: "Americo",
          value: 50,
          createdAt: "2026-10-15T10:01:00Z",
          approvedAt: "2026-10-15T10:01:00Z",
          source: "safequote-api",
          carrier: "Americo",
        },
      ];

      const rows = rankClosers({ agents: [agentA, agentG], sales });
      expect(rows).toHaveLength(2);
      // Agent A (2.0 validated) ranks 1st over Agent G (1.5 validated) even though Agent G had 3 raw sales
      expect(rows[0].agent.id).toBe("agt_a");
      expect(rows[0].counts.validated).toBe(2.0);
      expect(rows[0].rank).toBe(1);

      expect(rows[1].agent.id).toBe("agt_g");
      expect(rows[1].counts.validated).toBe(1.5);
      expect(rows[1].rank).toBe(2);
    });
  });
});
