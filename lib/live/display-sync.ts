"use client";

import { useSettingsStore } from "@/store/settings-store";
import { useSpinFlowStore } from "@/store/spin-flow-store";
import { useLiveStore } from "@/store/live-store";
import type { QualitySetting } from "@/types";

/**
 * Applies the admin's GLOBAL performance mode (PostgreSQL) to this display.
 * The browser's own saved quality is only a cache: whatever the server says wins.
 * - Revisions: a duplicate or older event is ignored (no repeated graphics re-init).
 * - Never mid-spin: a change that arrives during a wheel spin is applied when it finishes.
 */

export interface GlobalDisplay {
  performanceMode: QualitySetting;
  revision: number;
}

const MODES: QualitySetting[] = ["auto", "high", "performance"];
let appliedRevision = -1;
let pending: GlobalDisplay | null = null;
let unsubscribe: (() => void) | null = null;

const spinning = () => {
  const stage = useSpinFlowStore.getState().stage;
  return stage === "transition" || stage === "spin";
};

export function applyGlobalDisplay(d: Partial<GlobalDisplay> | null | undefined): void {
  if (!d || !MODES.includes(d.performanceMode as QualitySetting) || typeof d.revision !== "number") return;
  const next = d as GlobalDisplay;
  const local = useSettingsStore.getState().quality;
  // Same revision AND already applied locally → nothing to do. A stale local value is corrected.
  if (next.revision < appliedRevision || (next.revision === appliedRevision && local === next.performanceMode)) return;

  if (spinning()) {
    pending = next;
    unsubscribe ??= useSpinFlowStore.subscribe(() => {
      if (spinning() || !pending) return;
      const p = pending;
      pending = null;
      unsubscribe?.();
      unsubscribe = null;
      applyGlobalDisplay(p);
    });
    return;
  }

  appliedRevision = next.revision;
  useLiveStore.getState().setGlobalDisplay(next);
  if (local !== next.performanceMode) useSettingsStore.getState().update({ quality: next.performanceMode });
}

/** Reconcile with PostgreSQL (on reconnect and the existing 30 s check). One small GET. */
export async function fetchGlobalDisplay(): Promise<void> {
  try {
    const res = await fetch("/api/arena/display-settings", { cache: "no-store" });
    const j = await res.json();
    if (res.ok && j.ok) applyGlobalDisplay({ performanceMode: j.performanceMode, revision: j.revision });
  } catch {
    // keep the last verified setting until the connection returns
  }
}

/** Test hook only. */
export function __resetDisplaySync() {
  appliedRevision = -1;
  pending = null;
  unsubscribe?.();
  unsubscribe = null;
}
