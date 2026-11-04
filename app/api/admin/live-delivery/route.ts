import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/server/auth/guard";
import { errorResponse } from "@/lib/server/spins/http";
import { deliveryTimeline } from "@/lib/server/sales/delivery";
import { safeQuoteSseConsumer } from "@/lib/server/safequote/sse-consumer";
import { arenaBroadcaster } from "@/lib/server/events/broadcaster";
import { stageStats, traceRows } from "@/lib/server/sales/delivery-trace";
import { discoverySeconds } from "@/lib/server/sales/scheduler";

export const dynamic = "force-dynamic";

/** Read-only live delivery diagnostics for admins: where time is spent between Safe Quote and the screens. */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  try {
    const t = await deliveryTimeline(auth.pool, { limit: Number(req.nextUrl.searchParams.get("limit")) || 30 });
    // End-to-end trace since this server started (in memory): stored → broadcast → display receipt → popup.
    const trace = traceRows(50);
    return NextResponse.json(
      {
        ok: true,
        ...t,
        upstream: safeQuoteSseConsumer.getHealth(),
        reconcileMinutes: Math.max(1, Number(process.env.SALES_ARENA_RECONCILE_MINUTES) || 5),
        discoverySeconds: discoverySeconds(),
        trace,
        traceStats: stageStats(trace),
        connectedDisplays: arenaBroadcaster.getSubscriberCount(),
        serverNow: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err, "Delivery diagnostics are unavailable.");
  }
}
