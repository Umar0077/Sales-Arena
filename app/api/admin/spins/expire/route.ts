import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, requestUserAgent } from "@/backend/auth/guard";
import { errorResponse, readJson } from "@/backend/spins/http";
import { executeFreshCampaignReset, executeHistoricalExpiration, previewHistoricalExpiration } from "@/backend/spins/expire";
import { arenaBroadcaster } from "@/backend/events/broadcaster";

export const dynamic = "force-dynamic";

/**
 * Controlled historical spin-credit expiration:
 * GET  → Read-only dry-run audit showing unused pre-campaign credits vs. protected Nov 27+ credits.
 * POST { dryRun: false, userCodes: string[], reason?: string }
 *      → Applies idempotent 'expire' ledger transactions for approved agents only.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  try {
    const preview = await previewHistoricalExpiration(auth.pool);
    return NextResponse.json({ ok: true, ...preview }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "Could not preview historical spin credit expiration.");
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;

  const body = await readJson<{
    dryRun?: unknown;
    mode?: unknown;
    resetMarker?: unknown;
    userCodes?: unknown;
    reason?: unknown;
  }>(req);
  if (!body) return jsonError(400, "Invalid request body.");
  const dryRun = body.dryRun !== false;

  try {
    if (dryRun) {
      const preview = await previewHistoricalExpiration(auth.pool);
      return NextResponse.json({ ok: true, dryRun: true, ...preview });
    }
    if (body.mode === "fresh_campaign_reset") {
      const resetMarker = typeof body.resetMarker === "string" ? body.resetMarker : "nov27_fresh_reset_v1";
      const res = await executeFreshCampaignReset(auth.pool, {
        resetMarker,
        adminId: auth.ctx.admin.id,
        reason: typeof body.reason === "string" ? body.reason : undefined,
        ip: requestIp(req),
        userAgent: requestUserAgent(req),
      });
      for (const item of res.expired) {
        arenaBroadcaster.broadcast("spin.completed", {
          userCode: item.userCode,
          availableLeft: item.balanceAfter,
        });
      }
      return NextResponse.json({ ok: true, dryRun: false, mode: "fresh_campaign_reset", ...res });
    }
    const userCodes = Array.isArray(body.userCodes) ? (body.userCodes as unknown[]).map(String).filter(Boolean) : [];
    if (userCodes.length === 0) return jsonError(400, "userCodes array is required.");
    const res = await executeHistoricalExpiration(auth.pool, {
      userCodes,
      adminId: auth.ctx.admin.id,
      reason: typeof body.reason === "string" ? body.reason : undefined,
      ip: requestIp(req),
      userAgent: requestUserAgent(req),
    });
    for (const item of res.expired) {
      if (!item.replayed) {
        arenaBroadcaster.broadcast("spin.completed", {
          userCode: item.userCode,
          availableLeft: item.balanceAfter,
        });
      }
    }
    return NextResponse.json({ ok: true, dryRun: false, ...res });
  } catch (err) {
    return errorResponse(err, "Could not expire historical spin credits.");
  }
}
