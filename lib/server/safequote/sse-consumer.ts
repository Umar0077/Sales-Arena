import { getSafeQuoteClient } from "./client";
import { parseSseSaleEvent } from "./mapper";
import { dbQuery } from "../db/client";
import { getRewardEngine } from "../rewards/engine";
import { arenaBroadcaster } from "../events/broadcaster";

export type SseConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error" | "stopped";

export interface SseHealthInfo {
  status: SseConnectionStatus;
  reconnectAttempts: number;
  lastConnectedAt: string | null;
  lastEventAt: string | null;
  lastError: string | null;
  eventsProcessed: number;
}

export class SafeQuoteSseConsumer {
  private status: SseConnectionStatus = "idle";
  private abortController: AbortController | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatWatchdog: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private lastConnectedAt: string | null = null;
  private lastEventAt: string | null = null;
  private lastError: string | null = null;
  private eventsProcessed = 0;
  private lastEventId: string | null = null;
  private isRunning = false;

  public getHealth(): SseHealthInfo {
    return {
      status: this.status,
      reconnectAttempts: this.reconnectAttempts,
      lastConnectedAt: this.lastConnectedAt,
      lastEventAt: this.lastEventAt,
      lastError: this.lastError,
      eventsProcessed: this.eventsProcessed,
    };
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.connect();
  }

  public stop(): void {
    this.isRunning = false;
    this.status = "stopped";
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatWatchdog) {
      clearTimeout(this.heartbeatWatchdog);
      this.heartbeatWatchdog = null;
    }
  }

  private resetHeartbeatWatchdog(): void {
    if (this.heartbeatWatchdog) clearTimeout(this.heartbeatWatchdog);
    // If no event or heartbeat received for 45 seconds, reconnect
    this.heartbeatWatchdog = setTimeout(() => {
      console.warn("[SafeQuote SSE] Heartbeat watchdog timeout (45s). Reconnecting...");
      this.reconnect();
    }, 45_000);
  }

  private scheduleReconnect(): void {
    if (!this.isRunning) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.reconnectAttempts++;
    this.status = "reconnecting";

    // Exponential backoff: min 1s, max 30s + jitter
    const base = Math.min(30_000, 1_000 * Math.pow(1.5, Math.min(this.reconnectAttempts, 8)));
    const jitter = Math.random() * 1_000;
    const delay = Math.round(base + jitter);

    arenaBroadcaster.broadcast("connection.status", {
      status: this.status,
      reconnectInMs: delay,
      attempt: this.reconnectAttempts,
    });

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private reconnect(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.scheduleReconnect();
  }

  private async connect(): Promise<void> {
    const client = getSafeQuoteClient();
    if (!client.isConfigured()) {
      this.status = "error";
      this.lastError = "API Token not configured";
      return;
    }

    this.abortController = new AbortController();
    this.status = "connecting";

    const url = `${client.getBaseUrl()}/events`;
    const token = process.env.SALES_ARENA_API_TOKEN || "";

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      };
      if (this.lastEventId) {
        headers["Last-Event-ID"] = this.lastEventId;
      }

      const response = await fetch(url, {
        method: "GET",
        headers,
        signal: this.abortController.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Upstream SSE rejected with HTTP ${response.status}: ${response.statusText}`);
      }

      this.status = "connected";
      this.lastConnectedAt = new Date().toISOString();
      this.reconnectAttempts = 0;
      this.lastError = null;
      this.resetHeartbeatWatchdog();

      arenaBroadcaster.broadcast("connection.status", {
        status: "connected",
        connectedAt: this.lastConnectedAt,
      });

      await this.readStream(response.body);
    } catch (err: unknown) {
      if (!this.isRunning) return;
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (!isAbort) {
        this.lastError = err instanceof Error ? err.message : String(err);
        console.error("[SafeQuote SSE Connection Error]", this.lastError);
      }
      this.scheduleReconnect();
    }
  }

  private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (this.isRunning) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r\n|\r|\n/);
        buffer = lines.pop() || ""; // keep incomplete tail

        let currentEvent = "message";
        let currentData = "";
        let currentId = "";

        for (const line of lines) {
          if (line.startsWith(":")) {
            // SSE comment / heartbeat ping
            this.resetHeartbeatWatchdog();
            continue;
          }

          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            currentData += (currentData ? "\n" : "") + line.slice(5).trim();
          } else if (line.startsWith("id:")) {
            currentId = line.slice(3).trim();
            this.lastEventId = currentId;
          } else if (line.trim() === "") {
            // End of event block dispatch
            if (currentData) {
              await this.handleIncomingEvent(currentEvent, currentData, currentId);
              currentEvent = "message";
              currentData = "";
              currentId = "";
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async handleIncomingEvent(eventType: string, dataStr: string, eventId?: string): Promise<void> {
    this.resetHeartbeatWatchdog();
    this.lastEventAt = new Date().toISOString();
    this.eventsProcessed++;

    let parsedData: unknown = null;
    try {
      parsedData = JSON.parse(dataStr);
    } catch {
      parsedData = { rawText: dataStr };
    }

    const normalized = parseSseSaleEvent(eventType, parsedData);
    if (!normalized) {
      // Unrecognized event or heartbeat without sales payload
      return;
    }

    if (normalized.eventType === "heartbeat") {
      return;
    }

    // 1. Idempotent recording in PostgreSQL sales_events_inbox
    try {
      const inboxRes = await dbQuery(
        `INSERT INTO sales_events_inbox (
           event_id, event_type, case_id, user_code, payload, processed, received_at
         ) VALUES ($1, $2, $3, $4, $5, false, NOW())
         ON CONFLICT (event_id) DO NOTHING
         RETURNING id`,
        [
          eventId || normalized.eventId || `evt_${normalized.caseId}_${Date.now()}`,
          normalized.eventType,
          normalized.caseId,
          normalized.userCode,
          JSON.stringify(normalized),
        ]
      );

      // If duplicate event_id, do not process again
      if (eventId && inboxRes && inboxRes.rowCount === 0) {
        return;
      }
    } catch (dbErr) {
      console.warn("[SafeQuote SSE Inbox Warning]", dbErr instanceof Error ? dbErr.message : dbErr);
    }

    // 2. Only confirmed validated sales trigger reward issuance
    if (normalized.eventType === "sale.validated") {
      try {
        const rewardEngine = getRewardEngine();
        await rewardEngine.processValidatedSale({
          caseId: normalized.caseId,
          userCode: normalized.userCode,
          closerName: normalized.closerName,
          state: normalized.state,
          carrier: normalized.carrier,
          coverage: normalized.coverage,
          premium: normalized.premium,
          validatedAt: normalized.timestamp,
          rawPayload: normalized.raw,
        });
      } catch (err) {
        console.error("[SafeQuote SSE Reward Processing Error]", err);
      }
    } else {
      // For general stats refresh or pending leads, broadcast to live clients
      arenaBroadcaster.broadcast("stats.updated", {
        type: normalized.eventType,
        caseId: normalized.caseId,
        userCode: normalized.userCode,
      });
    }
  }
}

// Singleton worker instance
const globalConsumerKey = Symbol.for("sales_arena.sse_consumer");
const globalObj = globalThis as unknown as { [globalConsumerKey]?: SafeQuoteSseConsumer };

if (!globalObj[globalConsumerKey]) {
  globalObj[globalConsumerKey] = new SafeQuoteSseConsumer();
}

export const safeQuoteSseConsumer = globalObj[globalConsumerKey]!;
