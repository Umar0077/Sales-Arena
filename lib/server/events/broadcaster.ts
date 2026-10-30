export type ArenaBroadcastEventType =
  | "sale.validated"
  | "bonus.awarded"
  | "spin.unlocked"
  | "spin.completed"
  | "rewards.catalog.updated"
  | "target.updated"
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

  public broadcast(type: ArenaBroadcastEventType, payload: unknown): void {
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
