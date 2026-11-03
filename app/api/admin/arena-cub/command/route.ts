import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, requestUserAgent } from "@/lib/server/auth/guard";
import { errorResponse } from "@/lib/server/spins/http";
import { CubCommandError, sendCubCommand } from "@/lib/server/cub/commands";

export const dynamic = "force-dynamic";

/**
 * Plays an Arena Cub action on connected Live Arena screens. Signed-in admins only (CSRF-checked).
 * Body: { action: <allowlisted name>, target?: { scope: "all" } | { scope: "screen", screen } | { scope: "devices", devices: [id] } }.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const len = Number(req.headers.get("content-length") || 0);
  if (len > 2048) return jsonError(413, "Request too large.");
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 2048) return jsonError(413, "Request too large.");
    body = JSON.parse(text);
  } catch {
    return jsonError(400, "Invalid request.");
  }
  try {
    const command = await sendCubCommand(auth.pool, body, { adminId: auth.ctx.admin.id, ip: requestIp(req), userAgent: requestUserAgent(req) });
    return NextResponse.json({ ok: true, command }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof CubCommandError) {
      const res = jsonError(err.status, err.message);
      if (err.retryAfterSec) res.headers.set("Retry-After", String(err.retryAfterSec));
      return res;
    }
    return errorResponse(err);
  }
}
