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

/** Shared by the Live Arena and the Admin Panel: store hydration, audio, cross-tab sync. */
export function AppProviders({ children }: { children: React.ReactNode }) {
  const diagnostics = useSettingsStore((s) => s.diagnostics);
  const tvMode = useSettingsStore((s) => s.tvMode);
  const soundEnabled = useSettingsStore((s) => s.soundEnabled);
  const volume = useSettingsStore((s) => s.volume);
  const soundCategories = useSettingsStore((s) => s.soundCategories);

  // Runs once on mount. It reads the stores directly instead of depending on
  // settings, because the work below changes settings and would re-trigger itself.
  useEffect(() => {
    useArenaStore.persist.rehydrate();
    useSettingsStore.persist.rehydrate();
    useRewardsStore.persist.rehydrate();
    useArenaStore.getState().ensureFreshDay();

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
      if (e.key === DATA_STORAGE_KEY) useArenaStore.persist.rehydrate();
      if (e.key === SETTINGS_STORAGE_KEY) useSettingsStore.persist.rehydrate();
      if (e.key === REWARDS_STORAGE_KEY) useRewardsStore.persist.rehydrate();
    };
    window.addEventListener("storage", onStorage);

    // Signals that the app is interactive (used by the e2e tests).
    document.documentElement.dataset.ready = "true";

    return () => {
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
