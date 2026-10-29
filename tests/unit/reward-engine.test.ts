import { describe, expect, it, vi, beforeEach } from "vitest";
import { RewardEngine } from "@/lib/server/rewards/engine";
import * as dbModule from "@/lib/server/db/client";
import type { PoolClient } from "pg";

describe("RewardEngine", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("evaluates a validated sale, detects new sale, and credits bonus awards when threshold met", async () => {
    const mockQuery = vi.fn();

    // 1. Ensure closer exists
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    // 2. Check existing sale
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    // 3. Insert validated_sale
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    // 4. Fetch reward_programs
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: "prog_daily",
          kind: "daily",
          name: "Daily Bonus",
          enabled: true,
          sales_required: 1,
          amount: "1000",
          prize_label: "",
          max_awards: 5,
          start_date: null,
          end_date: null,
          headline: "CONGRATS!",
          message: "VALIDATED!",
          reward_line: "YOU EARNED 1000",
          sound: "target",
          accent: "#FFC857",
          popup_seconds: 6,
          leaderboard_count: 10,
          active_since: null,
        },
      ],
    });
    // 5. Check existing award count
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ count: "0" }] });
    // 6. Check period validated sales count (1 sale, meets threshold of 1)
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ count: "1" }] });
    // 7. Insert bonus_awards
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    // 8. Insert spin_credits on conflict
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    // 9. Select spin_credits FOR UPDATE
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ earned: 0, available: 0, period_sales: 1, used: 0 }],
    });
    // 10. Update spin_credits (newPeriodSales = 2, so salesPerSpin 2 matches -> unlocks 1 spin!)
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    // 11. Update validated_sales reward_processed
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    vi.spyOn(dbModule, "withTransaction").mockImplementation(async (callback) => {
      const mockClient = { query: mockQuery } as unknown as PoolClient;
      return await callback(mockClient);
    });

    const engine = new RewardEngine("America/New_York");
    const result = await engine.processValidatedSale({
      caseId: "CASE-5544",
      userCode: "CLS-ALI",
      closerName: "Ali Khan",
      state: "NC",
      carrier: "BrightCare",
      coverage: 25000,
      premium: 120,
      validatedAt: "2026-10-29T15:00:00Z",
    });

    expect(result.saleId).toBe("sale_CASE-5544");
    expect(result.isNewSale).toBe(true);
    expect(result.bonusesAwarded).toHaveLength(1);
    expect(result.bonusesAwarded[0].amount).toBe(1000);
    expect(result.spinsUnlocked).toBe(1);
  });

  it("does NOT award monthly bonuses when sales count has not reached the threshold (e.g. 40 required, only 16 achieved)", async () => {
    const mockQuery = vi.fn();

    // 1. Ensure closer exists
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    // 2. Check existing sale
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    // 3. Insert validated_sale
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    // 4. Fetch reward_programs (monthly champion: 40 required)
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: "prog_monthly",
          kind: "monthly",
          name: "Monthly Champion",
          enabled: true,
          sales_required: 40,
          amount: "15000",
          prize_label: "",
          max_awards: 1,
        },
      ],
    });
    // 5. Existing awards: 0
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ count: "0" }] });
    // 6. Period sales count: only 16 validated sales this month
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ count: "16" }] });
    // (Bonus award insert is SKIPPED because 16 < 40)
    // 7. Insert spin_credits on conflict
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    // 8. Select spin_credits FOR UPDATE
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ earned: 0, available: 0, period_sales: 0, used: 0 }],
    });
    // 9. Update spin_credits
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    // 10. Update validated_sales reward_processed
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    vi.spyOn(dbModule, "withTransaction").mockImplementation(async (callback) => {
      const mockClient = { query: mockQuery } as unknown as PoolClient;
      return await callback(mockClient);
    });

    const engine = new RewardEngine("America/New_York");
    const result = await engine.processValidatedSale({
      caseId: "CASE-MONTHLY-TEST",
      userCode: "CLS-HAMNA",
      closerName: "Hamna Nasir",
      premium: 200,
      validatedAt: "2026-10-29T16:00:00Z",
    });

    expect(result.isNewSale).toBe(true);
    expect(result.bonusesAwarded).toHaveLength(0); // 0 bonuses awarded!
  });

  it("skips reward evaluation entirely during historical synchronization (skipRewardEvaluation: true)", async () => {
    const mockQuery = vi.fn();

    // 1. Ensure closer exists
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    // 2. Check existing sale
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    // 3. Insert validated_sale
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    // 4. Mark sale processed
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    // 5. Select spin credits available
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ available: 0 }] });

    vi.spyOn(dbModule, "withTransaction").mockImplementation(async (callback) => {
      const mockClient = { query: mockQuery } as unknown as PoolClient;
      return await callback(mockClient);
    });

    const engine = new RewardEngine("America/New_York");
    const result = await engine.processValidatedSale({
      caseId: "CASE-HISTORICAL",
      userCode: "CLS-HIST",
      closerName: "Historical Agent",
      premium: 300,
      validatedAt: "2026-10-10T12:00:00Z",
      skipRewardEvaluation: true,
    });

    expect(result.isNewSale).toBe(true);
    expect(result.bonusesAwarded).toHaveLength(0);
    expect(result.spinsUnlocked).toBe(0);
  });
});
