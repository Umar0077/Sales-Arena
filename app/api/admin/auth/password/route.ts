import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, requestUserAgent, writeAudit } from "@/lib/server/auth/guard";
import { hashPassword, validateNewPassword, verifyPassword } from "@/lib/server/auth/password";
import { revokeOtherSessions } from "@/lib/server/auth/session";

export const dynamic = "force-dynamic";

/** Change own password. Requires the current password; signs out every other session. */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid request.");
  }
  const { admin, sessionId } = auth.ctx;
  const problem = validateNewPassword(body.newPassword, admin.email);
  if (problem) return jsonError(400, problem);
  if (typeof body.currentPassword !== "string") return jsonError(400, "Current password is required.");
  if (body.currentPassword === body.newPassword) return jsonError(400, "Choose a password different from the current one.");

  const { rows } = await auth.pool.query(`SELECT password_hash FROM admin_users WHERE id = $1`, [admin.id]);
  if (!rows[0] || !(await verifyPassword(rows[0].password_hash, body.currentPassword))) {
    await writeAudit(auth.pool, { adminId: admin.id, action: "admin.password_change_failed", targetType: "admin_user", targetId: admin.id, ip: requestIp(req) });
    return jsonError(400, "Current password is incorrect.");
  }

  const newHash = await hashPassword(body.newPassword as string);
  const client = await auth.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE admin_users SET password_hash = $1, password_changed_at = NOW(), updated_at = NOW() WHERE id = $2`, [newHash, admin.id]);
    const revoked = await revokeOtherSessions(client, admin.id, sessionId);
    await writeAudit(client, {
      adminId: admin.id,
      action: "admin.password_changed",
      targetType: "admin_user",
      targetId: admin.id,
      details: { otherSessionsRevoked: revoked },
      ip: requestIp(req),
      userAgent: requestUserAgent(req),
    });
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, otherSessionsRevoked: revoked });
  } catch {
    await client.query("ROLLBACK");
    return jsonError(503, "Could not change the password. Nothing was saved.");
  } finally {
    client.release();
  }
}
