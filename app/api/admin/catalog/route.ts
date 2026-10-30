import { randomUUID } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, requestUserAgent, writeAudit } from "@/lib/server/auth/guard";
import { errorResponse, readJson } from "@/lib/server/spins/http";
import { parsePrize } from "@/lib/server/spins/prizes";
import { publishCatalogUpdated } from "@/lib/server/rewards/catalog";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  try {
    const { rows } = await auth.pool.query(
      `SELECT c.*, (SELECT COUNT(*)::int FROM spin_results r WHERE r.reward_id = c.id) AS times_won
         FROM rewards_catalog c ORDER BY c.display_order, c.title`,
    );
    return NextResponse.json({ ok: true, prizes: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "Could not load prizes from the database.");
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const body = await readJson(req);
  if (!body) return jsonError(400, "Invalid request.");
  const [p, problem] = parsePrize(body);
  if (!p) return jsonError(400, problem);
  const client = await auth.pool.connect();
  try {
    await client.query("BEGIN");
    const active = await client.query(`SELECT COUNT(*)::int AS n FROM rewards_catalog WHERE active`);
    if (p.active && active.rows[0].n >= 12) {
      await client.query("ROLLBACK");
      return jsonError(400, "The wheel supports at most 12 active prizes.");
    }
    const id = `rw_${randomUUID().slice(0, 12)}`;
    await client.query(
      `INSERT INTO rewards_catalog (id, title, description, icon, color, active, quantity, initial_quantity, weight, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9)`,
      [id, p.title, p.description, p.icon, p.color, p.active, p.quantity, p.weight, p.displayOrder],
    );
    await writeAudit(client, { adminId: auth.ctx.admin.id, action: "prize.created", targetType: "reward", targetId: id, details: { ...p }, ip: requestIp(req), userAgent: requestUserAgent(req) });
    await client.query("COMMIT");
    // Committed: now tell every Live Arena display (never before the save is confirmed).
    const revision = await publishCatalogUpdated(auth.pool);
    return NextResponse.json({ ok: true, id, revision });
  } catch (err) {
    await client.query("ROLLBACK");
    return errorResponse(err);
  } finally {
    client.release();
  }
}
