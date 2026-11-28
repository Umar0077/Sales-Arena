import { NextResponse, type NextRequest } from "next/server";
import { getDbPool } from "@/database/client";
import { resolveSpinActor, spinRequestAllowed } from "@/backend/auth/arena-device";
import { completeSpin } from "@/backend/spins/execute";
import { SpinError } from "@/backend/spins/ledger";
import { writeAudit, requestIp } from "@/backend/auth/guard";
import { arenaBroadcaster } from "@/backend/events/broadcaster";
import { publishCatalogUpdated } from "@/backend/rewards/catalog";

export const dynamic = "force-dynamic";

/**
 * Finalizes an 'in-progress' spin once the wheel animation completes on the active TV
 * (or recovers an interrupted spin). Idempotent: safe to call on reconnect/retry.
 */
export async function POST(req: NextRequest) {
  if (!spinRequestAllowed(req)) return NextResponse.json({ ok: false, reason: "Cross-site request blocked." }, { status: 403 });
  const pool = getDbPool();
  if (!pool) return NextResponse.json({ ok: false, reason: "Database unavailable." }, { status: 503 });

  const actor = await resolveSpinActor(req).catch(() => null);
  if (!actor) return NextResponse.json({ ok: false, reason: "Display not authorised." }, { status: 401 });

  let body: { spinId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "Invalid request." }, { status: 400 });
  }
  const spinId = typeof body.spinId === "string" ? body.spinId.trim() : "";
  if (!spinId || spinId.length > 64) return NextResponse.json({ ok: false, reason: "spinId is required." }, { status: 400 });

  try {
    const res = await completeSpin(pool, { spinId });
    if (!res.replayed) {
      await writeAudit(pool, {
        adminId: actor.kind === "admin" ? actor.id : null,
        actor: `${actor.kind}:${actor.label}`.slice(0, 128),
        action: "spins.complete",
        targetType: "agent",
        targetId: res.userCode,
        details: { spinId: res.spinId, rewardId: res.reward.id, availableLeft: res.availableLeft },
        ip: requestIp(req),
      });
      arenaBroadcaster.broadcast("spin.completed", {
        spinId: res.spinId,
        userCode: res.userCode,
        reward: res.reward,
        availableLeft: res.availableLeft,
      });
      void publishCatalogUpdated(pool);
    }
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    if (err instanceof SpinError) return NextResponse.json({ ok: false, code: err.code, reason: err.message }, { status: 400 });
    return NextResponse.json({ ok: false, reason: "Could not complete spin." }, { status: 503 });
  }
}
