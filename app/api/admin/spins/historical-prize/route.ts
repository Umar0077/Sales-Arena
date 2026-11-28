import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, requestUserAgent, writeAudit } from "@/backend/auth/guard";
import { errorResponse, readJson } from "@/backend/spins/http";

export const dynamic = "force-dynamic";

/**
 * Controlled Admin-approved recording of historical completed prize outcomes
 * (e.g. demo/preview-determined outcomes that must be preserved in Spin History
 * without fabricating a live wheel execution or consuming/granting credits).
 *
 * Idempotent by (userCode, prizeSlug): never creates a duplicate record.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;

  const body = await readJson<{
    userCode?: unknown;
    prizeTitle?: unknown;
    note?: unknown;
    icon?: unknown;
    color?: unknown;
  }>(req);
  if (!body) return jsonError(400, "Invalid request body.");

  const userCode = typeof body.userCode === "string" ? body.userCode.trim().toUpperCase() : "";
  const prizeTitle = typeof body.prizeTitle === "string" ? body.prizeTitle.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : "Admin-recorded historical campaign outcome";
  const icon = typeof body.icon === "string" && /^[a-z0-9_-]{2,24}$/.test(body.icon) ? body.icon : "gift";
  const color = typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : "#FFC857";

  if (!/^[A-Z0-9:_.-]{1,64}$/.test(userCode)) return jsonError(400, "Valid userCode is required.");
  if (prizeTitle.length < 2 || prizeTitle.length > 100) return jsonError(400, "Prize title must be 2–100 characters.");

  const slug = prizeTitle.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 48);
  const idempotencyKey = `hist:${userCode}:${slug}`;

  const client = await auth.pool.connect();
  try {
    await client.query("BEGIN");
    const agent = await client.query<{ id: string; name: string }>(`SELECT id, name FROM agents WHERE user_code = $1`, [userCode]);
    if (!agent.rowCount) {
      await client.query("ROLLBACK");
      return jsonError(404, "Agent not found.");
    }

    const existing = await client.query<{ id: string }>(`SELECT id FROM spin_results WHERE idempotency_key = $1`, [idempotencyKey]);
    if (existing.rowCount) {
      await client.query("COMMIT");
      return NextResponse.json({ ok: true, replayed: true, spinId: existing.rows[0].id });
    }

    const spinId = `hist_${randomUUID().slice(0, 12)}`;
    await client.query(
      `INSERT INTO spin_results (id, user_code, agent_id, reward_id, reward_title, reward_color, reward_icon, status, mode, segment_index, idempotency_key, actor, reward_snapshot, completed_at)
       VALUES ($1, $2, $3, NULL, $4, $5, $6, 'completed', 'admin_demo_historical_result', NULL, $7, $8, $9, NOW())`,
      [
        spinId,
        userCode,
        agent.rows[0].id,
        prizeTitle,
        color,
        icon,
        idempotencyKey,
        `admin_demo_historical_result:${auth.ctx.admin.email}`.slice(0, 160),
        JSON.stringify({ historical: true, source: "admin_demo_historical_result", note, recordedBy: auth.ctx.admin.email }),
      ],
    );

    await writeAudit(client, {
      adminId: auth.ctx.admin.id,
      action: "spins.historical_prize_recorded",
      targetType: "agent",
      targetId: userCode,
      details: { spinId, prizeTitle, note, idempotencyKey },
      ip: requestIp(req),
      userAgent: requestUserAgent(req),
    });

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, replayed: false, spinId });
  } catch (err) {
    await client.query("ROLLBACK");
    return errorResponse(err, "Could not record historical prize.");
  } finally {
    client.release();
  }
}
