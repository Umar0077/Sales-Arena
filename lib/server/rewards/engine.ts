import type { PoolClient } from "pg";
import { periodWindow, type BusinessCalendar, type RulePeriod } from "../spins/rules";

/**
 * Daily / weekly / monthly bonus programs (server side).
 *
 * Runs inside the transaction that recorded a NEW, reward-eligible validated sale.
 * Programs come only from the reward_programs table — there are no built-in
 * defaults, so no money amounts appear unless an admin configured them.
 *
 * Counting for a program in a period uses only reward-eligible, still-validated sales
 * from the later of: the period start (business timezone), the reward activation
 * cutoff, and the program's own active_since. Award ids are deterministic
 * (program:userCode:periodKey:n), so a duplicate delivery can never award twice.
 */

export interface BonusAwardRecord {
  id: string;
  programId: string;
  programName: string;
  kind: "daily" | "weekly" | "monthly";
  amount: number;
  prizeLabel: string;
  periodKey: string;
  n: number;
  validatedCount: number;
}

const KIND_TO_PERIOD: Record<string, RulePeriod> = { daily: "daily", weekly: "weekly", monthly: "monthly" };

function ymdInZone(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export async function evaluateBonusAwards(
  client: PoolClient,
  args: { userCode: string; agentId: string; closerName: string; saleId: string; validatedAt: Date; cutoff: Date; calendar: BusinessCalendar },
): Promise<BonusAwardRecord[]> {
  const programs = (await client.query(`SELECT * FROM reward_programs WHERE enabled ORDER BY id`)).rows;
  const out: BonusAwardRecord[] = [];
  const saleDay = ymdInZone(args.validatedAt, args.calendar.timezone);

  for (const p of programs) {
    const period = KIND_TO_PERIOD[p.kind];
    if (!period) continue;
    const start = p.start_date ? new Date(p.start_date).toISOString().slice(0, 10) : null;
    const end = p.end_date ? new Date(p.end_date).toISOString().slice(0, 10) : null;
    if ((start && saleDay < start) || (end && saleDay > end)) continue;

    const win = periodWindow(period, args.validatedAt, args.calendar);
    const from = new Date(
      Math.max(win.start?.getTime() ?? 0, args.cutoff.getTime(), p.active_since ? new Date(p.active_since).getTime() : 0),
    );
    const cnt = await client.query(
      `SELECT COUNT(*)::int AS n FROM validated_sales
        WHERE user_code = $1 AND reward_eligible AND status = 'validated' AND validated_at >= $2 AND validated_at < $3`,
      [args.userCode, from, win.end],
    );
    const validated = cnt.rows[0].n as number;
    const required = Math.max(1, Number(p.sales_required));
    const earned = Math.min(Number(p.max_awards), Math.floor(validated / required));
    const have = (
      await client.query(
        `SELECT COALESCE(MAX(n), 0)::int AS n FROM bonus_awards WHERE program_id = $1 AND user_code = $2 AND period_key = $3`,
        [p.id, args.userCode, win.key],
      )
    ).rows[0].n as number;

    for (let n = have + 1; n <= earned; n++) {
      const id = `${p.id}:${args.userCode}:${win.key}:${n}`;
      const ins = await client.query(
        `INSERT INTO bonus_awards (id, program_id, kind, agent_id, user_code, agent_name, period_key, n, validated_at_award, amount,
                                   prize_label, program_name, sales_required, status, trigger_sale_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'earned', $14)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [id, p.id, p.kind, args.agentId, args.userCode, args.closerName, win.key, n, validated, p.amount, p.prize_label, p.name, required, args.saleId],
      );
      if (ins.rowCount)
        out.push({ id, programId: p.id, programName: p.name, kind: p.kind, amount: Number(p.amount), prizeLabel: p.prize_label, periodKey: win.key, n, validatedCount: validated });
    }
  }
  return out;
}
