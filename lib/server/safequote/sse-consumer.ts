import { getSafeQuoteClient } from "./client";
import { parseSseSaleEvent } from "./mapper";
import { SseParser } from "./sse-parser";
import { getDbPool } from "../db/client";
import { ingestValidatedSale, recordSaleStatus } from "../sales/ingest";
import { arenaBroadcaster } from "../events/broadcaster";

export type SseConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error" | "stopped";

export interface SseHealthInfo {
  status: SseConnectionStatus;
  reconnectAttempts: number;
  lastConnectedAt: string | null;
  lastEventAt: string | null;
  lastError: string | null;
  eventsProcessed: number;
  /**
   * Upstream event names this consumer does not map to a sale status, with counts and the field names they
   * carried (names only, never values). Each one triggers an immediate check of Safe Quote's validated sales.
   */
  unrecognizedEvents: Record<string, { count: number; lastAt: string; fields: string[] }>;
  /** Validated sales actually written to PostgreSQL (not just received). */
  salesPersisted: number;
  lastPersistedAt: string | null;
  persistFailures: number;
  lastPersistError: string | null;
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
  private salesPersisted = 0;
  private unrecognized: SseHealthInfo["unrecognizedEvents"] = {};
  private activityListeners = new Set<(info: { caseId: string; eventType: string }) => void>();
  private lastPersistedAt: string | null = null;
  private persistFailures = 0;
  private lastPersistError: string | null = null;
  private checkpointSavedAt = 0;

  public getHealth(): SseHealthInfo {
    return {
      status: this.status,
      reconnectAttempts: this.reconnectAttempts,
      lastConnectedAt: this.lastConnectedAt,
      lastEventAt: this.lastEventAt,
      lastError: this.lastError,
      eventsProcessed: this.eventsProcessed,
      salesPersisted: this.salesPersisted,
      lastPersistedAt: this.lastPersistedAt,
      persistFailures: this.persistFailures,
      lastPersistError: this.lastPersistError,
      unrecognizedEvents: this.unrecognized,
    };
  }

  /** Called for upstream case events this consumer does not store itself (see handleIncomingEvent). */
  public onCaseActivity(fn: (info: { caseId: string; eventType: string }) => void): () => void {
    this.activityListeners.add(fn);
    return () => this.activityListeners.delete(fn);
  }

  private noteUnrecognized(rawType: string, data: unknown) {
    const name = String(rawType || "message").slice(0, 64);
    const fields = data && typeof data === "object" ? Object.keys(data as object).slice(0, 25).map((k) => k.slice(0, 40)) : [];
    const cur = this.unrecognized[name];
    if (!cur && Object.keys(this.unrecognized).length >= 20) return; // bounded
    if (!cur) console.warn(`[SafeQuote SSE] Unrecognized upstream event "${name}" (fields: ${fields.join(", ") || "none"}); checking validated sales instead.`);
    this.unrecognized[name] = { count: (cur?.count ?? 0) + 1, lastAt: new Date().toISOString(), fields: [...new Set([...(cur?.fields ?? []), ...fields])].slice(0, 25) };
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    // Resume from the last event id saved before a restart (Last-Event-ID).
    void this.loadCheckpoint().finally(() => this.connect());
  }

  private async loadCheckpoint(): Promise<void> {
    try {
      const { rows } = (await getDbPool()?.query(`SELECT last_event_id FROM sync_checkpoints WHERE id = 'sse'`)) ?? { rows: [] };
      if (rows[0]?.last_event_id) this.lastEventId = rows[0].last_event_id;
    } catch {
      /* table missing or DB down: start from live */
    }
  }

