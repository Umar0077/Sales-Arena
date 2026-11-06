import type { Pool } from "pg";
import { writeAudit } from "../auth/guard";
import { todayBusiness } from "../teams/repo";
import { COLS, ProgramError, publish, rowToProgram, snapshot, type RewardProgram } from "./programs";

/**
 * Senior / Junior eligibility review (Owner only).
 *
 * Programmes created before designations existed are "all agents". Moving them to "senior" changes who can
 * earn them FROM NOW ON: a sale is checked against the agent's designation on its business date when it is
 * evaluated. Earned, paid and superseded awards are never touched (no award row is read for writing).
 *
 * preview(): read-only impact: the programmes that would change, the agents who would stop qualifying
 * (Juniors, and agents with no designation yet), and the existing awards that stay exactly as they are.
 */

export async function previewAudience(pool: Pool) {
  const programs = (await pool.query(`SELECT ${COLS} FROM reward_programs WHERE archived_at IS NULL ORDER BY kind, sales_required, created_at`)).rows.map((r) => rowToProgram(r));
  const today = await todayBusiness(pool);
  const proposed = programs.filter((p) => p.audience === "all");
  const awards = (
    await pool.query(
      `SELECT program_id, COUNT(*)::int AS n, COALESCE(SUM(amount) FILTER (WHERE superseded_by IS NULL AND status NOT IN ('cancelled','reversed')), 0)::float AS effective
         FROM bonus_awards WHERE program_id = ANY($1) GROUP BY program_id`,
      [proposed.map((p) => p.id)],
    )
  ).rows;
  const awardOf = new Map(awards.map((a) => [a.program_id, { awards: a.n, effectiveAmount: Number(a.effective) }]));
  // Agents with recent sales, by their designation today.
  const agents = (
    await pool.query(
      `SELECT a.user_code, a.name, d.designation, COUNT(s.id)::int AS sales30
         FROM agents a
         LEFT JOIN agent_designations d ON d.user_code = a.user_code AND d.effective_from <= $1::date AND (d.effective_to IS NULL OR d.effective_to > $1::date)
         LEFT JOIN validated_sales s ON s.user_code = a.user_code AND s.status = 'validated' AND s.validated_at > NOW() - INTERVAL '30 days'
        GROUP BY a.user_code, a.name, d.designation
        ORDER BY a.name`,
      [today],
    )
  ).rows.map((r) => ({ userCode: r.user_code as string, name: r.name as string, designation: (r.designation as "senior" | "junior" | null) ?? null, recentSales: Number(r.sales30) }));
  return {
    readOnly: true,
    today,
    programs: programs.map((p) => ({
      id: p.id, name: p.name, kind: p.kind, salesRequired: p.salesRequired, amount: p.amount, currency: p.currency, enabled: p.enabled, rewardGroup: p.rewardGroup,
      audience: p.audience, proposedAudience: p.audience === "all" ? "senior" : p.audience, existingAwards: awardOf.get(p.id) ?? { awards: 0, effectiveAmount: 0 },
    })),
    impact: {
      seniors: agents.filter((a) => a.designation === "senior"),
      juniorsWhoStopQualifying: agents.filter((a) => a.designation === "junior"),
      undesignatedWhoStopQualifying: agents.filter((a) => a.designation === null),
    },
    rules: [
      "Applies to sales evaluated after the change; each sale is checked against the agent's designation on its business date.",
      "Existing earned, paid, superseded and recovered awards are not changed.",
      "Agents without a Senior / Junior designation no longer earn Senior-only programmes: designate them first if they should.",
      "Junior programmes are separate (their own reward groups) and none exist until the Owner creates and activates them.",
    ],
  };
}

export async function applyAudience(pool: Pool, input: { confirm?: unknown; programIds?: unknown; reason?: unknown }, actor: { adminId: string; ip: string | null; userAgent: string | null }) {
  if (input.confirm !== true) throw new ProgramError("Confirm the eligibility change first.");
  const ids = Array.isArray(input.programIds) ? [...new Set(input.programIds.filter((x): x is string => typeof x === "string"))] : [];
  if (!ids.length || ids.length > 200) throw new ProgramError("Choose the programmes to move to Senior.");
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 300) : "";
  if (reason.length < 5) throw new ProgramError("Give a short reason (at least 5 characters).");
  const client = await pool.connect();
  const changed: RewardProgram[] = [];
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($$reward_programs$$))`);
    for (const id of ids) {
      const row = (await client.query(`SELECT ${COLS} FROM reward_programs WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!row) throw new ProgramError(`Programme ${id} not found.`, 404);
      const cur = rowToProgram(row);
      if (cur.audience !== "all") throw new ProgramError(`"${cur.name}" is already ${cur.audience === "senior" ? "Senior" : "Junior"}-only.`, 409);
      await client.query(`UPDATE reward_programs SET audience = 'senior', revision = revision + 1, updated_by = $2, updated_at = NOW() WHERE id = $1`, [id, actor.adminId]);
      const p = await snapshot(client, id, "audience_senior", actor.adminId);
      await writeAudit(client, { adminId: actor.adminId, action: "reward_program.audience_changed", targetType: "reward_program", targetId: id, details: { from: "all", to: "senior", reason, revision: p.revision }, ip: actor.ip, userAgent: actor.userAgent });
      changed.push(p);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  for (const p of changed) publish(p, "audience_senior");
  return { changed: changed.map((p) => ({ id: p.id, name: p.name, audience: p.audience, revision: p.revision })) };
}
