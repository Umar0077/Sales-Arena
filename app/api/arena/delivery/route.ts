import { NextResponse, type NextRequest } from "next/server";
import { recordDisplayReport } from "@/lib/server/sales/delivery-trace";

export const dynamic = "force-dynamic";

/**
 * A Live Arena display reports when it received a genuine sale / award and when its popup was on screen
 * (delivery monitoring). Displays have no login, so this only adds times to sales / awards this server
 * broadcast in the last 30 minutes (bounded, in memory). It can never create, change or announce anything.
 */
export async function POST(req: NextRequest) {
  let body: { display?: unknown; items?: unknown } | null = null;
  try {
    const text = await req.text();
    if (text.length > 4096) return NextResponse.json({ ok: false }, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const items = Array.isArray(body?.items) ? body.items.slice(0, 20) : [];
  const display = typeof body?.display === "string" ? body.display : "";
  let recorded = 0;
  for (const it of items) if (it && typeof it === "object" && recordDisplayReport(display, it)) recorded++;
  return NextResponse.json({ ok: true, recorded }, { status: recorded ? 200 : 202, headers: { "Cache-Control": "no-store" } });
}
