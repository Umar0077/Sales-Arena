import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, requestUserAgent, writeAudit } from "@/lib/server/auth/guard";
import { errorResponse, likePattern, readJson } from "@/lib/server/spins/http";

export const dynamic = "force-dynamic";

/** Search agents by name or userCode, with server-side spin balances and sale counts. */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 64);
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 50));
  try {
    const { rows } = await auth.pool.query(
      `SELECT a.user_code, a.name, a.spin_eligible, a.active,
              COALESCE(c.available, 0) AS available, COALESCE(c.auto_earned, 0) AS auto_earned,
              COALESCE(c.manual_earned, 0) AS manual_earned, COALESCE(c.consumed, 0) AS consumed, c.last_spin_at,
              (SELECT COUNT(*)::int FROM validated_sales s WHERE s.user_code = a.user_code AND s.status = 'validated') AS validated_sales,
              (SELECT COUNT(*)::int FROM validated_sales s WHERE s.user_code = a.user_code AND s.reward_eligible AND s.status = 'validated') AS eligible_sales
         FROM agents a LEFT JOIN spin_credits c ON c.user_code = a.user_code
        WHERE $1 = '' OR a.name ILIKE $2 OR a.user_code ILIKE $2
        ORDER BY a.name ASC
        LIMIT $3`,
      [q, likePattern(q), limit],
    );
    return NextResponse.json({ ok: true, agents: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "Could not load agents from the database.");
  }
}

/** Turn automatic spin eligibility on/off for one agent. */
export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const body = await readJson<{ userCode?: unknown; eligible?: unknown }>(req);
  if (!body || typeof body.userCode !== "string" || typeof body.eligible !== "boolean") return jsonError(400, "userCode and eligible are required.");
  const client = await auth.pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(`UPDATE agents SET spin_eligible = $2, updated_at = NOW() WHERE user_code = $1 RETURNING user_code`, [body.userCode, body.eligible]);
    if (!res.rowCount) {
      await client.query("ROLLBACK");
      return jsonError(404, "Agent not found.");
    }
    await writeAudit(client, {
      adminId: auth.ctx.admin.id,
      action: "spins.agent_eligibility",
      targetType: "agent",
      targetId: body.userCode,
      details: { eligible: body.eligible },
      ip: requestIp(req),
      userAgent: requestUserAgent(req),
    });
    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    return errorResponse(err);
  } finally {
    client.release();
  }
}
