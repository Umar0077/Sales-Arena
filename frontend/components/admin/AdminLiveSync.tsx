"use client";

import { useEffect } from "react";
import { openResilientStream } from "@/frontend/live/resilient-stream";
import { create } from "zustand";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import { loadAdminConfig, useSaveStatus } from "@/frontend/admin/global-settings";
import { appliedConfigRevision } from "@/frontend/live/config-sync";
import { createBackgroundSync } from "@/frontend/live/background-sync";
import { changedDatasets, fetchSyncSnapshot, type SyncFingerprints } from "@/frontend/live/sync-check";
import { useSettingsStore } from "@/frontend/stores/settings-store";

/** Bumped when another admin (or the reward engine) changed programs / awards, so open pages reload. */
interface AdminSync {
  programsRev: number;
  awardsRev: number;
  /** Validated sales changed in PostgreSQL (Overview and other live figures reload). */
  salesRev: number;
  /** Teams / memberships / designations changed. */
  teamsRev: number;
  bump: (k: "programsRev" | "awardsRev" | "salesRev" | "teamsRev") => void;
  /** Last background sync check (diagnostics). */
  lastCheckAt: number | null;
  checkFailures: number;
  /** This admin tab's live stream (diagnostics). */
  stream: "connecting" | "live" | "reconnecting";
  setStream: (s: AdminSync["stream"]) => void;
}
export const useAdminSync = create<AdminSync>()((set, get) => ({
  programsRev: 0,
  awardsRev: 0,
  salesRev: 0,
  teamsRev: 0,
  lastCheckAt: null,
  checkFailures: 0,
  bump: (k) => set({ [k]: get()[k] + 1 } as Pick<AdminSync, typeof k>),
  stream: "connecting",
  setStream: (stream) => {
    if (get().stream !== stream) set({ stream });
  },
}));

const CONFIG_EVENTS = [
  "arena.availability.updated",
  "arena.screens.updated",
  "rewards.program.visibility.updated",
  "settings.celebration.updated",
  "settings.appearance.updated",
  "settings.leaderboard.updated",
  "settings.mascot.updated",
];

/**
 * Keeps every open Admin Panel tab on the authoritative PostgreSQL state: loads it on open and
 * follows changes made by other admins over the same shared SSE stream (one connection per tab).
 */
export function AdminLiveSync() {
  useEffect(() => {
    void loadAdminConfig();
    let first = true;

    // Background sync (default every 15 s): one small fingerprint check per tab; an open page reloads only
    // the data that changed (awards, programs, sales) and never touches a form (pages reload read-only
    // lists; settings reload only for a newer server revision and never over an edit being saved).
    let prevFp: SyncFingerprints | null = null;
    const background = createBackgroundSync({
      intervalMs: () => (Number(useSettingsStore.getState().liveSyncSeconds) || 15) * 1000,
      run: async (signal) => {
        let snap;
        try {
          snap = await fetchSyncSnapshot(signal);
        } catch (e) {
          if (!signal.aborted) useAdminSync.setState((s) => ({ checkFailures: s.checkFailures + 1 }));
          throw e;
        }
        const changed = changedDatasets(prevFp, snap.fp);
        const initial = prevFp === null;
        prevFp = snap.fp;
        useAdminSync.setState({ lastCheckAt: Date.now(), checkFailures: 0 });
        if (initial) return; // pages loaded their data on open
        const sync = useAdminSync.getState();
        if (changed.has("awards")) sync.bump("awardsRev");
        if (changed.has("programs")) sync.bump("programsRev");
        if (changed.has("sales")) sync.bump("salesRev");
        if (changed.has("teams")) sync.bump("teamsRev");
        if (snap.fp.config > appliedConfigRevision()) await loadAdminConfig();
      },
    });
    background.start();

    // Reopened automatically if the browser closes the stream for good (e.g. a 502 during a deploy).
    const closeStream = openResilientStream("/api/arena/stream", (es) => {
    es.addEventListener("error", () => useAdminSync.getState().setStream("reconnecting"));
    es.addEventListener("ready", () => {
      useAdminSync.getState().setStream("live");
      if (!first) {
        void loadAdminConfig(); // reconnected: catch up on anything missed
        useAdminSync.getState().bump("programsRev");
        useAdminSync.getState().bump("awardsRev");
        useAdminSync.getState().bump("salesRev");
        void background.trigger();
      }
      first = false;
    });
    for (const t of CONFIG_EVENTS)
      es.addEventListener(t, (e) => {
        let rev = Infinity;
        try {
          rev = Number(JSON.parse((e as MessageEvent).data)?.revision);
        } catch {
          /* reload anyway */
        }
        if (!(rev <= appliedConfigRevision())) void loadAdminConfig();
      });
    es.addEventListener("rewards.program.updated", () => useAdminSync.getState().bump("programsRev"));
    es.addEventListener("rewards.award.created", () => useAdminSync.getState().bump("awardsRev"));
    es.addEventListener("rewards.award.updated", () => useAdminSync.getState().bump("awardsRev"));
    es.addEventListener("sale.validated", () => useAdminSync.getState().bump("salesRev"));
    es.addEventListener("teams.updated", () => useAdminSync.getState().bump("teamsRev"));
    });
    return () => {
      background.stop();
      closeStream();
    };
  }, []);
  return null;
}

/** Header pill: the real result of the last settings save. */
export function SaveStatusPill() {
  const { state, message } = useSaveStatus();
  if (state === "idle") return null;
  return (
    <span
      role="status"
      data-testid="save-status"
      data-state={state}
      title={message ?? undefined}
      className={
        state === "error"
          ? "inline-flex max-w-[22rem] items-center gap-1.5 truncate rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-300"
          : state === "saving"
            ? "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-text-secondary"
            : "inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300"
      }
    >
      {state === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : state === "error" ? <CircleAlert className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
      {state === "saving" ? "Saving…" : state === "error" ? message : "Saved to all screens"}
    </span>
  );
}
