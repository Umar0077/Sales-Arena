import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, requestIp, writeAudit } from "@/lib/server/auth/guard";
import { reconcileRecentSales } from "@/lib/server/sales/sync";

export const dynamic = "force-dynamic";

/** Re-check yesterday + today from Safe Quote and store anything missed. */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  try {
    const result = await reconcileRecentSales(auth.pool);
    await writeAudit(auth.pool, {
      adminId: auth.ctx.admin.id,
      action: "sync.reconcile",
      targetType: "sync",
      targetId: "reconciliation",
      details: { fetched: result.fetched, inserted: result.inserted, duplicates: result.duplicates, errors: result.errors.length },
      ip: requestIp(req),
    });
    return NextResponse.json({ ok: result.errors.length === 0, result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Reconciliation failed." }, { status: 503 });
  }
}
