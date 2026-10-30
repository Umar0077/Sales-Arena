import { NextResponse, type NextRequest } from "next/server";
import { getDbPool } from "@/lib/server/db/client";
import { resolveSpinActor, spinRequestAllowed } from "@/lib/server/auth/arena-device";
import { executeSpin } from "@/lib/server/spins/execute";
import { SpinError } from "@/lib/server/spins/ledger";
import { writeAudit, requestIp } from "@/lib/server/auth/guard";
import { arenaBroadcaster } from "@/lib/server/events/broadcaster";

export const dynamic = "force-dynamic";

const STATUS: Record<SpinError["code"], number> = {
  agent_not_found: 404,
  insufficient_credits: 409,
  invalid_input: 400,
  no_prizes: 409,
  conflict: 409,
};

/**
 * Executes one spin for an agent.
 * Authorised callers only: a signed-in admin or a paired Live Arena display, from this
 * site. The userCode alone is never trusted. The server picks the prize; the wheel
 * animates to the returned `segmentIndex`.
 */
export async function POST(req: NextRequest) {
  if (!spinRequestAllowed(req)) return NextResponse.json({ ok: false, reason: "Cross-site request blocked." }, { status: 403 });
  const pool = getDbPool();
  if (!pool) return NextResponse.json({ ok: false, reason: "Spins are unavailable: the database is not configured." }, { status: 503 });

  let actor;
  try {
    actor = await resolveSpinActor(req);
  } catch {
    return NextResponse.json({ ok: false, reason: "Database unavailable. The spin was not recorded." }, { status: 503 });
  }
  if (!actor) {
    return NextResponse.json(
      { ok: false, code: "display_not_authorized", reason: "This display is not authorised to run spins. Pair it in Admin → Spin Management → Displays." },
      { status: 401 },
    );
  }

  let body: { userCode?: unknown; idempotencyKey?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "Invalid request." }, { status: 400 });
  }
  const userCode = typeof body.userCode === "string" ? body.userCode.trim().toUpperCase() : "";
  const key = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
  if (!/^[A-Z0-9:_.-]{1,64}$/.test(userCode)) return NextResponse.json({ ok: false, reason: "Invalid agent code." }, { status: 400 });

  try {
    const result = await executeSpin(pool, { userCode, idempotencyKey: key, actor: `${actor.kind}:${actor.id}` });
    if (!result.replayed) {
      await writeAudit(pool, {
        adminId: actor.kind === "admin" ? actor.id : null,
        actor: `${actor.kind}:${actor.label}`.slice(0, 128),
        action: "spins.execute",
        targetType: "agent",
        targetId: userCode,
        details: { spinId: result.spinId, rewardId: result.reward.id, availableLeft: result.availableLeft },
        ip: requestIp(req),
      });
      arenaBroadcaster.broadcast("spin.completed", { spinId: result.spinId, userCode, reward: result.reward, availableLeft: result.availableLeft });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof SpinError) return NextResponse.json({ ok: false, code: err.code, reason: err.message }, { status: STATUS[err.code] });
    return NextResponse.json({ ok: false, reason: "The spin could not be completed. No spin was used." }, { status: 503 });
  }
}
