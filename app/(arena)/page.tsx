"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ARENA_MODE_ORDER, useArenaMode, useArenaModeStore } from "@/store/arena-mode-store";
import { TeamsScreen } from "@/components/arena/screens/TeamsScreen";
import type { ArenaMode } from "@/types";
import { useReducedMotion } from "@/lib/performance/reduced-motion";
import { FloorScreen } from "@/components/arena/screens/FloorScreen";
import { PeriodScreen } from "@/components/arena/screens/PeriodScreen";

/** Live Arena: Daily, Weekly, Monthly, Teams or Spin & Win, switched in place with a soft transition. */
export default function LiveArenaPage() {
  const mode = useArenaMode();
  const reduced = useReducedMotion();

  // Direct link: /?screen=daily|weekly|monthly|teams|spin opens that screen (only if the Admin enabled it;
  // otherwise the display falls back to the default screen as usual).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const screen = sp.get("screen") as ArenaMode | null;
    if (screen && ARENA_MODE_ORDER.includes(screen)) useArenaModeStore.getState().setPicked(screen);
  }, []);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={mode}
        data-arena-mode={mode}
        className="flex flex-1 flex-col"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10, filter: "blur(4px)" }}
        transition={{ duration: reduced ? 0.15 : 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        {mode === "spin" && <FloorScreen variant="spin" />}
        {mode === "daily" && <FloorScreen variant="daily" />}
        {mode === "weekly" && <PeriodScreen kind="weekly" />}
        {mode === "monthly" && <PeriodScreen kind="monthly" />}
        {mode === "teams" && <TeamsScreen />}
      </motion.div>
    </AnimatePresence>
  );
}
