/**
 * Arena Cub command acknowledgments (in memory, bounded). The broadcaster cannot know whether a display
 * played an action, so each Live Arena display reports "started" / "completed" / "interrupted" for a
 * command it actually performed. Only ids of recent commands issued by this server are accepted, every
 * set is capped, and nothing is stored in PostgreSQL. With several app processes, acks land on the
 * process that received them (production runs one).
 */

export type AckPhase = "started" | "completed" | "interrupted";
interface Entry {
  action: string;
  issuedAt: number;
  started: Set<string>;
  completed: Set<string>;
  interrupted: Set<string>;
}

const KEY = Symbol.for("sales_arena.cub_acks");
const g = globalThis as unknown as { [KEY]?: Map<string, Entry> };
const registry: Map<string, Entry> = (g[KEY] ??= new Map());
const MAX_COMMANDS = 200;
const MAX_DISPLAYS = 500;
/** Acks are accepted for this long after a command was issued (its TTL plus the longest action). */
export const ACK_WINDOW_MS = 2 * 60_000;

export function registerCommand(id: string, action: string, issuedAt = Date.now()) {
  registry.set(id, { action, issuedAt, started: new Set(), completed: new Set(), interrupted: new Set() });
  while (registry.size > MAX_COMMANDS) registry.delete(registry.keys().next().value as string);
}

const DISPLAY = /^[a-z0-9-]{8,64}$/;

/** Returns false (ignored) for unknown or old ids, bad display ids or phases. */
export function recordAck(id: unknown, display: unknown, phase: unknown, now = Date.now()): boolean {
  if (typeof id !== "string" || typeof display !== "string" || !DISPLAY.test(display)) return false;
  if (phase !== "started" && phase !== "completed" && phase !== "interrupted") return false;
  const e = registry.get(id);
  if (!e || now - e.issuedAt > ACK_WINDOW_MS) return false;
  const set = e[phase];
  if (set.size >= MAX_DISPLAYS) return false;
  set.add(display);
  return true;
}

export function commandStatus(id: string) {
  const e = registry.get(id);
  if (!e) return null;
  return { action: e.action, issuedAt: new Date(e.issuedAt).toISOString(), started: e.started.size, completed: e.completed.size, interrupted: e.interrupted.size };
}

/** Test hook. */
export function __resetAcks() {
  registry.clear();
}
