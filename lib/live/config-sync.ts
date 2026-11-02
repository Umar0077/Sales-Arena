"use client";

import { useSettingsStore } from "@/store/settings-store";
import { useSpinFlowStore } from "@/store/spin-flow-store";
import { useArenaModeStore, resolveMode } from "@/store/arena-mode-store";
import { useRewardsStore, type BonusProgram } from "@/store/rewards-store";
import { useLiveStore } from "@/store/live-store";
import type { ArenaMode, DisplaySettings } from "@/types";

/**
 * Applies the admin's global arena configuration (PostgreSQL) on this display / admin tab.
 * The server row is the authority: browser storage only caches it and is overwritten on every
 * reconciliation. Revisions keep stale or duplicate deliveries from re-applying anything.
 */

export interface ArenaConfigPayload {
  revision: number;
  values: Partial<DisplaySettings>;
  screen?: { screen: ArenaMode | null; revision: number } | null;
}

let appliedRevision = -1;
let screenRevision = -1;
let pending: ArenaConfigPayload | null = null;
let unsubSpin: (() => void) | null = null;
const listeners = new Set<(rev: number) => void>();

const spinning = () => {
  const st = useSpinFlowStore.getState().stage;
  return st === "transition" || st === "spin";
};

/** Called by the admin page when it saved: tabs that saved get the new revision immediately. */
export function onConfigApplied(fn: (rev: number) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const appliedConfigRevision = () => appliedRevision;

function applyNow(c: ArenaConfigPayload) {
  const cur = useSettingsStore.getState() as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c.values)) if (JSON.stringify(cur[k]) !== JSON.stringify(v)) patch[k] = v;
  appliedRevision = c.revision;
  if (Object.keys(patch).length) useSettingsStore.getState().update(patch as Partial<DisplaySettings>);
  // A display that is on a screen the admin just disabled falls back to the default (resolveMode).
  const picked = useArenaModeStore.getState().picked;
  const s = useSettingsStore.getState();
  if (picked && !s.arenaModes[picked]) useArenaModeStore.getState().setPicked(null);
  listeners.forEach((fn) => fn(c.revision));
}

/** Applies a config if it is newer (or the same revision with local drift). */
export function applyArenaConfig(c: ArenaConfigPayload | null | undefined, opts: { initial?: boolean } = {}) {
  if (!c || typeof c.revision !== "number" || !c.values || typeof c.values !== "object") return;
  if (c.revision < appliedRevision) return;
  if (spinning() && !opts.initial) {
    // Never change the arena mid-spin: apply once the wheel has stopped.
    pending = c;
    if (!unsubSpin)
      unsubSpin = useSpinFlowStore.subscribe(() => {
        if (spinning() || !pending) return;
        const p = pending;
        pending = null;
        unsubSpin?.();
        unsubSpin = null;
        applyArenaConfig(p);
      });
  } else applyNow(c);
  if (c.screen) applyScreenSwitch(c.screen, opts);
}

/**
 * "Switch the Live Arena now". On a display's first load the last switch is only recorded:
 * new displays open on the default screen. Later (live event or reconnect) a newer switch moves it.
 */
export function applyScreenSwitch(sw: { screen: ArenaMode | null; revision: number }, opts: { initial?: boolean } = {}) {
  if (!sw || typeof sw.revision !== "number") return;
  if (opts.initial || screenRevision < 0) {
    screenRevision = Math.max(screenRevision, sw.revision);
    // Pin this display to the screen it opened on, so a later default change does not move it.
    if (opts.initial && !useArenaModeStore.getState().picked) {
      const s = useSettingsStore.getState();
      useArenaModeStore.getState().setPicked(resolveMode(null, s));
    }
    return;
  }
  if (sw.revision <= screenRevision) return;
  screenRevision = sw.revision;
  if (sw.screen && useSettingsStore.getState().arenaModes[sw.screen]) useArenaModeStore.getState().setPicked(sw.screen);
}

export async function fetchArenaConfig(): Promise<boolean> {
  try {
    const res = await fetch("/api/arena/config", { cache: "no-store" });
    const j = await res.json();
    if (!res.ok || !j.ok) return false;
    applyArenaConfig({ revision: j.revision, values: j.values, screen: j.screen });
    return true;
  } catch {
    return false; // keep the last verified settings
  }
}

let programsSeq = 0;
/** Live mode: reward programs come from PostgreSQL (only those allowed on the Live Arena). */
export async function fetchLivePrograms(): Promise<boolean> {
  const seq = ++programsSeq;
  try {
    const res = await fetch("/api/arena/programs", { cache: "no-store" });
    const j = await res.json();
    if (seq !== programsSeq) return false;
    if (!res.ok || !j.ok || !Array.isArray(j.programs)) {
      useLiveStore.getState().setProgramsStatus("error"); // keep the last verified programs on screen
      return false;
    }
    useRewardsStore.getState().setLivePrograms(j.programs as BonusProgram[]);
    useLiveStore.getState().setProgramsStatus("ok");
    return true;
  } catch {
    if (seq === programsSeq) useLiveStore.getState().setProgramsStatus("error");
    return false;
  }
}

/** Test hook. */
export function __resetConfigSync() {
  appliedRevision = -1;
  screenRevision = -1;
  pending = null;
  unsubSpin?.();
  unsubSpin = null;
}
