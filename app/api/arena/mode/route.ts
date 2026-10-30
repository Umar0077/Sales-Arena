import { NextResponse } from "next/server";
import { getSafeQuoteClient } from "@/lib/server/safequote/client";

export const dynamic = "force-dynamic";

/**
 * Tells the browser, before anything renders, whether this server runs on live Safe Quote data.
 * In live mode the client never shows demo records. No upstream call, no secrets.
 */
export async function GET() {
  const live = getSafeQuoteClient().isConfigured() && process.env.SALES_ARENA_MODE !== "demo";
  return NextResponse.json({ ok: true, live }, { headers: { "Cache-Control": "no-store" } });
}
