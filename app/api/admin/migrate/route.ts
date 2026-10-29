import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/server/admin/auth";
import { runMigrations } from "@/lib/server/db/migrations";

export async function POST(req: NextRequest) {
  const auth = verifyAdminAuth(req);
  if (!auth.authorized) {
    return NextResponse.json({ ok: false, error: auth.reason }, { status: 401 });
  }

  try {
    const res = await runMigrations();
    return NextResponse.json(res, { status: res.success ? 200 : 500 });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
