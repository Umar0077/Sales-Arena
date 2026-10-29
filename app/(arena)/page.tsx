"use client";

import { AnimatePresence, motion } from "motion/react";
import { useArenaMode } from "@/store/arena-mode-store";
import { useReducedMotion } from "@/lib/performance/reduced-motion";
import { FloorScreen } from "@/components/arena/screens/FloorScreen";
import { PeriodScreen } from "@/components/arena/screens/PeriodScreen";

/** Live Arena: Daily, Weekly, Monthly or Spin & Win, switched in place with a soft transition. */
export default function LiveArenaPage() {
  const mode = useArenaMode();
  const reduced = useReducedMotion();

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
      </motion.div>
    </AnimatePresence>
  );
}
