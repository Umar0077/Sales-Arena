import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/backend/auth/guard";
import { errorResponse } from "@/backend/spins/http";
import { listAwards } from "@/backend/rewards/awards";

export const dynamic = "force-dynamic";

/** Award history from PostgreSQL. Filters: kind, status, programId, userCode, limit. */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const sp = req.nextUrl.searchParams;
  try {
    const r = await listAwards(auth.pool, {
      kind: sp.get("kind"),
      status: sp.get("status"),
      audience: sp.get("audience"),
      programId: sp.get("programId"),
      userCode: sp.get("userCode"),
      limit: Number(sp.get("limit")) || 200,
    });
    return NextResponse.json({ ok: true, ...r }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "Award history is unavailable: the database could not be reached.");
  }
}
