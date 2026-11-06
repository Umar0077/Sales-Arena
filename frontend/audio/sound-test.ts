"use client";

import { Howler } from "howler";
import { audioEngine } from "./engine";
import { prepareCelebrationSound } from "./celebration-sounds";
import { useSettingsStore } from "@/frontend/stores/settings-store";
import { useCelebrationStore } from "@/frontend/stores/celebration-store";
import { useBonusFlowStore } from "@/frontend/stores/bonus-flow-store";
import { useSpinFlowStore } from "@/frontend/stores/spin-flow-store";
import { teamCelebrationBusy, useTeamCelebrationStore } from "@/frontend/stores/team-celebration-store";
import { displayId } from "@/frontend/live/display-id";

/**
 * Admin "Test Live Arena Sounds", on a display: plays ONE short test sound (the validated-sale sound, through the
 * real audio engine, at the configured volume) and reports what happened. Never shows a popup and never creates
 * anything. Skipped while a genuine popup / celebration / spin is on screen, when sound is muted, or when the
 * browser has not allowed audio yet (autoplay rules are never bypassed). Each test plays at most once per display.
 */
const seen = new Set<string>();

function busy(): boolean {
  return (
    !!useCelebrationStore.getState().current ||
    !!useBonusFlowStore.getState().active ||
    teamCelebrationBusy(useTeamCelebrationStore.getState()) ||
    useSpinFlowStore.getState().stage !== "idle"
  );
}

export async function runDisplaySoundTest(payload: unknown): Promise<void> {
  const id = typeof (payload as { id?: unknown })?.id === "string" ? (payload as { id: string }).id : "";
  if (!id || seen.has(id)) return;
  seen.add(id);
  const s = useSettingsStore.getState();
  const before = audioEngine.readiness();
  const soundEnabled = s.soundEnabled !== false;
  const saleCategory = s.soundCategories?.sale !== false;
  let played = false;
  let reason: string;
  if (busy()) reason = "Skipped: a sale, bonus, team celebration or spin was on screen (never interrupted).";
  else if (!soundEnabled) reason = "Muted: Sound effects are off.";
  else if (!saleCategory) reason = "Muted: the Sale approved sound category is off.";
  else if (before === "locked") reason = "Audio not allowed yet: nobody has clicked or pressed a key on this display since it loaded.";
  else if (before === "unavailable") reason = "This browser has no usable audio output.";
  else {
    const running = before === "running" || (await audioEngine.whenRunning(800));
    if (!running) reason = "The browser kept audio suspended.";
    else {
      const plays = audioEngine.diag.plays;
      audioEngine.play("sale");
      played = audioEngine.diag.plays > plays;
      reason = played ? "Test sound scheduled on the audio engine." : "The engine refused the sound (played very recently, or still loading).";
    }
  }
  const trumpetDecoded = before !== "locked" ? await prepareCelebrationSound("bonus").catch(() => false) : false;
  const ctx = Howler.ctx as AudioContext | undefined;
  const result = {
    played,
    reason,
    readiness: audioEngine.readiness(),
    contextState: ctx?.state ?? "not created",
    soundEnabled,
    volume: s.volume,
    saleCategory,
    engineLoaded: audioEngine.loadedCategories().loaded.includes("sale"),
    trumpetDecoded,
    screen: location.pathname,
    browser: navigator.userAgent.slice(0, 120),
  };
  try {
    await fetch("/api/arena/sound-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, display: displayId(), result }),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    /* the Admin sees no acknowledgement from this display */
  }
}
