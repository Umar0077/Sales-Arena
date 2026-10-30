import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, requestUserAgent, writeAudit } from "@/lib/server/auth/guard";
import { errorResponse, readJson } from "@/lib/server/spins/http";
import { publishCatalogUpdated } from "@/lib/server/rewards/catalog";

export const dynamic = "force-dynamic";

/** Sets the clockwise wheel order. Body: { ids: string[] } (every prize id, in the new order). Order never affects odds. */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const body = await readJson<{ ids?: unknown }>(req);
  const ids = Array.isArray(body?.ids) ? body!.ids : null;
  if (!ids || ids.length === 0 || ids.length > 200 || !ids.every((x) => typeof x === "string") || new Set(ids).size !== ids.length)
    return jsonError(400, "Send the full list of prize ids in the new order.");
  const client = await auth.pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`SELECT id FROM rewards_catalog FOR UPDATE`);
    const known = new Set(rows.map((r) => r.id as string));
    if (known.size !== ids.length || !(ids as string[]).every((id) => known.has(id))) {
      await client.query("ROLLBACK");
      return jsonError(409, "The prize list changed. Reload and try again.");
    }
    await client.query(
      `UPDATE rewards_catalog c SET display_order = o.ord, updated_at = NOW()
         FROM UNNEST($1::varchar[]) WITH ORDINALITY AS o(id, ord) WHERE c.id = o.id AND c.display_order <> o.ord`,
      [ids],
    );
    await writeAudit(client, { adminId: auth.ctx.admin.id, action: "prize.reordered", targetType: "reward", details: { order: ids }, ip: requestIp(req), userAgent: requestUserAgent(req) });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return errorResponse(err);
  } finally {
    client.release();
  }
  const revision = await publishCatalogUpdated(auth.pool);
  return NextResponse.json({ ok: true, revision });
}
