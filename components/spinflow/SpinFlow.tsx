"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useSpinFlowStore } from "@/store/spin-flow-store";
import { useArenaStore } from "@/store/arena-store";
import { useCelebrationStore } from "@/store/celebration-store";
import { audioEngine } from "@/lib/audio/engine";
import { useReducedMotion } from "@/lib/performance/reduced-motion";
import { AchievementPopup } from "./AchievementPopup";
import { SpinStage, type SpinOutcome } from "./SpinStage";
import { PrizeReveal } from "./PrizeReveal";

/**
 * Runs the Live Arena spin journey:
 * achievement popup → SPIN NOW → cinematic transition → 3D spin → prize reveal → back (after 4s).
 */
export function SpinFlow() {
  const active = useSpinFlowStore((s) => s.active);
  const stage = useSpinFlowStore((s) => s.stage);
  const queueLength = useSpinFlowStore((s) => s.queue.length);
  const setStage = useSpinFlowStore((s) => s.setStage);
  const finish = useSpinFlowStore((s) => s.finish);
  const agent = useArenaStore((s) => s.agents.find((a) => a.id === active?.agentId));
  const team = useArenaStore((s) => s.teams.find((t) => t.id === agent?.teamId));
  const reducedMotion = useReducedMotion();
  const [outcome, setOutcome] = useState<SpinOutcome | null>(null);

  // Start the next queued unlock when the arena is free.
  useEffect(() => {
    if (stage !== "idle" || queueLength === 0) return;
    const t = setTimeout(() => {
      const next = useSpinFlowStore.getState().next();
      if (next && next.reason !== "launch") {
        audioEngine.play("spinUnlocked");
        setTimeout(() => audioEngine.play("target"), 250);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [stage, queueLength]);

  // While the full-screen spin stage covers the arena, stop painting what's underneath.
  const covering = stage === "spin" || stage === "transition";
  useEffect(() => {
    if (!covering) return;
    const t = setTimeout(() => document.documentElement.classList.add("spin-stage-open"), stage === "spin" ? 0 : 900);
    return () => {
      clearTimeout(t);
      document.documentElement.classList.remove("spin-stage-open");
    };
  }, [covering, stage]);

  // Hold normal sale celebrations while the flow is on screen; lock page scroll.
  useEffect(() => {
    if (stage === "idle") return;
    useCelebrationStore.getState().pause();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      useCelebrationStore.getState().resume();
      document.body.style.overflow = prev;
    };
  }, [stage]);

  const close = useCallback(() => {
    setOutcome(null);
    setStage("closing");
    setTimeout(() => finish(), reducedMotion ? 150 : 450);
  }, [finish, reducedMotion, setStage]);

  const goSpin = useCallback(() => {
    audioEngine.unlock();
    audioEngine.play("wheelActivate");
    setStage("transition");
  }, [setStage]);

  const onResult = useCallback((o: SpinOutcome) => setOutcome(o), []);

  if (!active) return null;
  if (!agent) {
    // Unknown agent (e.g. deleted): drop it quietly.
    queueMicrotask(() => finish());
    return null;
  }

  const showStage = stage === "transition" || stage === "spin";

  return (
    <>
      <AnimatePresence>
        {stage === "achievement" && (
          <AchievementPopup
            key={`ach-${active.id}`}
            agent={agent}
            team={team}
            periodSales={active.periodSales}
            available={active.available}
            reason={active.reason}
            reducedMotion={reducedMotion}
            onSpin={goSpin}
            onLater={close}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showStage && (
          <motion.div
            key={`stage-${active.id}`}
            className="fixed inset-0 z-[80] overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-label={`Spin Arena for ${agent.name}`}
            initial={reducedMotion ? { opacity: 0 } : { clipPath: "circle(0% at 50% 55%)" }}
            animate={reducedMotion ? { opacity: 1 } : { clipPath: "circle(150% at 50% 55%)" }}
            exit={{ opacity: 0, scale: 1.04 }}
            transition={{ duration: reducedMotion ? 0.2 : 0.85, ease: [0.65, 0, 0.35, 1] }}
            onAnimationComplete={() => stage === "transition" && setStage("spin")}
          >
            <div className="spin-stage-bg absolute inset-0" />
            <div className="relative min-h-full">
              <SpinStage agentId={agent.id} reducedMotion={reducedMotion} onResult={onResult} onClose={close} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {outcome && showStage && (
          <PrizeReveal
            key={`reveal-${active.id}`}
            agent={agent}
            team={team}
            reward={outcome.reward}
            spinsLeft={outcome.spinsLeft}
            reducedMotion={reducedMotion}
            onDone={close}
          />
        )}
      </AnimatePresence>
    </>
  );
}
