import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, requestUserAgent, writeAudit } from "@/backend/auth/guard";
import { errorResponse, readJson } from "@/backend/spins/http";
import { arenaBroadcaster } from "@/backend/events/broadcaster";
import { SOUND_TEST_EVENT, createSoundTest, getSoundTest } from "@/backend/audio/sound-test";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

/** A sound test's acknowledgements so far, plus the number of open live connections. Admins only. */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const t = id ? getSoundTest(id) : null;
  return NextResponse.json(
    { ok: true, connectedDisplays: arenaBroadcaster.getSubscriberCount(), test: t ? { id: t.id, createdAt: new Date(t.createdAt).toISOString(), target: t.target, acks: t.acks } : null },
    { headers: noStore },
  );
}

/**
 * Sends a short audio test to the Live Arena displays (all, or the chosen paired displays). Admins only, CSRF-checked.
 * Presentation only: no sale, reward, bonus or spin; displays busy with a genuine popup skip it.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const body = await readJson<{ devices?: unknown }>(req);
  const devices = Array.isArray(body?.devices) ? body.devices.filter((d): d is string => typeof d === "string" && d.length > 0 && d.length < 80) : null;
  if (Array.isArray(body?.devices) && !devices?.length) return jsonError(400, "Choose at least one display.");
  try {
    const t = createSoundTest(auth.ctx.admin.id, devices);
    arenaBroadcaster.broadcast(SOUND_TEST_EVENT, { id: t.id, target: t.target });
    await writeAudit(auth.pool, {
      adminId: auth.ctx.admin.id,
      action: "sound.test.sent",
      targetType: "arena_display",
      targetId: t.target.scope === "all" ? "all" : t.target.devices.join(","),
      details: { id: t.id },
      ip: requestIp(req),
      userAgent: requestUserAgent(req),
    });
    return NextResponse.json({ ok: true, id: t.id, target: t.target, connectedDisplays: arenaBroadcaster.getSubscriberCount() }, { headers: noStore });
  } catch (err) {
    return errorResponse(err);
  }
}
