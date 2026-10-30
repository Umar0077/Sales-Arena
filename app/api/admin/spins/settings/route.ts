import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, requestUserAgent, writeAudit } from "@/lib/server/auth/guard";
import { readSpinSettings } from "@/lib/server/spins/ledger";
import { errorResponse, readJson } from "@/lib/server/spins/http";

export const dynamic = "force-dynamic";

/**
 * Automatic spins on/off, the reward activation cutoff, and the manual grant limit.
 * The cutoff cannot be moved into the past: sales recorded before it are never rewarded.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return jsonError(400, "Invalid request.");

  const updates: Array<[string, unknown]> = [];
  if ("autoSpinsEnabled" in body) {
    if (typeof body.autoSpinsEnabled !== "boolean") return jsonError(400, "autoSpinsEnabled must be true or false.");
    updates.push(["auto_spins_enabled", body.autoSpinsEnabled]);
  }
  if ("activationCutoff" in body) {
    const v = body.activationCutoff;
    if (v === null) updates.push(["reward_activation_cutoff", null]);
    else {
      const d = v === "now" ? new Date() : new Date(String(v));
      if (Number.isNaN(d.getTime())) return jsonError(400, "Activation cutoff is not a valid date/time.");
      if (d.getTime() < Date.now() - 10 * 60_000) return jsonError(400, "The activation cutoff cannot be in the past (no retroactive rewards).");
      updates.push(["reward_activation_cutoff", d.toISOString()]);
    }
  }
  if ("manualMaxPerGrant" in body) {
    const n = Number(body.manualMaxPerGrant);
    if (!Number.isInteger(n) || n < 1 || n > 1000) return jsonError(400, "Manual grant limit must be a whole number from 1 to 1000.");
    updates.push(["manual_spin_max_per_grant", n]);
  }
  if (!updates.length) return jsonError(400, "Nothing to update.");

  const client = await auth.pool.connect();
  try {
    await client.query("BEGIN");
    const before = await readSpinSettings(client);
    for (const [key, value] of updates) {
      await client.query(
        `INSERT INTO admin_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, JSON.stringify(value)],
      );
    }
    await writeAudit(client, {
      adminId: auth.ctx.admin.id,
      action: "spins.settings_updated",
      targetType: "admin_settings",
      targetId: "spins",
      details: { before: { ...before, activationCutoff: before.activationCutoff?.toISOString() ?? null }, changes: Object.fromEntries(updates) },
      ip: requestIp(req),
      userAgent: requestUserAgent(req),
    });
    await client.query("COMMIT");
    const after = await readSpinSettings(auth.pool);
    return NextResponse.json({ ok: true, settings: { ...after, activationCutoff: after.activationCutoff?.toISOString() ?? null } });
  } catch (err) {
    await client.query("ROLLBACK");
    return errorResponse(err);
  } finally {
    client.release();
  }
}
