import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/server/auth/guard";
import { csrfTokenFor } from "@/lib/server/auth/session";

export const dynamic = "force-dynamic";

/** Current admin plus the CSRF token the admin UI sends on every change (kept in memory, never localStorage). */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json(
    { ok: true, admin: auth.ctx.admin, csrfToken: csrfTokenFor(auth.ctx.token) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
