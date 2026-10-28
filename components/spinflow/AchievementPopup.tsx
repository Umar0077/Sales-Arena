"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Trophy, Sparkles, Disc3 } from "lucide-react";
import { useSettingsStore, fillTemplate } from "@/store/settings-store";
import type { Agent, Team } from "@/types";

interface Props {
  agent: Agent;
  team: Team | undefined;
  periodSales: number;
  available: number;
  reason: "target" | "bonus" | "launch";
  reducedMotion: boolean;
  onSpin: () => void;
  onLater: () => void;
}

/** "Target completed → SPIN NOW" popup. Clearly bigger than a normal sale toast. */
export function AchievementPopup({ agent, team, periodSales, available, reason, reducedMotion, onSpin, onLater }: Props) {
  const headlineT = useSettingsStore((s) => s.achievementHeadline);
  const messageT = useSettingsStore((s) => s.achievementMessage);
  const rewardT = useSettingsStore((s) => s.achievementReward);
  const timeout = useSettingsStore((s) => s.spinPopupTimeoutSec);
  const [left, setLeft] = useState(timeout);

  // Unattended TV: close after the timeout. The earned spin stays available.
  useEffect(() => {
    if (timeout <= 0) return;
    const started = Date.now();
    const id = setInterval(() => {
      const remaining = Math.max(0, timeout - Math.floor((Date.now() - started) / 1000));
      setLeft(remaining);
      if (remaining === 0) {
        clearInterval(id);
        onLater();
      }
    }, 250);
    return () => clearInterval(id);
  }, [timeout, onLater]);

  const firstName = agent.name.split(" ")[0].toUpperCase();
  const spinsLabel = `${Math.max(1, available)} Spin${available > 1 ? "s" : ""}`;
  const vals = { agent: firstName, sales: periodSales, spins: spinsLabel, prize: "" };
  const message = reason === "bonus" ? "You've been awarded a bonus spin!" : fillTemplate(messageT, vals);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="achievement-title"
      className="fixed inset-0 z-[70] grid place-items-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-[#03050C]/80 backdrop-blur-md" />
      <motion.div
        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 260, damping: 22 }}
        className="relative w-full max-w-xl overflow-hidden rounded-[28px] border border-gold/40 bg-gradient-to-b from-[#1A1338] via-[#0E1430] to-[#0A0F22] px-6 pb-8 pt-10 text-center shadow-[0_0_80px_-10px_rgba(255,200,87,0.45)] sm:px-10"
      >
        {/* Light sweep + rays */}
        {!reducedMotion && <div className="achv-rays pointer-events-none absolute -top-1/2 left-1/2 h-[200%] w-[200%] -translate-x-1/2 opacity-40" />}
        <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-gold/30 blur-3xl" />

        <motion.div
          className="relative mx-auto mb-5 grid h-24 w-24 place-items-center rounded-3xl border border-gold/50 bg-gradient-to-br from-gold/30 to-orange-500/10"
          animate={reducedMotion ? undefined : { rotate: [0, -6, 6, -3, 0], scale: [1, 1.08, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 1.2 }}
        >
          <Trophy className="h-12 w-12 text-gold drop-shadow-[0_0_14px_rgba(255,200,87,0.8)]" />
          <Sparkles className="absolute -right-3 -top-3 h-6 w-6 text-secondary" />
        </motion.div>

        <p className="relative mb-2 text-xs font-bold tracking-[0.3em] text-secondary">TARGET COMPLETED</p>
        <h2 id="achievement-title" className="relative font-heading text-3xl font-extrabold text-white sm:text-4xl">
          {fillTemplate(headlineT, vals)}
        </h2>
        <p className="relative mt-3 text-lg font-medium text-text-secondary">{message}</p>
        <p className="relative mt-1 text-xl font-bold text-gold">{fillTemplate(rewardT, vals)}</p>
        {team && (
          <span
            className="relative mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
            style={{ background: `${team.color}22`, color: team.color }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: team.color }} />
            Team {team.name}
          </span>
        )}

        <div className="relative mt-8 flex flex-col items-center gap-3">
          <button
            onClick={onSpin}
            autoFocus
            className="spin-cta group relative inline-flex items-center gap-3 rounded-2xl bg-gradient-to-r from-[#FFC857] via-[#FFB347] to-[#FF7A45] px-10 py-4 font-heading text-xl font-extrabold tracking-wide text-[#1A1206] shadow-[0_12px_40px_-8px_rgba(255,180,71,0.8)] transition-transform hover:scale-[1.03] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold/50"
          >
            <Disc3 className="h-6 w-6 transition-transform duration-700 group-hover:rotate-180" />
            SPIN NOW
          </button>
          <button onClick={onLater} className="text-sm font-medium text-text-muted hover:text-white transition-colors">
            Spin later{timeout > 0 ? ` · closes in ${left}s` : ""}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
