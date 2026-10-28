"use client";

import { useSyncExternalStore } from "react";
import { timeAgo } from "@/lib/utils";

// One shared 10s clock for every <TimeAgo>, so labels refresh without each starting a timer.
const TICK_MS = 10_000;
let now = Date.now();
const listeners = new Set<() => void>();
let interval: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!interval) {
    now = Date.now();
    interval = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && interval) {
      clearInterval(interval);
      interval = null;
    }
  };
}

const getSnapshot = () => now;
// The server has no stable "now", so it renders nothing and the browser fills it in.
const getServerSnapshot = () => null;

/** Relative time ("12s ago") that never causes a server/browser hydration mismatch. */
export function TimeAgo({ iso }: { iso: string }) {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (current === null) return null;
  return <>{timeAgo(iso, current)}</>;
}
