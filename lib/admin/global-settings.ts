"use client";

import { create } from "zustand";
import { adminApi } from "@/components/admin/admin-api";
import { useSettingsStore } from "@/store/settings-store";
import { applyArenaConfig } from "@/lib/live/config-sync";
import { isGlobalSetting } from "@/lib/settings/global-keys";
import type { DisplaySettings } from "@/types";

/**
 * Admin save path for settings. Global settings go to PostgreSQL (PUT /api/admin/arena-config) and
 * from there to every display; per-device ones stay in this browser.
 *
 * The control shows the new value at once, the save is sent after a short pause (typing in a text
 * field is one save), and if the server refuses it the control goes back to the saved value and
 * the error is shown. "Saved" is only shown after the server confirmed the commit.
 */

export type SaveState = "idle" | "saving" | "saved" | "error";
interface SaveStore {
  state: SaveState;
  message: string | null;
  at: number;
  revision: number | null;
  set: (s: Partial<Omit<SaveStore, "set">>) => void;
}
export const useSaveStatus = create<SaveStore>()((set) => ({ state: "idle", message: null, at: 0, revision: null, set: (s) => set(s) }));

/** Last values confirmed by the server, used to roll back a refused change. */
let confirmed: Partial<DisplaySettings> = {};
let queued: Partial<DisplaySettings> = {};
let timer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<void> | null = null;
let waiters: Array<(ok: boolean) => void> = [];

/** Other save queues (e.g. Arena Cub) report unsent / in-flight edits, so a reload never overwrites them. */
const pendingEdits = new Set<() => boolean>();
export function registerPendingEdits(fn: () => boolean): () => void {
  pendingEdits.add(fn);
  return () => pendingEdits.delete(fn);
}

export function rememberConfirmed(values: Partial<DisplaySettings>) {
  confirmed = { ...confirmed, ...values };
}

async function flush(): Promise<void> {
  timer = null;
  if (inflight) await inflight;
  const patch = queued;
  queued = {};
  const done = waiters;
  waiters = [];
  if (!Object.keys(patch).length) return done.forEach((w) => w(true));
  useSaveStatus.getState().set({ state: "saving", message: null });
  inflight = (async () => {
    const r = await adminApi<{ revision: number; values: Partial<DisplaySettings> }>("/api/admin/arena-config", { method: "PUT", body: { values: patch } });
    if (r.ok) {
      rememberConfirmed(r.data.values);
      applyArenaConfig({ revision: r.data.revision, values: r.data.values });
      useSaveStatus.getState().set({ state: "saved", message: "Saved. All connected screens are updating.", at: Date.now(), revision: r.data.revision });
      done.forEach((w) => w(true));
    } else {
      // Roll the controls back to what is actually saved.
      const back: Record<string, unknown> = {};
      for (const k of Object.keys(patch)) if (k in confirmed) back[k] = (confirmed as Record<string, unknown>)[k];
      if (Object.keys(back).length) useSettingsStore.getState().update(back as Partial<DisplaySettings>);
      useSaveStatus.getState().set({ state: "error", message: `Not saved: ${r.error}`, at: Date.now() });
      done.forEach((w) => w(false));
    }
  })();
  await inflight;
  inflight = null;
}

// A change still waiting for its short debounce when the page is hidden, reloaded or closed is sent at once
// (keepalive lets the request finish after the page is gone), so a quick reload never loses it.
if (typeof window !== "undefined")
  window.addEventListener("pagehide", () => {
    if (!Object.keys(queued).length) return;
    if (timer) clearTimeout(timer);
    timer = null;
    const patch = queued;
    queued = {};
    void adminApi("/api/admin/arena-config", { method: "PUT", body: { values: patch }, keepalive: true });
  });

/** Use in admin pages instead of useSettingsStore().update. Resolves true once saved. */
export function saveSettings(patch: Partial<DisplaySettings>, opts: { immediate?: boolean } = {}): Promise<boolean> {
  const local: Record<string, unknown> = {};
  const global: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) (isGlobalSetting(k) ? global : local)[k] = v;
  useSettingsStore.getState().update(patch);
  if (!Object.keys(global).length) return Promise.resolve(true);
  queued = { ...queued, ...global };
  if (timer) clearTimeout(timer);
  const p = new Promise<boolean>((res) => waiters.push(res));
  timer = setTimeout(() => void flush(), opts.immediate ? 0 : 450);
  return p;
}

/** Loads the authoritative config into this admin tab (on open, on events, on reconnect). */
/** `recovery`: a save queue re-syncing after its own failed request (its pending-edit guard does not apply). */
export async function loadAdminConfig(opts: { recovery?: boolean } = {}): Promise<boolean> {
  const r = await adminApi<{ revision: number; values: Partial<DisplaySettings>; screen: { screen: null; revision: number } }>("/api/admin/arena-config");
  if (!r.ok) {
    useSaveStatus.getState().set({ state: "error", message: `Settings could not be loaded from the server: ${r.error}`, at: Date.now() });
    return false;
  }
  if (Object.keys(queued).length || inflight || (!opts.recovery && [...pendingEdits].some((f) => f()))) return true; // don't overwrite an edit that is being saved
  rememberConfirmed(r.data.values);
  applyArenaConfig({ revision: r.data.revision, values: r.data.values });
  return true;
}
