import { NextRequest, NextResponse } from "next/server";
import { getSafeQuoteClient } from "@/lib/server/safequote/client";
import { isDbConnected } from "@/lib/server/db/client";
import { safeQuoteSseConsumer } from "@/lib/server/safequote/sse-consumer";

export async function GET(_req: NextRequest) {
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
