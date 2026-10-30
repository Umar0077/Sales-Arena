import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, requestUserAgent, writeAudit } from "@/lib/server/auth/guard";
import { errorResponse } from "@/lib/server/spins/http";

export const dynamic = "force-dynamic";

/** Revokes a display: it can no longer run spins (its cookie stops working immediately). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonError(400, "Invalid display id.");
  try {
    const res = await auth.pool.query(
      `UPDATE arena_devices SET revoked_at = NOW(), token_hash = NULL, pairing_code_hash = NULL WHERE id = $1 AND revoked_at IS NULL RETURNING label`,
      [id],
    );
    if (!res.rowCount) return jsonError(404, "Display not found or already revoked.");
    await writeAudit(auth.pool, { adminId: auth.ctx.admin.id, action: "display.revoked", targetType: "arena_device", targetId: id, details: { label: res.rows[0].label }, ip: requestIp(req), userAgent: requestUserAgent(req) });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
