"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Agent } from "@/types";
import { useArenaModeStore } from "@/store/arena-mode-store";

const initialsOf = (name: string) =>
  name.split(/s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "FE";
import { AnimatePresence, motion } from "motion/react";
import { useSpinFlowStore, DEMO_AGENT } from "@/store/spin-flow-store";
import { useBonusFlowStore } from "@/store/bonus-flow-store";
import { useArenaStore } from "@/store/arena-store";
import { useCelebrationStore } from "@/store/celebration-store";
import { audioEngine } from "@/lib/audio/engine";
import { useReducedMotion } from "@/lib/performance/reduced-motion";
import dynamic from "next/dynamic";
import { AchievementPopup } from "./AchievementPopup";
import type { SpinOutcome } from "./SpinStage";
import { PrizeReveal } from "./PrizeReveal";

const SpinStage = dynamic(() => import("./SpinStage").then((m) => m.SpinStage), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#070B16]/95">
      <div className="font-heading text-sm font-bold tracking-wider text-secondary animate-pulse">
        PREPARING 3D PRIZE WHEEL...
      </div>
    </div>
  ),
});

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
  const storeAgent = useArenaStore((s) => s.agents.find((a) => a.id === active?.agentId));
  // A live event for a closer not yet on the loaded roster still gets a popup (name + userCode from the server).
  const eventAgent = useMemo<Agent | undefined>(
    () =>
      active?.userCode && active.agentName
        ? { id: active.agentId, name: active.agentName, userCode: active.userCode, initials: initialsOf(active.agentName), teamId: "", campaignId: "cmp_fe", active: true, title: "Closer", hue: 200, joinedAt: new Date(0).toISOString() }
        : undefined,
    [active],
  );
  const agent = active?.demo ? DEMO_AGENT : (storeAgent ?? eventAgent);
  const team = useArenaStore((s) => s.teams.find((t) => t.id === agent?.teamId));
  const reducedMotion = useReducedMotion();
  const [outcome, setOutcome] = useState<SpinOutcome | null>(null);

  // Start the next queued unlock when the arena is free.
  const bonusBusy = useBonusFlowStore((s) => s.active !== null || s.queue.length > 0);
  useEffect(() => {
    if (stage !== "idle" || queueLength === 0 || bonusBusy) return;
    const t = setTimeout(() => {
      const b = useBonusFlowStore.getState();
      if (b.active || b.queue.length) return; // bonus popups go first
      const next = useSpinFlowStore.getState().next();
      if (next && next.reason !== "launch") {
        audioEngine.play("spinUnlocked");
        setTimeout(() => audioEngine.play("target"), 250);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [stage, queueLength, bonusBusy]);

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
    // After a real spin result, go back to Daily Arena (queued popups still follow).
    if (outcome && !useSpinFlowStore.getState().active?.demo) useArenaModeStore.getState().setPicked("daily");
    setOutcome(null);
    setStage("closing");
    setTimeout(() => finish(), reducedMotion ? 150 : 450);
  }, [finish, reducedMotion, setStage, outcome]);

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
            eyebrow={active.origin === "manual" ? "BONUS SPIN AWARDED" : active.origin === "automatic" ? "SPIN UNLOCKED!" : undefined}
            messageOverride={active.message}
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
              <SpinStage agentId={agent.id} agent={agent} demo={Boolean(active.demo)} reducedMotion={reducedMotion} onResult={onResult} onClose={close} />
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
