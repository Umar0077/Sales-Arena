import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, requestUserAgent, writeAudit } from "@/lib/server/auth/guard";
import { errorResponse, readJson } from "@/lib/server/spins/http";
import { parsePrize } from "@/lib/server/spins/prizes";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = await readJson(req);
  if (!body) return jsonError(400, "Invalid request.");
  const [p, problem] = parsePrize(body);
  if (!p) return jsonError(400, problem);
  const client = await auth.pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(`SELECT * FROM rewards_catalog WHERE id = $1 FOR UPDATE`, [id]);
    if (!cur.rowCount) {
      await client.query("ROLLBACK");
      return jsonError(404, "Prize not found.");
    }
    if (p.active && !cur.rows[0].active) {
      const n = await client.query(`SELECT COUNT(*)::int AS n FROM rewards_catalog WHERE active`);
      if (n.rows[0].n >= 12) {
        await client.query("ROLLBACK");
        return jsonError(400, "The wheel supports at most 12 active prizes.");
      }
    }
    await client.query(
      `UPDATE rewards_catalog SET title = $2, description = $3, icon = $4, color = $5, active = $6, quantity = $7, weight = $8,
              display_order = $9, updated_at = NOW() WHERE id = $1`,
      [id, p.title, p.description, p.icon, p.color, p.active, p.quantity, p.weight, p.displayOrder],
    );
    const before = cur.rows[0];
    await writeAudit(client, {
      adminId: auth.ctx.admin.id,
      action: "prize.updated",
      targetType: "reward",
      targetId: id,
      details: { before: { title: before.title, active: before.active, quantity: before.quantity, weight: Number(before.weight) }, after: p },
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

/** Removes a prize that has never been won; prizes with history are deactivated instead, keeping spin records intact. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const client = await auth.pool.connect();
  try {
    await client.query("BEGIN");
    const used = await client.query(`SELECT 1 FROM spin_results WHERE reward_id = $1 LIMIT 1`, [id]);
    let outcome: "deleted" | "deactivated";
    if (used.rowCount) {
      await client.query(`UPDATE rewards_catalog SET active = FALSE, updated_at = NOW() WHERE id = $1`, [id]);
      outcome = "deactivated";
    } else {
      const del = await client.query(`DELETE FROM rewards_catalog WHERE id = $1`, [id]);
      if (!del.rowCount) {
        await client.query("ROLLBACK");
        return jsonError(404, "Prize not found.");
      }
      outcome = "deleted";
    }
    await writeAudit(client, { adminId: auth.ctx.admin.id, action: `prize.${outcome}`, targetType: "reward", targetId: id, ip: requestIp(req), userAgent: requestUserAgent(req) });
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, outcome });
  } catch (err) {
    await client.query("ROLLBACK");
    return errorResponse(err);
  } finally {
    client.release();
  }
}
