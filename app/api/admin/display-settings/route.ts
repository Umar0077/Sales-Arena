import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, requestUserAgent } from "@/lib/server/auth/guard";
import { errorResponse, readJson } from "@/lib/server/spins/http";
import { readGlobalDisplay, saveGlobalPerformanceMode, DisplaySettingsError } from "@/lib/server/settings/display";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ ok: true, ...(await readGlobalDisplay(auth.pool)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "Display settings are unavailable: the database could not be reached.");
  }
}

/** Body: { performanceMode: "auto" | "high" | "performance" }. Applies to every Live Arena display. */
export async function PUT(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const body = await readJson<{ performanceMode?: unknown }>(req);
  if (!body) return jsonError(400, "Invalid request.");
  try {
    const saved = await saveGlobalPerformanceMode(auth.pool, body.performanceMode, { adminId: auth.ctx.admin.id, ip: requestIp(req), userAgent: requestUserAgent(req) });
    return NextResponse.json({ ok: true, ...saved });
  } catch (err) {
    if (err instanceof DisplaySettingsError) return jsonError(400, err.message);
    return errorResponse(err);
  }
}
