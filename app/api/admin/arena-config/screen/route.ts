import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, requestUserAgent } from "@/backend/auth/guard";
import { errorResponse, readJson } from "@/backend/spins/http";
import { ConfigError, switchArenaScreen } from "@/backend/settings/arena-config";

export const dynamic = "force-dynamic";

/** "Switch the Live Arena now". Body: { screen: "daily" | "weekly" | "monthly" | "teams" | "spin" }. */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const body = await readJson<{ screen?: unknown }>(req);
  if (!body) return jsonError(400, "Invalid request.");
  try {
    const screen = await switchArenaScreen(auth.pool, body.screen, { adminId: auth.ctx.admin.id, ip: requestIp(req), userAgent: requestUserAgent(req) });
    return NextResponse.json({ ok: true, screen });
  } catch (err) {
    if (err instanceof ConfigError) return jsonError(400, err.message);
    return errorResponse(err);
  }
}
