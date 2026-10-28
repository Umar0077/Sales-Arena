import type { CelebrationEvent, Sale, SpinResult } from "@/types";

/**
 * Typed application event bus.
 *
 * All screens react to the same events. Events are also mirrored to other
 * browser tabs through BroadcastChannel so a `/demo` tab can drive an `/arena`
 * TV display in a second window.
 */
export interface ArenaEventMap {
  "sale:recorded": { sale: Sale };
  "spin:unlocked": { agentId: string; available: number; reason?: "target" | "bonus"; periodSales?: number };
  /** Ask the Live Arena display to open the spin stage for an agent (admin → arena). */
  "spin:launch": { agentId: string };
  "spin:started": { spin: SpinResult };
  "spin:completed": { spin: SpinResult };
  "celebration:enqueue": { event: CelebrationEvent };
  "data:reset": Record<string, never>;
  "data:changed": { reason: string };
  "integration:event": { payload: unknown; accepted: boolean; message: string };
}

export type ArenaEventName = keyof ArenaEventMap;
export type ArenaEventHandler<K extends ArenaEventName> = (payload: ArenaEventMap[K], meta: { remote: boolean }) => void;

interface Envelope {
  name: ArenaEventName;
  payload: unknown;
  origin: string;
}

const CHANNEL = "sales-arena-events";

class ArenaEventBus {
  private handlers = new Map<ArenaEventName, Set<ArenaEventHandler<ArenaEventName>>>();
  private channel: BroadcastChannel | null = null;
  private readonly origin = Math.random().toString(36).slice(2);

  private ensureChannel(): void {
    if (this.channel || typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
    this.channel = new BroadcastChannel(CHANNEL);
    this.channel.onmessage = (e: MessageEvent<Envelope>) => {
      const env = e.data;
      if (!env || env.origin === this.origin) return;
      this.dispatch(env.name, env.payload as ArenaEventMap[typeof env.name], true);
    };
  }

  on<K extends ArenaEventName>(name: K, handler: ArenaEventHandler<K>): () => void {
    this.ensureChannel();
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(handler as ArenaEventHandler<ArenaEventName>);
    return () => set!.delete(handler as ArenaEventHandler<ArenaEventName>);
  }

  emit<K extends ArenaEventName>(name: K, payload: ArenaEventMap[K], options: { broadcast?: boolean } = {}): void {
    this.ensureChannel();
    this.dispatch(name, payload, false);
    if (options.broadcast !== false && this.channel) {
      try {
        this.channel.postMessage({ name, payload, origin: this.origin } satisfies Envelope);
      } catch {
        /* non-cloneable payloads are simply not mirrored */
      }
    }
  }

  private dispatch<K extends ArenaEventName>(name: K, payload: ArenaEventMap[K], remote: boolean): void {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const h of [...set]) {
      try {
        (h as ArenaEventHandler<K>)(payload, { remote });
      } catch (err) {
        console.error(`[arena-bus] handler for ${name} failed`, err);
      }
    }
  }
}

export const arenaBus = new ArenaEventBus();
