import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, requestUserAgent } from "@/backend/auth/guard";
import { errorResponse } from "@/backend/spins/http";
import { RecognitionError, celebrateWeeklyTop, weeklyTopPerformer } from "@/backend/recognition/weekly-top";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

/** This business week's #1 (the Weekly leaderboard's first row) and whether it was already celebrated. Admins only. */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ ok: true, ...(await weeklyTopPerformer(auth.pool)) }, { headers: noStore });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Celebrates this week's top performer on every Live Arena display (once per business week). Admins only, CSRF-checked.
 * No body: the agent and figures are read on the server, never taken from the browser. Creates no reward of any kind.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  try {
    const r = await celebrateWeeklyTop(auth.pool, { adminId: auth.ctx.admin.id, ip: requestIp(req), userAgent: requestUserAgent(req) });
    return NextResponse.json({ ok: true, ...r }, { headers: noStore });
  } catch (err) {
    if (err instanceof RecognitionError) return jsonError(err.status, err.message);
    return errorResponse(err);
  }
}
