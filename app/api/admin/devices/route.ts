import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, requestUserAgent, writeAudit } from "@/lib/server/auth/guard";
import { generatePairingCode, PAIRING_TTL_MS } from "@/lib/server/auth/arena-device";
import { sha256 } from "@/lib/server/auth/session";
import { errorResponse, readJson } from "@/lib/server/spins/http";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  try {
    const { rows } = await auth.pool.query(
      `SELECT d.id, d.label, d.paired_at, d.last_seen_at, d.revoked_at, d.pairing_expires_at, d.created_at, u.email AS created_by_email,
              (d.pairing_code_hash IS NOT NULL AND d.pairing_expires_at > NOW()) AS awaiting_pairing
         FROM arena_devices d LEFT JOIN admin_users u ON u.id = d.created_by
        ORDER BY d.created_at DESC`,
    );
    return NextResponse.json({ ok: true, devices: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "Could not load displays.");
  }
}

/** Creates a display and a one-time pairing code (shown once, valid 10 minutes). */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const body = await readJson<{ label?: unknown }>(req);
  const label = typeof body?.label === "string" ? body.label.trim().slice(0, 64) : "";
  if (label.length < 2) return jsonError(400, "Give the display a name (e.g. Floor TV 1).");
  const code = generatePairingCode();
  try {
    const { rows } = await auth.pool.query(
      `INSERT INTO arena_devices (label, pairing_code_hash, pairing_expires_at, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
      [label, sha256(code), new Date(Date.now() + PAIRING_TTL_MS), auth.ctx.admin.id],
    );
    await writeAudit(auth.pool, { adminId: auth.ctx.admin.id, action: "display.created", targetType: "arena_device", targetId: rows[0].id, details: { label }, ip: requestIp(req), userAgent: requestUserAgent(req) });
    return NextResponse.json({ ok: true, id: rows[0].id, code, expiresInMinutes: PAIRING_TTL_MS / 60000 });
  } catch (err) {
    return errorResponse(err);
  }
}
