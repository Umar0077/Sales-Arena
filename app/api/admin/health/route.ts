import { NextRequest, NextResponse } from "next/server";
import { getSafeQuoteClient } from "@/lib/server/safequote/client";
import { isDbConnected } from "@/lib/server/db/client";
import { safeQuoteSseConsumer } from "@/lib/server/safequote/sse-consumer";
import { requireAdmin } from "@/lib/server/auth/guard";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const safeQuoteClient = getSafeQuoteClient();
  const apiHealth = await safeQuoteClient.checkHealth();
  const dbHealth = await isDbConnected();
  const sseHealth = safeQuoteSseConsumer.getHealth();

  return NextResponse.json({
    status: apiHealth.ok && dbHealth.connected ? "healthy" : "degraded",
    environment: process.env.NODE_ENV || "development",
    mode: process.env.SALES_ARENA_MODE || (safeQuoteClient.isConfigured() ? "production" : "demo"),
    upstreamApi: apiHealth,
    database: dbHealth,
    sseConsumer: sseHealth,
    timestamp: new Date().toISOString(),
  });
}
