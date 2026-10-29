import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/server/admin/auth";
import { reconcileRecentSales } from "@/lib/server/safequote/reconciliation";

export async function POST(req: NextRequest) {
  const auth = verifyAdminAuth(req);
  if (!auth.authorized) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: 401 });
  }

  try {
    const result = await reconcileRecentSales();
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Reconciliation failed" },
      { status: 500 }
    );
  }
}
