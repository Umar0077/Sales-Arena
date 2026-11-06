import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, requestUserAgent } from "@/backend/auth/guard";
import { errorResponse, readJson } from "@/backend/spins/http";
import { ConfigError, readArenaConfig, readScreenSwitch, saveArenaConfig } from "@/backend/settings/arena-config";

export const dynamic = "force-dynamic";

/** Global FE Sales Arena configuration (PostgreSQL). Applies to every display and admin. */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  try {
    const [config, screen] = await Promise.all([readArenaConfig(auth.pool), readScreenSwitch(auth.pool)]);
    return NextResponse.json({ ok: true, ...config, screen }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "Settings are unavailable: the database could not be reached.");
  }
}

/** Body: { values: { <setting>: <value>, ... } } with only the settings being changed. */
export async function PUT(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const body = await readJson<{ values?: unknown }>(req);
  if (!body) return jsonError(400, "Invalid request.");
  try {
    const saved = await saveArenaConfig(auth.pool, body.values, { adminId: auth.ctx.admin.id, ip: requestIp(req), userAgent: requestUserAgent(req) });
    return NextResponse.json({ ok: true, ...saved });
  } catch (err) {
    if (err instanceof ConfigError) return jsonError(400, err.message);
    return errorResponse(err);
  }
}
