import { NextResponse, type NextRequest } from "next/server";
import { recordAck } from "@/backend/cub/acks";

export const dynamic = "force-dynamic";

/**
 * A Live Arena display reports that it started / completed / was interrupted while playing an Arena Cub
 * command. Displays have no login, so this only counts anonymous display ids for RECENT command ids issued
 * by this server (bounded, in memory). It can never trigger, change or create anything.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> | null = null;
  try {
    const text = await req.text();
    if (text.length > 512) return NextResponse.json({ ok: false }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const ok = recordAck(body?.id, body?.display, body?.phase);
  return NextResponse.json({ ok }, { status: ok ? 200 : 202, headers: { "Cache-Control": "no-store" } });
}
