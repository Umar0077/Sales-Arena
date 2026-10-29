"use client";

import { motion } from "motion/react";
import { CalendarDays, CalendarRange, CalendarClock, Disc3 } from "lucide-react";
import { useSettingsStore } from "@/store/settings-store";
import { ARENA_MODE_LABEL, ARENA_MODE_ORDER, useArenaMode, useArenaModeStore } from "@/store/arena-mode-store";
import { audioEngine } from "@/lib/audio/engine";
import { cn } from "@/lib/utils";
import type { ArenaMode } from "@/types";

const ICONS: Record<ArenaMode, typeof Disc3> = { daily: CalendarDays, weekly: CalendarRange, monthly: CalendarClock, spin: Disc3 };
const SHORT: Record<ArenaMode, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", spin: "Spin & Win" };

/** Segmented control (dropdown on phones) for the Live Arena screens. */
export function ArenaModeSelector() {
  const show = useSettingsStore((s) => s.showModeSelector);
  const enabled = useSettingsStore((s) => s.arenaModes);
  const online = useSettingsStore((s) => s.arenaEnabled);
  const mode = useArenaMode();
  const setPicked = useArenaModeStore((s) => s.setPicked);
  const modes = ARENA_MODE_ORDER.filter((m) => enabled[m]);
  if (!show || !online || modes.length < 2) return null;

  const pick = (m: ArenaMode) => {
    if (m === mode) return;
    audioEngine.play("ui");
    setPicked(m);
  };

  return (
    <>
      <label className="sr-only" htmlFor="arena-mode-select">Live Arena screen</label>
      <select
        id="arena-mode-select"
        value={mode}
        onChange={(e) => pick(e.target.value as ArenaMode)}
        className="h-10 rounded-xl border border-primary/30 bg-surface/80 px-2.5 text-sm font-semibold text-white md:hidden"
      >
        {modes.map((m) => (
          <option key={m} value={m} className="bg-[#0D1426]">{ARENA_MODE_LABEL[m]}</option>
        ))}
      </select>

      <div role="tablist" aria-label="Live Arena screen" className="hidden h-10 items-center gap-0.5 rounded-xl border border-white/[0.08] bg-[#0B1122]/80 p-1 md:flex">
        {modes.map((m) => {
          const Icon = ICONS[m];
          const active = m === mode;
          return (
            <button
              key={m}
              role="tab"
              aria-selected={active}
              aria-label={ARENA_MODE_LABEL[m]}
              title={ARENA_MODE_LABEL[m]}
              onClick={() => pick(m)}
              className={cn(
                "relative flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary",
                active ? "text-white" : "text-text-secondary hover:text-white",
              )}
            >
              {active && (
                <motion.span
                  layoutId="arena-mode-pill"
                  className="absolute inset-0 rounded-lg bg-gradient-to-r from-primary to-[#8B5CFF] shadow-[0_0_18px_-4px_rgba(117,104,255,0.9)]"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              )}
              <Icon className="relative h-4 w-4" />
              <span className="relative hidden xl:inline 2xl:hidden">{SHORT[m]}</span>
              <span className="relative hidden 2xl:inline">{ARENA_MODE_LABEL[m]}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
