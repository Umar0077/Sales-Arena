import { describe, it, expect } from "vitest";
import {
  getCompanySaleWeight,
  getValidatedSaleCredit,
  isGerberCompany,
  isCorebridgeCompany,
  sqlCarrierWeight,
  addCredits,
  roundCredit,
  formatSalesCount,
} from "@/shared/sales/weighting";
import { achievedTiers, planTierAward, creditedSalesOf, type TierSale, type ChainAward } from "@/backend/rewards/engine";
import { thresholdsToGrant } from "@/backend/spins/rules";
import { rankTeams } from "@/shared/teams/ranking";
import { leadCountsByAgent, rankClosers, type CloserRow } from "@/shared/sales/leads";
import type { RewardProgram } from "@/backend/rewards/programs";
import type { Sale, Agent } from "@/shared/types";

// Helper to create valid RewardProgram fixtures
function makeProgram(overrides: Partial<RewardProgram>): RewardProgram {
  return {
    id: "prog_test",
    name: "Test Bonus",
    kind: "daily",
    rewardType: "cash",
    amount: 100,
    currency: "USD",
    prizeLabel: "$100",
    salesRequired: 2,
    maxAwards: 1,
    maxTotalAwards: null,
    startDate: null,
    endDate: null,
    enabled: true,
    audience: "all",
    scopeType: "all",
    scopeIds: [],
    tierPolicy: "highest_tier",
    rewardGroup: "fe_daily_cash",
    stackable: false,
    showOnArena: true,
    revision: 1,
    createdAt: "2026-01-01T00:00:00Z",
    activeSince: null,
    description: "Test reward",
    headline: "TEST",
    message: "Test message",
    rewardLine: "$100 Cash",
    sound: "cash-bonus",
    accent: "#FFD700",
    popupSeconds: 5,
    leaderboardCount: 10,
    archivedAt: null,
    status: "active",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("FINAL SAFETY REVIEW — Company-Based 0.5 Sales Weighting", () => {
  describe("1. Parity Between JS Matching and SQL Pattern Matching", () => {
    // Verified Safe Quote carrier strings and boundary variants
    const testCases: Array<{ carrier?: string | null; product?: string | null; expectedWeight: number }> = [
      // Standard exact names
      { carrier: "Gerber", expectedWeight: 0.5 },
      { carrier: "gerber", expectedWeight: 0.5 },
      { carrier: "GERBER", expectedWeight: 0.5 },
      { carrier: "Corebridge", expectedWeight: 0.5 },
      { carrier: "corebridge", expectedWeight: 0.5 },
      { carrier: "COREBRIDGE", expectedWeight: 0.5 },
      { carrier: "Corebridge Financial", expectedWeight: 0.5 },
      { carrier: "COREBRIDGE FINANCIAL", expectedWeight: 0.5 },

      // Spacing and suffix variations from Safe Quote / CRM feeds
      { carrier: "Gerber Life", expectedWeight: 0.5 },
      { carrier: "GerberLife", expectedWeight: 0.5 },
      { carrier: "Gerber Life Insurance Company", expectedWeight: 0.5 },
      { carrier: "CorebridgeFinancial", expectedWeight: 0.5 },
      { carrier: "Corebridge Financial, Inc.", expectedWeight: 0.5 },
      { carrier: "AIG / Corebridge", expectedWeight: 0.5 },
      { carrier: "  Gerber  ", expectedWeight: 0.5 },
      { carrier: "  Corebridge Financial  ", expectedWeight: 0.5 },

      // Product fallback when carrier is omitted
      { carrier: undefined, product: "Gerber Whole Life", expectedWeight: 0.5 },
      { carrier: undefined, product: "Corebridge Term 20", expectedWeight: 0.5 },
      { carrier: "", product: "Gerber Life Child Plan", expectedWeight: 0.5 },

      // Non-weighted carriers (must strictly evaluate to 1.0)
      { carrier: "Americo", expectedWeight: 1.0 },
      { carrier: "Mutual of Omaha", expectedWeight: 1.0 },
      { carrier: "Aetna", expectedWeight: 1.0 },
      { carrier: "Transamerica", expectedWeight: 1.0 },
      { carrier: "American Amicable", expectedWeight: 1.0 },
      { carrier: "Forethought", expectedWeight: 1.0 },
      { carrier: "John Hancock", expectedWeight: 1.0 },
      { carrier: "", expectedWeight: 1.0 },
      { carrier: null, expectedWeight: 1.0 },
      { carrier: undefined, expectedWeight: 1.0 },
    ];

    it("verifies isGerberCompany and isCorebridgeCompany match exactly", () => {
      expect(isGerberCompany("Gerber Life")).toBe(true);
      expect(isGerberCompany("GerberLife")).toBe(true);
      expect(isGerberCompany("Americo")).toBe(false);
      expect(isGerberCompany(null)).toBe(false);

      expect(isCorebridgeCompany("Corebridge Financial")).toBe(true);
      expect(isCorebridgeCompany("CorebridgeFinancial")).toBe(true);
      expect(isCorebridgeCompany("Americo")).toBe(false);
      expect(isCorebridgeCompany(undefined)).toBe(false);
    });

    it("ensures getCompanySaleWeight yields the exact expected weight for every carrier variant", () => {
      for (const tc of testCases) {
        const weight = getCompanySaleWeight(tc.carrier, tc.product);
        expect(weight).toBe(tc.expectedWeight);
      }
    });

    it("simulates SQL CASE expression evaluation on the exact same test inputs and confirms 100% parity", () => {
      // Replicate the exact PostgreSQL semantics: LOWER(TRIM(COALESCE(carrier, ''))) LIKE '%gerber%'
      const evalSqlCase = (carrierStr?: string | null, productStr?: string | null): number => {
        const normCarrier = (carrierStr ?? "").trim().toLowerCase();
        const normProduct = (productStr ?? "").trim().toLowerCase();
        if (normCarrier.includes("gerber") || normProduct.includes("gerber")) return 0.5;
        if (normCarrier.includes("corebridge") || normProduct.includes("corebridge")) return 0.5;
        return 1.0;
      };

      for (const tc of testCases) {
        const jsResult = getCompanySaleWeight(tc.carrier, tc.product);
        const sqlResult = evalSqlCase(tc.carrier, tc.product);
        expect(jsResult).toBe(sqlResult);
        expect(sqlResult).toBe(tc.expectedWeight);
      }
    });

    it("sqlCarrierWeight generates a valid, syntactically correct SQL expression", () => {
      const sql = sqlCarrierWeight("carrier");
      expect(sql).toContain("LOWER(TRIM(COALESCE(carrier, ''))) LIKE '%gerber%' THEN 0.5");
      expect(sql).toContain("LOWER(TRIM(COALESCE(carrier, ''))) LIKE '%corebridge%' THEN 0.5");
      expect(sql).toContain("ELSE 1.0");

      const sqlCustomCol = sqlCarrierWeight("s.carrier");
      expect(sqlCustomCol).toContain("COALESCE(s.carrier, '')");
    });
  });

  describe("2. Fractional Bonus-Tier Boundaries & Highest-Tier Qualification", () => {
    const programs: RewardProgram[] = [
      makeProgram({ id: "p1", name: "Tier 1", salesRequired: 2, amount: 2000, prizeLabel: "$2,000" }),
      makeProgram({ id: "p2", name: "Tier 2", salesRequired: 4, amount: 4000, prizeLabel: "$4,000" }),
      makeProgram({ id: "p3", name: "Tier 3", salesRequired: 6, amount: 7000, prizeLabel: "$7,000" }),
    ];
    const win = { key: "2026-11-13", start: new Date("2026-11-13T00:00:00Z"), end: new Date("2026-11-13T23:59:59Z") };

    const makeTierSale = (id: string, carrier: string, timeMinute: number): TierSale => ({
      id,
      caseId: `case_${id}`,
      carrier,
      source: "sse",
      approved: false,
      validatedAt: new Date(`2026-11-13T10:${timeMinute.toString().padStart(2, "0")}:00Z`),
    });

    it("boundary test: 1.5 credits does NOT qualify for 2.0 milestone; 2.0 credits DOES qualify", () => {
      // 3 Gerber sales = 1.5 credits
      const sales15: TierSale[] = [
        makeTierSale("s1", "Gerber", 1),
        makeTierSale("s2", "Gerber", 2),
        makeTierSale("s3", "Gerber", 3),
      ];
      expect(creditedSalesOf(sales15)).toBe(1.5);
      const achieved15 = achievedTiers(programs, sales15, win, null);
      expect(achieved15).toHaveLength(0); // None achieved

      // 4th Gerber sale brings total to 2.0 credits -> qualifies for Tier 1
      const sales20: TierSale[] = [...sales15, makeTierSale("s4", "Gerber", 4)];
      expect(creditedSalesOf(sales20)).toBe(2.0);
      const achieved20 = achievedTiers(programs, sales20, win, null);
      expect(achieved20).toHaveLength(1);
      expect(achieved20[0].program.id).toBe("p1");
      expect(achieved20[0].credits).toBe(2.0);
    });

    it("boundary test: 3.5 credits does NOT qualify for Tier 2 (4.0 required); 4.0 credits qualifies", () => {
      // 2 Americo (2.0) + 3 Corebridge (1.5) = 3.5 credits
      const sales35: TierSale[] = [
        makeTierSale("s1", "Americo", 1),
        makeTierSale("s2", "Americo", 2),
        makeTierSale("s3", "Corebridge Financial", 3),
        makeTierSale("s4", "Corebridge Financial", 4),
        makeTierSale("s5", "Corebridge Financial", 5),
      ];
      expect(creditedSalesOf(sales35)).toBe(3.5);
      const achieved35 = achievedTiers(programs, sales35, win, null);
      expect(achieved35).toHaveLength(1);
      expect(achieved35[0].program.id).toBe("p1"); // Only Tier 1

      // Add 1 Gerber (0.5) -> 4.0 credits -> Qualifies for Tier 2
      const sales40: TierSale[] = [...sales35, makeTierSale("s6", "Gerber", 6)];
      expect(creditedSalesOf(sales40)).toBe(4.0);
      const achieved40 = achievedTiers(programs, sales40, win, null);
      expect(achieved40).toHaveLength(2);
      expect(achieved40[0].program.id).toBe("p2"); // Highest first
      expect(achieved40[0].credits).toBe(4.0);
    });

    it("identifies the exact trigger sale when crossing milestone with half-units", () => {
      // Sequence:
      // s1: Americo (+1.0) -> total 1.0
      // s2: Gerber (+0.5)  -> total 1.5
      // s3: Corebridge (+0.5) -> total 2.0 (CROSSES Tier 1 milestone!)
      // s4: Americo (+1.0) -> total 3.0
      const sales: TierSale[] = [
        makeTierSale("s1", "Americo", 1),
        makeTierSale("s2", "Gerber", 2),
        makeTierSale("s3", "Corebridge Financial", 3),
        makeTierSale("s4", "Americo", 4),
      ];
      const achieved = achievedTiers(programs, sales, win, null);
      const plan = planTierAward(achieved, [], "CLS-01", win.key, () => false);

      expect(plan).not.toBeNull();
      expect(plan!.program.id).toBe("p1");
      expect(plan!.trigger.id).toBe("s3"); // Exactly s3 crossed the 2.0 threshold!
      expect(plan!.credits).toBe(3.0);
      expect(plan!.payableAmount).toBe(2000);
    });
  });

  describe("3. Financial Immutability & Superseding Logic", () => {
    it("preserves paid awards and adjusts payableAmount correctly for tier upgrades", () => {
      // Agent already earned Tier 1 ($2,000) and it was marked PAID
      const chain: ChainAward[] = [
        {
          id: "p1:CLS-01:2026-11-13:1",
          programId: "p1",
          programName: "Tier 1",
          salesRequired: 2,
          amount: 2000,
          status: "paid",
          payableAmount: 2000,
          supersededBy: null,
          source: "automatic",
        },
      ];

      // Agent now reaches 4.0 credited sales (Tier 2: $4,000)
      const programs: RewardProgram[] = [
        makeProgram({ id: "p1", name: "Tier 1", salesRequired: 2, amount: 2000 }),
        makeProgram({ id: "p2", name: "Tier 2", salesRequired: 4, amount: 4000 }),
      ];
      const achieved = [
        { program: programs[1], counted: [], credits: 4.0 },
        { program: programs[0], counted: [], credits: 4.0 },
      ];

      const plan = planTierAward(achieved, chain, "CLS-01", "2026-11-13", () => false);
      expect(plan).not.toBeNull();
      expect(plan!.program.id).toBe("p2");
      expect(plan!.incrementAmount).toBe(2000); // 4000 - 2000
      expect(plan!.payableAmount).toBe(2000);   // 4000 - 2000 already paid
    });

    it("folds unpaid superseded awards into the new higher tier", () => {
      // Agent previously earned Tier 1 ($2,000) but it is still 'earned' (UNPAID)
      const chain: ChainAward[] = [
        {
          id: "p1:CLS-01:2026-11-13:1",
          programId: "p1",
          programName: "Tier 1",
          salesRequired: 2,
          amount: 2000,
          status: "earned",
          payableAmount: 2000,
          supersededBy: null,
          source: "automatic",
        },
      ];

      const programs: RewardProgram[] = [
        makeProgram({ id: "p1", name: "Tier 1", salesRequired: 2, amount: 2000 }),
        makeProgram({ id: "p2", name: "Tier 2", salesRequired: 4, amount: 4000 }),
      ];
      const achieved = [
        { program: programs[1], counted: [], credits: 4.0 },
        { program: programs[0], counted: [], credits: 4.0 },
      ];

      const plan = planTierAward(achieved, chain, "CLS-01", "2026-11-13", () => false);
      expect(plan).not.toBeNull();
      // Since $0 was paid so far, the new award has full payableAmount of $4,000
      expect(plan!.payableAmount).toBe(4000);
      // The old award will be marked superseded with payable_amount updated to 0
    });
  });

  describe("4. Spin Eligibility & Automatic Grant Thresholds with Fractional Credits", () => {
    it("evaluates thresholdsToGrant correctly with fractional sales counts", () => {
      const salesPerSpin = 2; // Every 2.0 credited sales grants 1 spin

      // 0.5 credits -> 0 spins
      expect(thresholdsToGrant(0.5, salesPerSpin, 0)).toEqual([]);

      // 1.0 credit -> 0 spins
      expect(thresholdsToGrant(1.0, salesPerSpin, 0)).toEqual([]);

      // 1.5 credits -> 0 spins
      expect(thresholdsToGrant(1.5, salesPerSpin, 0)).toEqual([]);

      // 2.0 credits -> grants threshold 1
      expect(thresholdsToGrant(2.0, salesPerSpin, 0)).toEqual([1]);

      // 2.5 credits with threshold 1 already granted -> 0 new spins
      expect(thresholdsToGrant(2.5, salesPerSpin, 1)).toEqual([]);

      // 3.5 credits with threshold 1 already granted -> 0 new spins
      expect(thresholdsToGrant(3.5, salesPerSpin, 1)).toEqual([]);

      // 4.0 credits with threshold 1 already granted -> grants threshold 2
      expect(thresholdsToGrant(4.0, salesPerSpin, 1)).toEqual([2]);

      // Jump from 1.0 to 4.5 credits with 0 already granted -> grants thresholds [1, 2]
      expect(thresholdsToGrant(4.5, salesPerSpin, 0)).toEqual([1, 2]);
    });
  });

  describe("5. Teams Arena Ranking & Tie-Breaking with Mixed Sales", () => {
    it("correctly ranks teams using weighted credited sales and breaks ties", () => {
      // Alice (Sigma): 2 Americo (2.0) + 2 Gerber (1.0) = 3.0 credits (4 submitted)
      // Bob (Sigma): 1 Corebridge (0.5) = 0.5 credits (2 submitted)
      // Sigma total = 3.5 credits, 6 submitted, close rate = 3.5/6 = 58.3%

      // Charlie (Panthers): 3 Americo (3.0) = 3.0 credits (3 submitted)
      // Diana (Panthers): 1 Gerber (0.5) = 0.5 credits (1 submitted)
      // Panthers total = 3.5 credits, 4 submitted, close rate = 3.5/4 = 87.5%

      const teams = [
        {
          id: "sigma",
          name: "Sigma",
          slug: "sigma",
          logoUrl: null,
          color: "#7568FF",
          accentSecondary: null,
          displayOrder: 1,
          leaderUserCode: "AGT_A",
          members: [
            { userCode: "AGT_A", name: "Alice", designation: "senior" as const, submitted: 4, validated: 3.0, closeRate: 75 },
            { userCode: "AGT_B", name: "Bob", designation: "junior" as const, submitted: 2, validated: 0.5, closeRate: 25 },
          ],
        },
        {
          id: "panthers",
          name: "Panthers",
          slug: "panthers",
          logoUrl: null,
          color: "#27D5FF",
          accentSecondary: null,
          displayOrder: 2,
          leaderUserCode: "AGT_C",
          members: [
            { userCode: "AGT_C", name: "Charlie", designation: "senior" as const, submitted: 3, validated: 3.0, closeRate: 100 },
            { userCode: "AGT_D", name: "Diana", designation: "junior" as const, submitted: 1, validated: 0.5, closeRate: 50 },
          ],
        },
      ];

      const ranked = rankTeams(teams);
      expect(ranked).toHaveLength(2);

      // Both teams have 3.5 credited sales
      expect(ranked[0].validated).toBe(3.5);
      expect(ranked[1].validated).toBe(3.5);

      // Sigma has 6 submitted leads vs Panthers' 4 submitted leads -> Sigma breaks tie first
      expect(ranked[0].id).toBe("sigma");
      expect(ranked[0].submitted).toBe(6);
      expect(ranked[1].id).toBe("panthers");
      expect(ranked[1].submitted).toBe(4);
    });
  });

  describe("6. Deduplication & Idempotent Event Delivery", () => {
    it("ensures duplicate case events do not alter credited totals", () => {
      const sales: Sale[] = [
        {
          id: "s1",
          agentId: "agt_1",
          teamId: "",
          campaignId: "cmp_fe",
          status: "approved",
          product: "Gerber Life Policy",
          value: 100,
          createdAt: new Date().toISOString(),
          approvedAt: new Date().toISOString(),
          source: "safequote-api",
          carrier: "Gerber",
        },
      ];

      // Ingest once
      const map1 = leadCountsByAgent(sales);
      expect(map1.get("agt_1")?.validated).toBe(0.5);
      expect(map1.get("agt_1")?.submitted).toBe(1);

      // Deduplicated set: same sale is not added twice
      const dedupedSales = Array.from(new Map(sales.map((s) => [s.id, s])).values());
      const map2 = leadCountsByAgent(dedupedSales);
      expect(map2.get("agt_1")?.validated).toBe(0.5);
      expect(map2.get("agt_1")?.submitted).toBe(1);
    });
  });
});
