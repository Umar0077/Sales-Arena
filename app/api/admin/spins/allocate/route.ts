import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, requestUserAgent } from "@/lib/server/auth/guard";
import { allocateManualSpins } from "@/lib/server/spins/ledger";
import { errorResponse, readJson } from "@/lib/server/spins/http";

export const dynamic = "force-dynamic";

/**
 * Manually grants spins. Body: { userCode, quantity, reason, idempotencyKey }.
 * The idempotency key is created when the admin opens the confirmation step, so a
 * double click or network retry returns the original result instead of granting twice.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const body = await readJson<{ userCode?: unknown; quantity?: unknown; reason?: unknown; idempotencyKey?: unknown }>(req);
  if (!body || typeof body.userCode !== "string" || typeof body.reason !== "string" || typeof body.idempotencyKey !== "string")
    return jsonError(400, "userCode, quantity, reason and idempotencyKey are required.");
  try {
    const res = await allocateManualSpins(auth.pool, {
      userCode: body.userCode.trim().toUpperCase(),
      quantity: Number(body.quantity),
      reason: body.reason,
      idempotencyKey: body.idempotencyKey,
      adminId: auth.ctx.admin.id,
      ip: requestIp(req),
      userAgent: requestUserAgent(req),
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    return errorResponse(err);
  }
}
