import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, requestUserAgent } from "@/lib/server/auth/guard";
import { errorResponse, readJson } from "@/lib/server/spins/http";
import { AwardError, setAwardStatus } from "@/lib/server/rewards/awards";

export const dynamic = "force-dynamic";

/** Body: { status, note? }: approve, mark paid, cancel or reverse (with an audit trail). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const body = await readJson<{ status?: unknown; note?: unknown }>(req);
  if (!body) return jsonError(400, "Invalid request.");
  try {
    const id = decodeURIComponent((await params).id);
    const award = await setAwardStatus(auth.pool, id, body, { adminId: auth.ctx.admin.id, ip: requestIp(req), userAgent: requestUserAgent(req) });
    return NextResponse.json({ ok: true, award });
  } catch (err) {
    if (err instanceof AwardError) return jsonError(err.status, err.message);
    return errorResponse(err);
  }
}
