import { randomUUID } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, requestUserAgent, writeAudit } from "@/lib/server/auth/guard";
import { validateRuleInput } from "@/lib/server/spins/rules";
import { errorResponse, readJson } from "@/lib/server/spins/http";

export const dynamic = "force-dynamic";

/**
 * Creates a new rule version for a scope. The previous version stays in history and
 * stops applying at the new version's effective time. No back-dating.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return jsonError(400, "Invalid request.");
  const input = {
    scopeType: body.scopeType ?? "global",
    scopeId: body.scopeType === "global" ? null : body.scopeId,
    salesPerSpin: body.salesPerSpin,
    spinsPerThreshold: body.spinsPerThreshold ?? 1,
    period: body.period ?? "daily",
    enabled: body.enabled,
    effectiveFrom: body.effectiveFrom === "now" || !body.effectiveFrom ? new Date().toISOString() : body.effectiveFrom,
  };
  const problem = validateRuleInput(input, new Date());
  if (problem) return jsonError(400, problem);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
  const eff = new Date(String(input.effectiveFrom));

  const client = await auth.pool.connect();
  try {
    await client.query("BEGIN");
    if (input.scopeType === "team") {
      const t = await client.query(`SELECT 1 FROM teams WHERE id = $1`, [input.scopeId]);
      if (!t.rowCount) {
        await client.query("ROLLBACK");
        return jsonError(400, "That team does not exist.");
      }
    } else if (input.scopeType === "campaign") {
      const c = await client.query(`SELECT 1 FROM campaigns WHERE id = $1`, [input.scopeId]);
      if (!c.rowCount) {
        await client.query("ROLLBACK");
        return jsonError(400, "That campaign does not exist.");
      }
    }
    const cur = await client.query(
      `SELECT * FROM target_rules WHERE scope_type = $1 AND COALESCE(scope_id, '') = COALESCE($2, '') AND superseded_at IS NULL FOR UPDATE`,
      [input.scopeType, input.scopeId],
    );
    const prev = cur.rows[0];
    if (prev && eff.getTime() < new Date(prev.effective_from).getTime()) {
      await client.query("ROLLBACK");
      return jsonError(400, "The effective time must be after the current version's effective time.");
    }
    if (prev) await client.query(`UPDATE target_rules SET superseded_at = $2, updated_at = NOW() WHERE id = $1`, [prev.id, eff]);
    const id = `rule_${String(input.scopeType)}_${randomUUID().slice(0, 8)}`;
    await client.query(
      `INSERT INTO target_rules (id, team_id, sales_per_spin, period, enabled, scope_type, scope_id, spins_per_threshold, effective_from, created_by, change_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, input.scopeType === "team" ? input.scopeId : null, Number(input.salesPerSpin), input.period, input.enabled, input.scopeType,
        input.scopeId, Number(input.spinsPerThreshold), eff, auth.ctx.admin.id, note || null],
    );
    await writeAudit(client, {
      adminId: auth.ctx.admin.id,
      action: "spins.rule_version_created",
      targetType: "target_rule",
      targetId: id,
      details: {
        previous: prev ? { id: prev.id, salesPerSpin: prev.sales_per_spin, spinsPerThreshold: prev.spins_per_threshold, period: prev.period, enabled: prev.enabled } : null,
        next: { salesPerSpin: Number(input.salesPerSpin), spinsPerThreshold: Number(input.spinsPerThreshold), period: input.period, enabled: input.enabled, scopeType: input.scopeType, scopeId: input.scopeId, effectiveFrom: eff.toISOString() },
        note,
      },
      ip: requestIp(req),
      userAgent: requestUserAgent(req),
    });
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    await client.query("ROLLBACK");
    return errorResponse(err);
  } finally {
    client.release();
  }
}
