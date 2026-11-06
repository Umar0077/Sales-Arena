"use client";

import { useEffect } from "react";
import { DATA_STORAGE_KEY, useArenaStore } from "@/frontend/stores/arena-store";
import { SETTINGS_STORAGE_KEY, useSettingsStore } from "@/frontend/stores/settings-store";
import { audioEngine } from "@/frontend/audio/engine";
import { detectDeviceQuality } from "@/frontend/performance/quality";
import { DiagnosticsPanel } from "@/frontend/components/performance/DiagnosticsPanel";
import { REWARDS_STORAGE_KEY, useRewardsStore } from "@/frontend/stores/rewards-store";
import { arenaBus } from "@/frontend/events/bus";
import { processValidatedSale } from "@/frontend/rewards/runner";
import { useLiveStore } from "@/frontend/stores/live-store";
import { applyGlobalDisplay, type GlobalDisplay } from "@/frontend/live/display-sync";
import { applyArenaConfig, fetchLivePrograms, type ArenaConfigPayload } from "@/frontend/live/config-sync";

/** Shared by the Live Arena and the Admin Panel: store hydration, audio, cross-tab sync. */
export function AppProviders({ children }: { children: React.ReactNode }) {
  const diagnostics = useSettingsStore((s) => s.diagnostics);
  const tvMode = useSettingsStore((s) => s.tvMode);
  const soundEnabled = useSettingsStore((s) => s.soundEnabled);
  const volume = useSettingsStore((s) => s.volume);
  const soundCategories = useSettingsStore((s) => s.soundCategories);
  const quality = useSettingsStore((s) => s.quality);
  const autoQuality = useSettingsStore((s) => s.autoQuality);

  // Sync performance mode attribute to html root for zero-overhead CSS optimizations
  useEffect(() => {
    const activeQuality = quality === "auto" ? autoQuality : quality;
    const isPerf = activeQuality === "low" || activeQuality === "performance";
    document.documentElement.dataset.perfMode = isPerf ? "performance" : "high";
  }, [quality, autoQuality]);

  // Runs once on mount. It reads the stores directly instead of depending on
  // settings, because the work below changes settings and would re-trigger itself.
  useEffect(() => {
    useSettingsStore.persist.rehydrate();
    useRewardsStore.persist.rehydrate();

    // Decide the data source BEFORE any arena data renders. In live mode the arena starts
    // empty (skeletons) and old demo records in localStorage are never restored.
    let cancelled = false;
    void (async () => {
      let live = false;
      let display: GlobalDisplay | null = null;
      let config: ArenaConfigPayload | null = null;
      try {
        const res = await fetch("/api/arena/mode", { cache: "no-store" });
        const j = res.ok ? await res.json() : null;
        live = j?.live === true;
        display = j?.display ?? null;
        config = j?.config ?? null;
      } catch {
        live = false;
      }
      if (cancelled) return;
      // Admin's global performance mode wins over this browser's saved preference, before heavy graphics start.
      applyGlobalDisplay(display);
      // Global arena configuration (screens, on/off, rewards, sound...) from PostgreSQL wins over browser storage.
      applyArenaConfig(config, { initial: true });
      useLiveStore.getState().setLive(live);
      if (live) {
        useArenaStore.getState().enterLiveMode();
        // Reward programs come from PostgreSQL only: never show the built-in demo amounts.
        useRewardsStore.getState().enterLiveMode();
        void fetchLivePrograms();
      } else {
        await useArenaStore.persist.rehydrate();
        useArenaStore.getState().ensureFreshDay();
      }
      // Signals that the app is interactive (used by the e2e tests).
      document.documentElement.dataset.ready = "true";
    })();

    // Bonus programs: evaluate validated sales recorded in this tab (remote copies are ignored,
    // so two open tabs never award the same sale twice).
    const offSale = arenaBus.on("sale:recorded", ({ sale }, meta) => {
      // Demo only: in live mode awards are created by the server (PostgreSQL), never in the browser.
      if (!meta.remote && sale.status === "approved" && !useArenaStore.getState().liveMode) processValidatedSale(sale.agentId);
    });

    const s = useSettingsStore.getState();
    // Always measure this device: Auto may be chosen globally at any time.
    s.setAutoQuality(detectDeviceQuality());

    // Browsers only allow audio after a user gesture.
    const unlockAudio = () => {
      audioEngine.unlock();
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);

    // Same-browser sync: an Admin tab and a Live Arena tab share localStorage,
    // so reload the store when the other tab writes. (Not cross-device.)
    const onStorage = (e: StorageEvent) => {
      // Live tabs fetch their own data; only demo mode shares records through localStorage.
      if (e.key === DATA_STORAGE_KEY && !useArenaStore.getState().liveMode) useArenaStore.persist.rehydrate();
      if (e.key === SETTINGS_STORAGE_KEY) useSettingsStore.persist.rehydrate();
      if (e.key === REWARDS_STORAGE_KEY && useRewardsStore.getState().source !== "live") useRewardsStore.persist.rehydrate();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      cancelled = true;
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      window.removeEventListener("storage", onStorage);
      offSale();
    };
  }, []);

  useEffect(() => {
    audioEngine.setPrefs({ enabled: soundEnabled, volume, categories: soundCategories });
  }, [soundEnabled, volume, soundCategories]);

  return (
    <>
      <div className={tvMode ? "tv-mode" : undefined}>{children}</div>
      {diagnostics && <DiagnosticsPanel />}
    </>
  );
}
