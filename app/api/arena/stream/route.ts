import { NextRequest } from "next/server";
import { safeQuoteSseConsumer } from "@/lib/server/safequote/sse-consumer";
import { arenaBroadcaster } from "@/lib/server/events/broadcaster";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Start the upstream consumer only where background sync is enabled (it writes to PostgreSQL).
  const flag = process.env.SALES_ARENA_SYNC_ENABLED;
  if (flag === "true" || (flag !== "false" && process.env.NODE_ENV === "production")) safeQuoteSseConsumer.start();

  const encoder = new TextEncoder();
  let pingInterval: NodeJS.Timeout | null = null;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event with current SSE consumer health
      const initialPayload = {
        connected: true,
        health: safeQuoteSseConsumer.getHealth(),
        timestamp: new Date().toISOString(),
      };
      controller.enqueue(
        encoder.encode(`event: ready\ndata: ${JSON.stringify(initialPayload)}\n\n`)
      );

      // Subscribe to internal real-time broadcaster
      unsubscribe = arenaBroadcaster.subscribe((event) => {
        try {
          const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Client disconnected
        }
      });

      // Keep-alive heartbeat ping every 15 seconds
      pingInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          if (pingInterval) clearInterval(pingInterval);
        }
      }, 15_000);

      req.signal.addEventListener("abort", () => {
        if (pingInterval) clearInterval(pingInterval);
        if (unsubscribe) unsubscribe();
      });
    },
    cancel() {
      if (pingInterval) clearInterval(pingInterval);
      if (unsubscribe) unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
