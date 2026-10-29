import crypto from "crypto";
import { dbQuery, withTransaction } from "../db/client";
import { arenaBroadcaster } from "../events/broadcaster";
import { periodInfo } from "@/lib/time/business";
import { DEFAULT_PROGRAMS, type BonusKind, type BonusProgram } from "@/store/rewards-store";

export interface ValidatedSaleRecordInput {
  caseId: string;
  userCode: string;
  closerName?: string;
  state?: string;
  carrier?: string;
  coverage?: string | number;
  premium: number;
  validatedAt: string;
  rawPayload?: Record<string, unknown>;
  skipRewardEvaluation?: boolean;
}

export interface RewardEvaluationResult {
  saleId: string;
  isNewSale: boolean;
  bonusesAwarded: Array<{
    programId: string;
    programName: string;
    kind: BonusKind;
    amount: number;
    prizeLabel: string;
  }>;
  spinsUnlocked: number;
  totalAvailableSpins: number;
}

export class RewardEngine {
  private timezone: string;

  constructor(timezone?: string) {
    this.timezone = timezone || process.env.SALES_ARENA_TIMEZONE || "America/New_York";
  }

  /**
   * Process a validated sale idempotently and evaluate bonus and spin rewards.
   */
  public async processValidatedSale(input: ValidatedSaleRecordInput): Promise<RewardEvaluationResult> {
    const saleId = `sale_${input.caseId}`;
    const userCode = input.userCode.trim().toUpperCase();
    const closerName = input.closerName || "Unknown Closer";

    return await withTransaction(async (client) => {
      // 1. Ensure closer agent exists in agents table
      const agentId = `agt_${userCode.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
      const initials = closerName.split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "CL";

      await client.query(
        `INSERT INTO agents (id, user_code, name, initials, active, updated_at)
         VALUES ($1, $2, $3, $4, true, NOW())
         ON CONFLICT (user_code) DO UPDATE
         SET name = EXCLUDED.name, updated_at = NOW()`,
        [agentId, userCode, closerName, initials]
      );

      // 2. Check if sale exists and whether rewards were already processed
      const existingSaleRes = await client.query(
        `SELECT id, reward_processed FROM validated_sales WHERE case_id = $1`,
        [input.caseId]
      );

      let isNewSale = false;
      if (existingSaleRes.rowCount === 0) {
        isNewSale = true;
        await client.query(
          `INSERT INTO validated_sales (
             id, case_id, user_code, agent_id, state, carrier, coverage, premium, validated_at, raw_payload, reward_processed, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, NOW())`,
          [
            saleId,
            input.caseId,
            userCode,
            agentId,
            input.state || null,
            input.carrier || null,
            input.coverage ? String(input.coverage) : null,
            input.premium,
            input.validatedAt,
            JSON.stringify(input.rawPayload || {}),
          ]
        );
      } else if (existingSaleRes.rows[0].reward_processed) {
        // Already processed rewards for this sale
        const currentCredits = await client.query(
          `SELECT available FROM spin_credits WHERE user_code = $1`,
          [userCode]
        );
        return {
          saleId,
          isNewSale: false,
          bonusesAwarded: [],
          spinsUnlocked: 0,
          totalAvailableSpins: currentCredits.rows[0]?.available ?? 0,
        };
      }

      const bonusesAwarded: RewardEvaluationResult["bonusesAwarded"] = [];
      let spinsUnlocked = 0;

      // If skipping reward evaluation (e.g. historical backfill / initial sync), mark sale processed and return
      if (input.skipRewardEvaluation) {
        await client.query(
          `UPDATE validated_sales SET reward_processed = true WHERE id = $1`,
          [saleId]
        );
        const currentCredits = await client.query(
          `SELECT available FROM spin_credits WHERE user_code = $1`,
          [userCode]
        );
        return {
          saleId,
          isNewSale,
          bonusesAwarded: [],
          spinsUnlocked: 0,
          totalAvailableSpins: currentCredits.rows[0]?.available ?? 0,
        };
      }

      // 3. Count validated sales for this closer across time periods
      const saleDate = new Date(input.validatedAt);
      const clock = { timezone: this.timezone, weekStartDay: 1 };

      // 4. Fetch active bonus programs from database (or fallback to defaults)
      const progRes = await client.query(
        `SELECT * FROM reward_programs WHERE enabled = true`
      );
      const programs: BonusProgram[] = progRes.rowCount && progRes.rowCount > 0
        ? progRes.rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            name: r.name,
            enabled: r.enabled,
            salesRequired: r.sales_required,
            amount: Number(r.amount),
            prizeLabel: r.prize_label,
            maxAwards: r.max_awards,
            startDate: r.start_date,
            endDate: r.end_date,
            headline: r.headline,
            message: r.message,
            rewardLine: r.reward_line,
            sound: r.sound,
            accent: r.accent,
            popupSeconds: r.popup_seconds,
            leaderboardCount: r.leaderboard_count,
            activeSince: r.active_since,
          }))
        : DEFAULT_PROGRAMS.filter((p) => p.enabled);

      // 5. Evaluate bonus programs
      for (const prog of programs) {
        const pInfo = periodInfo(prog.kind, clock, saleDate);
        const periodKey = pInfo.key;

        // Check how many awards agent already earned for this program in this period
        const awardsRes = await client.query(
          `SELECT COUNT(*) as count FROM bonus_awards WHERE program_id = $1 AND user_code = $2 AND period_key = $3`,
          [prog.id, userCode, periodKey]
        );
        const existingAwardCount = parseInt(awardsRes.rows[0]?.count || "0", 10);

        if (existingAwardCount < prog.maxAwards) {
          const awardN = existingAwardCount + 1;
          const targetRequired = prog.salesRequired * awardN;

          // Count validated sales strictly within this period's date window
          const periodCountRes = await client.query(
            `SELECT COUNT(*) as count FROM validated_sales 
             WHERE user_code = $1 AND validated_at >= $2::timestamptz AND validated_at <= $3::timestamptz`,
            [userCode, `${pInfo.startDay}T00:00:00Z`, saleDate.toISOString()]
          );
          const periodSalesCount = parseInt(periodCountRes.rows[0]?.count || "0", 10);

          // CRITICAL: Only award if agent has actually reached the required sales threshold!
          if (periodSalesCount >= targetRequired) {
            const awardId = `${prog.id}:${userCode}:${periodKey}:${awardN}`;

            await client.query(
              `INSERT INTO bonus_awards (
                 id, program_id, kind, agent_id, user_code, agent_name, period_key, n, validated_at_award, amount, prize_label, program_name, sales_required, status, trigger_sale_id, created_at
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'earned', $14, NOW())
               ON CONFLICT (id) DO NOTHING`,
              [
                awardId,
                prog.id,
                prog.kind,
                agentId,
                userCode,
                closerName,
                periodKey,
                awardN,
                periodSalesCount,
                prog.amount,
                prog.prizeLabel,
                prog.name,
                prog.salesRequired,
                saleId,
              ]
            );

            bonusesAwarded.push({
              programId: prog.id,
              programName: prog.name,
              kind: prog.kind,
              amount: prog.amount,
              prizeLabel: prog.prizeLabel,
            });

            // Broadcast bonus celebration event
            arenaBroadcaster.broadcast("bonus.awarded", {
              awardId,
              program: prog,
              closer: { userCode, name: closerName },
              amount: prog.amount,
              prizeLabel: prog.prizeLabel,
            });
          }
        }
      }

      // 6. Evaluate Spin Credits (Target rule: e.g. 2 validated sales = 1 spin credit)
      const salesPerSpin = 2; // Configurable standard threshold
      // Lock spin_credits row for this user
      await client.query(
        `INSERT INTO spin_credits (id, user_code, agent_id, earned, bonus, used, available, period_sales, sales_per_spin, updated_at)
         VALUES ($1, $2, $3, 0, 0, 0, 0, 0, $4, NOW())
         ON CONFLICT (user_code) DO NOTHING`,
        [`credit_${userCode}`, userCode, agentId, salesPerSpin]
      );

      const creditRes = await client.query(
        `SELECT * FROM spin_credits WHERE user_code = $1 FOR UPDATE`,
        [userCode]
      );
      const creditRow = creditRes.rows[0];
      const newPeriodSales = (creditRow.period_sales || 0) + 1;
      let newEarned = creditRow.earned || 0;
      let newAvailable = creditRow.available || 0;

      if (newPeriodSales % salesPerSpin === 0) {
        newEarned += 1;
        newAvailable += 1;
        spinsUnlocked += 1;
      }

      await client.query(
        `UPDATE spin_credits 
         SET earned = $1, available = $2, period_sales = $3, updated_at = NOW()
         WHERE user_code = $4`,
        [newEarned, newAvailable, newPeriodSales, userCode]
      );

      // 7. Mark sale as reward processed
      await client.query(
        `UPDATE validated_sales SET reward_processed = true WHERE id = $1`,
        [saleId]
      );

      if (spinsUnlocked > 0) {
        arenaBroadcaster.broadcast("spin.unlocked", {
          userCode,
          closerName,
          spinsAvailable: newAvailable,
          periodSales: newPeriodSales,
        });
      }

      arenaBroadcaster.broadcast("sale.validated", {
        caseId: input.caseId,
        userCode,
        closerName,
        premium: input.premium,
        validatedAt: input.validatedAt,
      });

      return {
        saleId,
        isNewSale,
        bonusesAwarded,
        spinsUnlocked,
        totalAvailableSpins: newAvailable,
      };
    }) ?? {
      saleId,
      isNewSale: false,
      bonusesAwarded: [],
      spinsUnlocked: 0,
      totalAvailableSpins: 0,
    };
  }

  /**
   * Server-controlled Spin Execution with pessimistic row-locking to prevent double-spins.
   */
  public async executeServerSpin(userCodeInput: string): Promise<
    | {
        ok: true;
        spinId: string;
        reward: {
          id: string;
          title: string;
          description: string;
          icon: string;
          color: string;
        };
        segmentIndex: number;
        availableLeft: number;
      }
    | { ok: false; reason: string }
  > {
    const userCode = userCodeInput.trim().toUpperCase();

    const result = await withTransaction(async (client) => {
      // 1. Lock credits row
      const creditRes = await client.query(
        `SELECT * FROM spin_credits WHERE user_code = $1 FOR UPDATE`,
        [userCode]
      );

      if (creditRes.rowCount === 0 || creditRes.rows[0].available <= 0) {
        return { ok: false as const, reason: "No available spin credits for this closer" };
      }

      const creditRow = creditRes.rows[0];

      // 2. Fetch active rewards catalog
      const rewardsRes = await client.query(
        `SELECT * FROM rewards_catalog 
         WHERE active = true AND (quantity IS NULL OR quantity > 0)
         ORDER BY display_order ASC`
      );

      let rewards = rewardsRes.rows;
      if (!rewards.length) {
        // If DB catalog is empty, use default rewards
        rewards = [
          { id: "rw_trophy", title: "Achievement Trophy", description: "Engraved crystal trophy", icon: "trophy", color: "#E0A526", weight: 1 },
          { id: "rw_voucher", title: "Gift Voucher", description: "Digital voucher", icon: "ticket", color: "#1FB58F", weight: 3 },
          { id: "rw_merch", title: "Merchandise Pack", description: "Swag pack", icon: "package", color: "#6A5CF0", weight: 3 },
          { id: "rw_headset", title: "Premium Headset", description: "Noise-cancelling headset", icon: "headphones", color: "#1B9FD1", weight: 1 },
          { id: "rw_surprise", title: "Surprise Gift", description: "Mystery prize", icon: "gift", color: "#C2418F", weight: 2 },
          { id: "rw_coffee", title: "Coffee Run", description: "Delivered coffee", icon: "coffee", color: "#D2742F", weight: 4 },
        ];
      }

      // 3. Secure weighted random selection
      const totalWeight = rewards.reduce((sum, r) => sum + (Number(r.weight) || 1), 0);
      const randomValue = (crypto.randomBytes(4).readUInt32BE(0) / 0xffffffff) * totalWeight;

      let accumulated = 0;
      let selectedIndex = 0;
      for (let i = 0; i < rewards.length; i++) {
        accumulated += Number(rewards[i].weight) || 1;
        if (randomValue <= accumulated) {
          selectedIndex = i;
          break;
        }
      }

      const wonReward = rewards[selectedIndex];

      // 4. Decrement inventory if limited
      if (wonReward.quantity !== undefined && wonReward.quantity !== null) {
        await client.query(
          `UPDATE rewards_catalog SET quantity = quantity - 1 WHERE id = $1`,
          [wonReward.id]
        );
      }

      // 5. Deduct spin credit
      const updatedAvailable = creditRow.available - 1;
      const updatedUsed = creditRow.used + 1;
      await client.query(
        `UPDATE spin_credits 
         SET available = $1, used = $2, updated_at = NOW() 
         WHERE user_code = $3`,
        [updatedAvailable, updatedUsed, userCode]
      );

      // 6. Record spin outcome in spin_results
      const spinId = `spin_${crypto.randomUUID()}`;
      await client.query(
        `INSERT INTO spin_results (
           id, user_code, agent_id, reward_id, reward_title, reward_color, reward_icon, status, mode, segment_index, created_at, completed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', 'server', $8, NOW(), NOW())`,
        [
          spinId,
          userCode,
          creditRow.agent_id,
          wonReward.id,
          wonReward.title,
          wonReward.color,
          wonReward.icon,
          selectedIndex,
        ]
      );

      arenaBroadcaster.broadcast("spin.completed", {
        spinId,
        userCode,
        reward: wonReward,
        availableLeft: updatedAvailable,
      });

      return {
        ok: true as const,
        spinId,
        reward: {
          id: wonReward.id,
          title: wonReward.title,
          description: wonReward.description,
          icon: wonReward.icon,
          color: wonReward.color,
        },
        segmentIndex: selectedIndex,
        availableLeft: updatedAvailable,
      };
    });

    if (!result) {
      return { ok: false, reason: "Database unavailable for transactional spin" };
    }

    return result;
  }
}

let rewardEngineInstance: RewardEngine | null = null;

export function getRewardEngine(): RewardEngine {
  if (!rewardEngineInstance) {
    rewardEngineInstance = new RewardEngine();
  }
  return rewardEngineInstance;
}
