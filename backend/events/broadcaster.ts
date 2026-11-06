export type ArenaBroadcastEventType =
  | "sale.validated"
  | "bonus.awarded"
  | "spin.unlocked"
  | "spin.completed"
  | "rewards.catalog.updated"
  | "settings.performance.updated"
  | "settings.celebration.updated"
  | "settings.appearance.updated"
  | "settings.leaderboard.updated"
  | "settings.mascot.updated"
  | "arena.cub.action"
  | "arena.availability.updated"
  | "arena.screens.updated"
  | "arena.screen.changed"
  | "rewards.program.updated"
  | "rewards.program.visibility.updated"
  | "rewards.award.created"
  | "rewards.award.updated"
  | "security.policy.updated"
  | "target.updated"
  | "teams.updated"
  | "arena.recognition.weekly_top"
  | "stats.updated"
  | "connection.status"
  | "heartbeat";

export interface ArenaBroadcastEvent {
  type: ArenaBroadcastEventType;
  payload: unknown;
  timestamp: string;
}

type Listener = (event: ArenaBroadcastEvent) => void;

class ArenaBroadcaster {
  private listeners: Set<Listener> = new Set();
  private lastHeartbeat: number = Date.now();

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private relay: ((e: ArenaBroadcastEvent) => void) | null = null;

  /** Cross-process forwarding (backend/events/pg-bus.ts); null in single-process mode. */
  public setRelay(fn: ((e: ArenaBroadcastEvent) => void) | null): void {
    this.relay = fn;
  }

  public broadcast(type: ArenaBroadcastEventType, payload: unknown): void {
    const event = this.deliverLocal(type, payload);
    try {
      this.relay?.(event);
    } catch (err) {
      console.error("[ArenaBroadcaster relay]", err);
    }
  }

  /** Delivers to this process's subscribers only (also used for events relayed from other processes). */
  public deliverLocal(type: ArenaBroadcastEventType, payload: unknown): ArenaBroadcastEvent {
    const event: ArenaBroadcastEvent = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[ArenaBroadcaster Error]", err);
      }
    }
    return event;
  }

  public getSubscriberCount(): number {
    return this.listeners.size;
  }
}

// Global singleton across server invocations
const globalBroadcasterKey = Symbol.for("sales_arena.broadcaster");
const globalObj = globalThis as unknown as { [globalBroadcasterKey]?: ArenaBroadcaster };

if (!globalObj[globalBroadcasterKey]) {
  globalObj[globalBroadcasterKey] = new ArenaBroadcaster();
}

export const arenaBroadcaster = globalObj[globalBroadcasterKey]!;