  private async saveCheckpoint(force = false): Promise<void> {
    if (!this.lastEventId || (!force && Date.now() - this.checkpointSavedAt < 5_000)) return;
    this.checkpointSavedAt = Date.now();
    try {
      await getDbPool()?.query(
        `INSERT INTO sync_checkpoints (id, endpoint, last_sync_at, last_event_id, status, details, updated_at)
         VALUES ('sse', '/events', NOW(), $1, 'connected', $2, NOW())
         ON CONFLICT (id) DO UPDATE SET last_sync_at = NOW(), last_event_id = EXCLUDED.last_event_id, status = 'connected', details = EXCLUDED.details, updated_at = NOW()`,
        [this.lastEventId, JSON.stringify({ salesPersisted: this.salesPersisted, persistFailures: this.persistFailures })],
      );
    } catch {
      /* best effort */
    }
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
    // Keeps partial lines and partial messages across network chunks (see sse-parser.ts).
    const parser = new SseParser();

    try {
      while (this.isRunning) {
        const { done, value } = await reader.read();
        if (done) break;
        const messages = parser.push(decoder.decode(value, { stream: true }));
        if (parser.takeComment()) this.resetHeartbeatWatchdog(); // ": ping" heartbeat
        for (const m of messages) {
          if (m.id) this.lastEventId = m.id;
          await this.handleIncomingEvent(m.event, m.data, m.id || undefined);
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

    // Any upstream event about a case that is not a validation we can store directly (an event name this
    // consumer does not know, a submission, a status change) means something just happened at Safe Quote:
    // check its authoritative VALIDATED list right away (scheduler.ts) instead of waiting for the next poll.
    // Nothing is inferred from an unknown event itself.
    if (normalized.eventType !== "heartbeat" && normalized.eventType !== "sale.validated" && normalized.caseId) {
      if (normalized.eventType === "unknown") this.noteUnrecognized(eventType, parsedData);
      for (const fn of this.activityListeners) {
        try {
          fn({ caseId: normalized.caseId, eventType: normalized.eventType === "unknown" ? eventType : normalized.eventType });
        } catch {
          /* a listener never breaks the stream */
        }
      }
    }

    if (normalized.eventType === "heartbeat") {
      return;
    }

    // Deterministic id: the upstream id, else case + type (a redelivery maps to the same id).
    const stableEventId = (eventId || normalized.eventId || `case:${normalized.caseId}:${normalized.eventType}`).slice(0, 128);
    const pool = getDbPool();

    if (normalized.eventType === "sale.validated") {
      if (!pool) {
        this.persistFailures++;
        this.lastPersistError = "DATABASE_URL not configured: validated sale was NOT stored.";
      } else {
        try {
          const r = await ingestValidatedSale(
            pool,
            {
              caseId: normalized.caseId,
              userCode: normalized.userCode,
              closerName: normalized.closerName,
              state: normalized.state,
              carrier: normalized.carrier,
              coverage: normalized.coverage,
              premium: normalized.premium,
              validatedAt: normalized.timestamp,
              eventId: stableEventId,
              eventType: normalized.eventType,
            },
            "sse",
          );
          if (r.status === "inserted") {
            this.salesPersisted++;
            this.lastPersistedAt = new Date().toISOString();
          }
          await this.saveCheckpoint();
        } catch (err) {
          // Not acknowledged: reconciliation (or a later redelivery) will store it.
          this.persistFailures++;
          this.lastPersistError = err instanceof Error ? err.message : String(err);
          console.error("[SafeQuote SSE] Could not store validated sale; reconciliation will retry.", this.lastPersistError);
        }
      }
    } else if ((normalized.eventType === "sale.returned" || normalized.eventType === "sale.rejected") && pool) {
      try {
        await recordSaleStatus(pool, {
          caseId: normalized.caseId,
          status: normalized.eventType === "sale.returned" ? "returned" : "rejected",
          source: "sse",
          eventId: stableEventId,
        });
      } catch (err) {
        this.persistFailures++;
        this.lastPersistError = err instanceof Error ? err.message : String(err);
      }
    }

    // Live screens refresh their numbers from the Safe Quote API on any sale event.
    arenaBroadcaster.broadcast("stats.updated", {
      type: normalized.eventType,
      caseId: normalized.caseId,
      userCode: normalized.userCode,
    });
  }
}

// Singleton worker instance
const globalConsumerKey = Symbol.for("sales_arena.sse_consumer");
const globalObj = globalThis as unknown as { [globalConsumerKey]?: SafeQuoteSseConsumer };

if (!globalObj[globalConsumerKey]) {
  globalObj[globalConsumerKey] = new SafeQuoteSseConsumer();
}

export const safeQuoteSseConsumer = globalObj[globalConsumerKey]!;
