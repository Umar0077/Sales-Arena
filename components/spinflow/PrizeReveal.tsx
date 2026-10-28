"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useSettingsStore, fillTemplate } from "@/store/settings-store";
import { RewardIconView } from "@/components/brand/RewardIconView";
import { ConfettiCanvas } from "@/components/celebrations/ConfettiCanvas";
import { audioEngine } from "@/lib/audio/engine";
import type { Agent, Reward, Team } from "@/types";

/** Seconds the reveal stays fully visible before returning to the Live Arena. */
export const REVEAL_HOLD_SECONDS = 4;

interface Props {
  agent: Agent;
  team: Team | undefined;
  reward: Reward;
  spinsLeft: number;
  reducedMotion: boolean;
  /** Called once, REVEAL_HOLD_SECONDS after the reveal finished animating in. */
  onDone: () => void;
}

export function PrizeReveal({ agent, team, reward, spinsLeft, reducedMotion, onDone }: Props) {
  const headlineT = useSettingsStore((s) => s.revealHeadline);
  const messageT = useSettingsStore((s) => s.revealMessage);
  const style = useSettingsStore((s) => s.revealStyle);
  const [holding, setHolding] = useState(false);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });

  useEffect(() => {
    audioEngine.play("reveal");
    const t = setTimeout(() => audioEngine.play("special"), 350);
    return () => clearTimeout(t);
  }, []);

  // The 4-second hold starts only once the reveal is fully on screen.
  useEffect(() => {
    if (!holding) return;
    const t = setTimeout(() => doneRef.current(), REVEAL_HOLD_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [holding]);

  const vals = { agent: agent.name.split(" ")[0].toUpperCase(), prize: reward.title.toUpperCase(), sales: "", spins: "" };
  const cinematic = style === "cinematic";

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reveal-title"
      data-reveal-state={holding ? "holding" : "entering"}
      className="fixed inset-0 z-[90] grid place-items-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div className="absolute inset-0 bg-[#03050C]/85 backdrop-blur-lg" />
      {cinematic && !reducedMotion && <div className="reveal-rays pointer-events-none absolute left-1/2 top-1/2 h-[160vmax] w-[160vmax] -translate-x-1/2 -translate-y-1/2" />}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[60vmin] w-[60vmin] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl opacity-50"
        style={{ background: `radial-gradient(circle, ${reward.color}, transparent 65%)` }}
      />
      <ConfettiCanvas active tier="special" />

      <motion.div
        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 40 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={reducedMotion ? { duration: 0.3 } : { type: "spring", stiffness: 200, damping: 18 }}
        onAnimationComplete={() => setHolding(true)}
        className="relative w-full max-w-2xl text-center"
      >
        <motion.div
          className="relative mx-auto mb-7 grid h-36 w-36 place-items-center rounded-full sm:h-44 sm:w-44"
          style={{
            background: `radial-gradient(circle at 35% 30%, ${reward.color}AA, ${reward.color}33 55%, #0B1022 100%)`,
            boxShadow: `0 0 0 3px ${reward.color}88, 0 0 70px ${reward.color}AA, inset 0 0 40px rgba(255,255,255,0.15)`,
          }}
          initial={reducedMotion ? undefined : { rotate: -25 }}
          animate={reducedMotion ? undefined : { rotate: 0 }}
          transition={{ type: "spring", stiffness: 120, damping: 12, delay: 0.1 }}
        >
          <div className="absolute inset-3 rounded-full border-2 border-gold/60" />
          <RewardIconView icon={reward.icon} className="h-16 w-16 text-white drop-shadow-[0_0_18px_rgba(255,255,255,0.7)] sm:h-20 sm:w-20" />
        </motion.div>

        <p className="mb-3 text-sm font-bold tracking-[0.35em] text-secondary">PRIZE UNLOCKED</p>
        <h2 id="reveal-title" className="font-heading text-4xl font-extrabold text-white sm:text-5xl">
          {fillTemplate(headlineT, vals)}
        </h2>
        <motion.p
          className="mt-4 font-heading text-3xl font-extrabold sm:text-4xl"
          style={{ color: "#FFC857", textShadow: "0 0 24px rgba(255,200,87,0.55)" }}
          initial={reducedMotion ? undefined : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
        >
          {fillTemplate(messageT, vals)}
        </motion.p>
        {reward.description && <p className="mx-auto mt-3 max-w-md text-base text-text-secondary">{reward.description}</p>}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-sm">
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-semibold text-white">{agent.name}</span>
          {team && (
            <span className="rounded-full px-3 py-1 font-semibold" style={{ background: `${team.color}22`, color: team.color }}>
              Team {team.name}
            </span>
          )}
          {spinsLeft > 0 && <span className="rounded-full bg-primary/20 px-3 py-1 font-semibold text-primary-hover">{spinsLeft} more spin{spinsLeft > 1 ? "s" : ""} available</span>}
        </div>

        {/* Return countdown */}
        <div className="mx-auto mt-8 w-64">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            {holding && (
              <motion.div
                className="h-full origin-left rounded-full bg-gradient-to-r from-secondary via-primary to-gold"
                initial={{ scaleX: 1 }}
                animate={{ scaleX: 0 }}
                transition={{ duration: REVEAL_HOLD_SECONDS, ease: "linear" }}
              />
            )}
          </div>
          <p className="mt-2 text-xs font-medium text-text-muted">Returning to the Live Arena…</p>
        </div>
      </motion.div>
    </motion.div>
  );
}
