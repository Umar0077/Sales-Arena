"use client";

import { useEffect } from "react";
import { DATA_STORAGE_KEY, useArenaStore } from "@/store/arena-store";
import { SETTINGS_STORAGE_KEY, useSettingsStore } from "@/store/settings-store";
import { audioEngine } from "@/lib/audio/engine";
import { detectDeviceQuality } from "@/lib/performance/quality";
import { DiagnosticsPanel } from "@/components/performance/DiagnosticsPanel";
import { REWARDS_STORAGE_KEY, useRewardsStore } from "@/store/rewards-store";
import { arenaBus } from "@/lib/events/bus";
import { processValidatedSale } from "@/lib/rewards/runner";
import { useLiveStore } from "@/store/live-store";

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
      try {
        const res = await fetch("/api/arena/mode", { cache: "no-store" });
        live = res.ok && (await res.json()).live === true;
      } catch {
        live = false;
      }
      if (cancelled) return;
      useLiveStore.getState().setLive(live);
      if (live) {
        useArenaStore.getState().enterLiveMode();
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
      if (!meta.remote && sale.status === "approved") processValidatedSale(sale.agentId);
    });

    const s = useSettingsStore.getState();
    if (s.quality === "auto") s.setAutoQuality(detectDeviceQuality());

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
      if (e.key === REWARDS_STORAGE_KEY) useRewardsStore.persist.rehydrate();
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
