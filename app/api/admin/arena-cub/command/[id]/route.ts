import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError } from "@/lib/server/auth/guard";
import { commandStatus } from "@/lib/server/cub/acks";

export const dynamic = "force-dynamic";

/** Delivery evidence for a live Arena Cub command: how many displays reported starting / completing it. Admins only. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const s = commandStatus(decodeURIComponent(id));
  if (!s) return jsonError(404, "Unknown or expired command.");
  return NextResponse.json({ ok: true, status: s }, { headers: { "Cache-Control": "no-store" } });
}
