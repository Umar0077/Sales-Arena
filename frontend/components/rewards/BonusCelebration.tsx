"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Trophy, CalendarDays, CalendarRange, Sparkles, X } from "lucide-react";
import { AnimatedCounter } from "@/frontend/components/arena/AnimatedCounter";
import { ConfettiCanvas } from "@/frontend/components/celebrations/ConfettiCanvas";
import { audioEngine } from "@/frontend/audio/engine";
import { celebrationSoundAllowed, playCelebrationSound } from "@/frontend/audio/celebration-sounds";
import { useLiteDisplay } from "@/frontend/performance/lite";
import { fillTemplate } from "@/frontend/stores/settings-store";
import { formatReward } from "@/frontend/rewards/engine";
import type { BonusAward, BonusProgram } from "@/frontend/stores/rewards-store";
import type { Agent, Team } from "@/shared/types";

const KIND_META = {
  daily: { label: "DAILY BONUS", period: "today", icon: Sparkles },
  weekly: { label: "WEEKLY MILESTONE", period: "this week", icon: CalendarRange },
  monthly: { label: "MONTHLY CHAMPION", period: "this month", icon: CalendarDays },
} as const;

interface Props {
  awards: BonusAward[];
  /** Current program config (templates, sound, accent). Falls back to the award snapshot. */
  program: BonusProgram | undefined;
  agent: Agent | undefined;
  team: Team | undefined;
  currency: string;
  reducedMotion: boolean;
  onDone: () => void;
}

