import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, requestUserAgent } from "@/backend/auth/guard";
import { errorResponse, readJson } from "@/backend/spins/http";
import { approveMissingSpinsForAgent, findMissingSpins } from "@/backend/spins/reconcile";
import { arenaBroadcaster } from "@/backend/events/broadcaster";

export const dynamic = "force-dynamic";

/**
 * Authoritative Spin Reconcile & Find Missing Spins API.
 *
 * GET  → Read-only audit from validated_sales (LEFT JOIN agents + spin_credits).
 *        Query params: ?from=YYYY-MM-DD&to=YYYY-MM-DD&q=...
 * POST { dryRun: true } → Same read-only audit.
 * POST { dryRun: false, agentIds: string[], periodKey?: string }
 *      → Idempotently approves and grants missing automatic spin credits per agent,
 *        recording audit logs and broadcasting spin.unlocked to all connected TVs.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  try {
    const sp = req.nextUrl.searchParams;
    const fromDate = sp.get("from") ?? undefined;
    const toDate = sp.get("to") ?? undefined;
    const q = sp.get("q") ?? undefined;
    const data = await findMissingSpins(auth.pool, { fromDate, toDate, q });
    const report = data.rows.map((r) => ({
      ...r,
      actualCredits: r.grantedAutoSpins,
      expectedCredits: r.expectedAutoSpins,
      missingCredits: r.missingSpins,
      rule: r.ruleId,
    }));
    return NextResponse.json(
      {
        ok: true,
        campaignStartAt: data.campaignStartAt,
        timezone: data.timezone,
        autoEnabled: data.autoEnabled,
        report,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err, "Could not build reconciliation report.");
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;

  const body = await readJson<{
    dryRun?: unknown;
    agentIds?: unknown;
    periodKey?: unknown;
    fromDate?: unknown;
    toDate?: unknown;
  }>(req);
  if (!body) return jsonError(400, "Invalid request body.");
  const dryRun = body.dryRun !== false;

  try {
    if (dryRun) {
      const data = await findMissingSpins(auth.pool, {
        fromDate: typeof body.fromDate === "string" ? body.fromDate : undefined,
        toDate: typeof body.toDate === "string" ? body.toDate : undefined,
      });
      return NextResponse.json({
        ok: true,
        dryRun: true,
        campaignStartAt: data.campaignStartAt,
        timezone: data.timezone,
        autoEnabled: data.autoEnabled,
        report: data.rows.map((r) => ({
          ...r,
          actualCredits: r.grantedAutoSpins,
          expectedCredits: r.expectedAutoSpins,
          missingCredits: r.missingSpins,
          rule: r.ruleId,
        })),
      });
    }

    const agentIds = Array.isArray(body.agentIds) ? (body.agentIds as unknown[]).map(String).filter(Boolean) : null;
    if (!agentIds || agentIds.length === 0) {
      return jsonError(400, "agentIds (array of userCodes) is required for approval.");
    }
    const periodKey = typeof body.periodKey === "string" && body.periodKey.trim() ? body.periodKey.trim() : undefined;
    const ip = requestIp(req);
    const userAgent = requestUserAgent(req);

    const granted: Array<{ userCode: string; name: string; grantsAdded: number; balanceAfter: number }> = [];
    for (const userCode of agentIds) {
      const res = await approveMissingSpinsForAgent(auth.pool, {
        userCode,
        periodKey,
        adminId: auth.ctx.admin.id,
        ip,
        userAgent,
      });
      if (res.grants.length > 0) {
        const last = res.grants[res.grants.length - 1];
        arenaBroadcaster.broadcast("spin.unlocked", {
          eventId: `tx:${last.transactionId}`,
          origin: "automatic",
          userCode: res.userCode,
          closerName: res.closerName,
          quantity: res.grants.reduce((n, g) => n + g.quantity, 0),
          salesCounted: last.salesCounted,
          spinsAvailable: res.balanceAfter,
        });
      }
      granted.push({
        userCode: res.userCode,
        name: res.closerName,
        grantsAdded: res.grants.length,
        balanceAfter: res.balanceAfter,
      });
    }

    return NextResponse.json({ ok: true, dryRun: false, granted });
  } catch (err) {
    return errorResponse(err, "Reconciliation failed.");
  }
}
