import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, requestUserAgent } from "@/lib/server/auth/guard";
import { errorResponse, readJson } from "@/lib/server/spins/http";
import { readTargets, saveTarget, targetHistory, TargetError } from "@/lib/server/targets/store";

export const dynamic = "force-dynamic";

/** Targets for the requested periods (?day=&week=&month=) plus the recent change history. */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const p = req.nextUrl.searchParams;
  try {
    const [targets, history] = await Promise.all([
      readTargets(auth.pool, { day: p.get("day") ?? undefined, week: p.get("week") ?? undefined, month: p.get("month") ?? undefined }),
      targetHistory(auth.pool, Number(p.get("limit")) || 50),
    ]);
    return NextResponse.json({ ok: true, targets, history }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "Targets are unavailable: the database could not be reached.");
  }
}

/** Set or change one period's validated-sales target (0 clears it). */
export async function PUT(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const body = await readJson<{ periodType?: unknown; periodKey?: unknown; target?: unknown; note?: unknown }>(req);
  if (!body) return jsonError(400, "Invalid request.");
  try {
    const result = await saveTarget(auth.pool, { periodType: body.periodType, periodKey: body.periodKey, target: body.target, note: body.note }, {
      adminId: auth.ctx.admin.id,
      ip: requestIp(req),
      userAgent: requestUserAgent(req),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof TargetError) return jsonError(err.status, err.message);
    return errorResponse(err);
  }
}
