import { NextResponse, type NextRequest } from "next/server";
import { recordSoundTestAck } from "@/backend/audio/sound-test";
import { resolveSpinActor } from "@/backend/auth/arena-device";

export const dynamic = "force-dynamic";

/**
 * A Live Arena display acknowledges an Admin sound test (did audio start, were the sounds loaded, was the test sound
 * scheduled). Accepted only for a test that exists and has not expired; a paired display is identified on the server
 * from its device cookie (never from the request body). It can never create, change or announce anything.
 */
export async function POST(req: NextRequest) {
  let body: { id?: unknown; display?: unknown; result?: unknown } | null = null;
  try {
    const text = await req.text();
    if (text.length > 4096) return NextResponse.json({ ok: false }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const id = typeof body?.id === "string" ? body.id : "";
  const display = typeof body?.display === "string" ? body.display : "";
  const actor = await resolveSpinActor(req).catch(() => null);
  const device = actor?.kind === "device" ? { id: actor.id, label: actor.label } : null;
  const ok = recordSoundTestAck(id, display, device, body?.result);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404, headers: { "Cache-Control": "no-store" } });
}
