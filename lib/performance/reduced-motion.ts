"use client";

import { useSyncExternalStore } from "react";
import { useSettingsStore } from "@/store/settings-store";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** True when motion should be reduced: admin setting, or the OS preference when set to "system". */
export function useReducedMotion(): boolean {
  const pref = useSettingsStore((s) => s.motion);
  const system = useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
  return pref === "reduced" || (pref === "system" && system);
}
