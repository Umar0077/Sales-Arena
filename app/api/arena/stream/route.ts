import { NextRequest } from "next/server";
import { safeQuoteSseConsumer } from "@/lib/server/safequote/sse-consumer";
import { arenaBroadcaster } from "@/lib/server/events/broadcaster";
import { startPgEventBus } from "@/lib/server/events/pg-bus";
import { deniedResponse, evaluateAccess } from "@/lib/server/security/enforce";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Start the upstream consumer only where background sync is enabled (it writes to PostgreSQL).
  const flag = process.env.SALES_ARENA_SYNC_ENABLED;
  if (flag === "true" || (flag !== "false" && process.env.NODE_ENV === "production")) safeQuoteSseConsumer.start();
  // Optional: deliver events between several Node processes (SALES_ARENA_EVENT_BUS=postgres).
  void startPgEventBus();

  // IP perimeter: checked again here (the proxy already did) and re-checked while the stream is open,
  // so turning the restriction on or removing a rule also cuts streams that are already connected.
  const reqHeaders = new Headers(req.headers);
  const first = await evaluateAccess("/api/arena/stream", reqHeaders);
  if (!first.decision.allowed) return deniedResponse("/api/arena/stream", first.decision.reason);

  const encoder = new TextEncoder();
  let pingInterval: NodeJS.Timeout | null = null;
  let unsubscribe: (() => void) | null = null;
  let revoked = false;

  const stream = new ReadableStream({
    start(controller) {
      const recheck = async () => {
        if (revoked) return;
        const a = await evaluateAccess("/api/arena/stream", reqHeaders).catch(() => null);
        if (!a || a.decision.allowed || revoked) return;
        revoked = true;
        if (pingInterval) clearInterval(pingInterval);
        if (unsubscribe) unsubscribe();
        try {
          controller.enqueue(encoder.encode(`event: access.revoked\ndata: {}\n\n`));
          controller.close();
        } catch {
          // already closed
        }
      };
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
        if (event.type === "security.policy.updated") void recheck();
        try {
          const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Client disconnected
        }
      });

      // Keep-alive heartbeat ping every 15 seconds
      pingInterval = setInterval(() => {
        void recheck(); // also covers rule expiry and changes made by another process
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
