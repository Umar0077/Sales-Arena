import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, writeAudit } from "@/lib/server/auth/guard";
import { backfillSales } from "@/lib/server/sales/sync";
import { readJson } from "@/lib/server/spins/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Historical import for a date range (YYYY-MM-DD). Stored as source = 'backfill':
 * never grants spins or bonuses. Reports imported vs upstream totals honestly.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const body = await readJson<{ from?: unknown; to?: unknown }>(req);
  if (!body || typeof body.from !== "string" || typeof body.to !== "string") return jsonError(400, "from and to (YYYY-MM-DD) are required.");
  try {
    const report = await backfillSales(auth.pool, body.from, body.to);
    await writeAudit(auth.pool, {
      adminId: auth.ctx.admin.id,
      action: "sync.backfill",
      targetType: "sync",
      targetId: "backfill",
      details: { from: report.from, to: report.to, fetched: report.fetched, inserted: report.inserted, duplicates: report.duplicates, upstreamValidated: report.upstreamValidated, possiblyIncompleteDays: report.possiblyIncompleteDays },
      ip: requestIp(req),
    });
    return NextResponse.json({ ok: report.errors.length === 0, report });
  } catch (err) {
    return jsonError(400, err instanceof Error ? err.message : "Backfill failed.");
  }
}
