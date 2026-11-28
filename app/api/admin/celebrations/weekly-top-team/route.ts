import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, requestUserAgent } from "@/backend/auth/guard";
import { errorResponse } from "@/backend/spins/http";
import { RecognitionError } from "@/backend/recognition/weekly-top";
import { celebrateWeeklyTopTeam, weeklyTopTeam } from "@/backend/recognition/weekly-top-team";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

/** This business week's #1 team (from weekly team standings) and whether it was already celebrated. Admins only. */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ ok: true, ...(await weeklyTopTeam(auth.pool, { fresh: true })) }, { headers: noStore });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Celebrates this week's top team once per business week on every Live Arena display. Admins only, CSRF-checked. */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  try {
    const r = await celebrateWeeklyTopTeam(auth.pool, {
      adminId: auth.ctx.admin.id,
      ip: requestIp(req),
      userAgent: requestUserAgent(req),
    });
    return NextResponse.json({ ok: true, ...r }, { headers: noStore });
  } catch (err) {
    if (err instanceof RecognitionError) return jsonError(err.status, err.message);
    return errorResponse(err);
  }
}