/** Full-screen bonus announcement used by the Daily, Weekly and Monthly programs. */
export function BonusCelebration({ awards, program, agent, team, currency, reducedMotion, onDone }: Props) {
  const last = awards[awards.length - 1];
  const kind = last.kind;
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  const accent = program?.accent ?? "#FFC857";
  const total = awards.reduce((t, a) => t + a.amount, 0);
  const cur = last.currency || currency;
  const word = kind.toUpperCase();
  const upgrade = last.upgrade === true && (last.previousAmount ?? 0) > 0;
  const seconds = program?.popupSeconds ?? 6;
  const lite = useLiteDisplay(); // Lite: no full-screen backdrop blur (same popup, lighter to paint)
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });

  // Sound: once per popup (keyed by its award ids), with the popup entrance. A cash award plays the
  // "Pa-pa-pa-CHING!" file (coins with the entrance, the CHING at ~0.75 s as the card lands on the amount), gated by
  // the same program sound-category switch as before; a prize award keeps its existing sound.
  const soundKey = awards.map((a) => a.id).join("|");
  const soundRef = useRef({ category: program?.sound ?? "target", cash: (last.rewardType ?? "cash") === "cash" });
  useEffect(() => {
    const { category, cash } = soundRef.current;
    if (cash) playCelebrationSound("bonus", { allowed: celebrationSoundAllowed(category), key: soundKey });
    else audioEngine.play(category);
  }, [soundKey]);

  useEffect(() => {
    const t = setTimeout(() => doneRef.current(), seconds * 1000);
    return () => clearTimeout(t);
  }, [program?.sound, seconds]);

  const name = agent?.name ?? last.agentName;
  const vals = {
    agent: name.split(" ")[0].toUpperCase(),
    name,
    amount: formatReward(total, last.prizeLabel, cur).toUpperCase(),
    sales: last.validatedAtAward,
    program: (program?.name ?? last.programName).toUpperCase(),
    count: awards.length,
  };
  // A tier upgrade shows the new TOTAL and the increase, never the full tier amount as if it were added on top.
  const headline = upgrade ? `${word} BONUS UPGRADED!` : fillTemplate(program?.headline ?? `${word} BONUS UNLOCKED!`, vals);
  const message = fillTemplate(program?.message ?? "{name}", vals);
  const rewardLine = fillTemplate(program?.rewardLine ?? (total > 0 ? "{amount} BONUS EARNED" : "{amount} EARNED"), vals);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bonus-title"
      data-testid="bonus-popup"
      data-kind={kind}
      className="fixed inset-0 z-[75] grid place-items-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className={lite ? "absolute inset-0 bg-[#03050C]/90" : "absolute inset-0 bg-[#03050C]/80 backdrop-blur-md"} data-lite={lite || undefined} />
      {!reducedMotion && <div className="reveal-rays pointer-events-none absolute left-1/2 top-1/2 h-[160vmax] w-[160vmax] -translate-x-1/2 -translate-y-1/2 opacity-60" />}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[55vmin] w-[55vmin] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40 blur-3xl" style={{ background: `radial-gradient(circle, ${accent}, transparent 65%)` }} />
      <ConfettiCanvas active tier="special" />

      <motion.div
        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.75, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 240, damping: 20 }}
        className="relative w-full max-w-xl overflow-hidden rounded-[28px] border bg-gradient-to-b from-[#16123A] via-[#0E1430] to-[#0A0F22] px-6 pb-7 pt-8 text-center sm:px-10"
        style={{ borderColor: `${accent}66`, boxShadow: `0 0 90px -12px ${accent}88` }}
      >
        <button onClick={onDone} aria-label="Close" className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-xl text-text-muted hover:bg-white/5 hover:text-white">
          <X className="h-5 w-5" />
        </button>

        <motion.div
          className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl border"
          style={{ borderColor: `${accent}88`, background: `linear-gradient(135deg, ${accent}40, transparent)` }}
          animate={reducedMotion ? undefined : { scale: [1, 1.08, 1], rotate: [0, -4, 4, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 0.8 }}
        >
          <Trophy className="h-9 w-9" style={{ color: accent, filter: `drop-shadow(0 0 14px ${accent})` }} />
        </motion.div>

        <span
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold tracking-[0.25em]"
          style={{ borderColor: `${accent}55`, color: accent, background: `${accent}14` }}
        >
          <Icon className="h-3.5 w-3.5" /> {meta.label}
        </span>

        <h2 id="bonus-title" className="mt-4 font-heading text-3xl font-extrabold text-white sm:text-4xl">{headline}</h2>
        <p className="mt-3 text-lg font-semibold text-secondary">{message}</p>
        <p className="mt-2 font-heading text-2xl font-extrabold sm:text-3xl" style={{ color: accent, textShadow: `0 0 22px ${accent}88` }} data-testid="bonus-reward-line">
          {upgrade ? `${cur} ${Math.round(last.amount).toLocaleString("en-US")} TOTAL ${word} BONUS`.toUpperCase() : rewardLine}
        </p>
        {upgrade && (
          <p className="mt-1 font-heading text-lg font-bold text-emerald-300" data-testid="bonus-increase">
            +{cur} {Math.round(last.incrementAmount ?? 0).toLocaleString("en-US")} INCREASE
          </p>
        )}

        {total > 0 && (
          <div className="mt-5 font-heading text-5xl font-black text-white tabular sm:text-6xl" style={{ textShadow: `0 0 30px ${accent}66` }}>
            {cur} <AnimatedCounter value={total} duration={1400} formatter={(v) => Math.round(v).toLocaleString("en-US")} />
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-sm">
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-semibold text-white">{name}</span>
          {team && (
            <span className="rounded-full px-3 py-1 font-semibold" style={{ background: `${team.color}22`, color: team.color }}>
              Team {team.name}
            </span>
          )}
          <span className="rounded-full bg-emerald-400/10 px-3 py-1 font-semibold text-emerald-300 tabular" data-testid="bonus-validated">
            {last.validatedAtAward} Validated Sale{last.validatedAtAward === 1 ? "" : "s"} Completed
          </span>
        </div>

        <div className="mx-auto mt-7 h-1 w-56 overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="h-full origin-left rounded-full"
            style={{ background: accent }}
            initial={{ scaleX: 1 }}
            animate={{ scaleX: 0 }}
            transition={{ duration: seconds, ease: "linear" }}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}
