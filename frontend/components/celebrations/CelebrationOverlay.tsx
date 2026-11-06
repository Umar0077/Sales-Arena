"use client";

import { useEffect } from "react";
import { noteShown } from "@/frontend/live/latency";
import { motion, AnimatePresence } from "motion/react";
import { useCelebrationStore } from "@/frontend/stores/celebration-store";
import { useBonusFlowStore } from "@/frontend/stores/bonus-flow-store";
import { useSpinFlowStore } from "@/frontend/stores/spin-flow-store";
import { teamCelebrationBusy, useTeamCelebrationStore } from "@/frontend/stores/team-celebration-store";
import { useSettingsStore } from "@/frontend/stores/settings-store";
import { audioEngine } from "@/frontend/audio/engine";
import { ConfettiCanvas } from "./ConfettiCanvas";
import { WEEKLY_TOP_MS, WeeklyTopCelebration, useWeeklyTopMotion } from "./WeeklyTopCelebration";
import { celebrationSoundAllowed, playCelebrationSound } from "@/frontend/audio/celebration-sounds";
import { TIERS } from "@/frontend/features/celebrations/tiers";
import { 
  Sparkles, 
  Trophy, 
  Flame, 
  Crown, 
  Gift, 
  CheckCircle2, 
  X, 
  Pause, 
  Play, 
  SkipForward 
} from "lucide-react";

export function CelebrationOverlay() {
  const { current, queue, paused, advance, finishCurrent, skip, pause, resume } = useCelebrationStore();
  const settings = useSettingsStore();
  // Teams Arena only: a team sale celebration on screen goes first (never two sale overlays at once). On every
  // other screen the team layer is not mounted, so this is always false there.
  const teamBusy = useTeamCelebrationStore(teamCelebrationBusy);
  // The Weekly Top Performer ceremony is full screen: it also waits for a running spin (never on top of Spin & Win).
  const spinStage = useSpinFlowStore((s) => s.stage);
  // ... and for a bonus popup that is queued, open or still fading out (the bonus goes first).
  const bonusBusy = useBonusFlowStore((s) => s.active !== null || s.queue.length > 0 || s.exiting);
  const weeklyTopMotion = useWeeklyTopMotion();

  // Advance queue when current is null and queue has items
  useEffect(() => {
    if (queue[0]?.tier === "weekly-top" && (spinStage !== "idle" || bonusBusy)) return;
    if (!current && queue.length > 0 && !paused && !teamBusy) {
      const next = advance();
      if (next) {
        const meta = TIERS[next.tier] || TIERS.sale;
        // Play sound corresponding to the tier (the ceremony plays the Owner's trumpet celebration, once)
        if (next.tier === "weekly-top") playCelebrationSound("bonus", { allowed: celebrationSoundAllowed(meta.sound), key: next.id });
        else audioEngine.play(meta.sound);
      }
    }
  }, [current, queue, paused, advance, teamBusy, spinStage, bonusBusy]);

  // A pause belongs to an open bonus popup or spin journey. If neither is open any more (an owner unmounted
  // before resuming), the pause is stale: release it so sale popups never wait for minutes.
  useEffect(() => {
    if (!paused) return;
    const id = setInterval(() => {
      if (!useBonusFlowStore.getState().active && useSpinFlowStore.getState().stage === "idle") resume();
    }, 5000);
    return () => clearInterval(id);
  }, [paused, resume]);

  // Auto-finish after tier duration
  useEffect(() => {
    if (!current || paused) return;
    if (current.id.startsWith("celeb_sale_")) noteShown("sale", current.id.slice("celeb_sale_".length)); // delivery timeline

    const meta = TIERS[current.tier] || TIERS.sale;
    const duration = current.tier === "weekly-top" ? WEEKLY_TOP_MS[weeklyTopMotion] : settings.celebrationDuration * meta.durationFactor * 1000;

    const timer = setTimeout(() => {
      finishCurrent();
    }, duration);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the ceremony length is fixed when it starts
  }, [current, paused, settings.celebrationDuration, finishCurrent]);

  if (!current) return null;
  if (current.tier === "weekly-top") return <WeeklyTopCelebration key={current.id} event={current} motion={weeklyTopMotion} />;

  const meta = TIERS[current.tier] || TIERS.sale;
  const isFullScreen = meta.fullscreen;
  const banner = !isFullScreen && settings.saleCelebrationStyle === "banner";

  return (
    <>
      {/* Particle explosion */}
      <ConfettiCanvas active={!!current} tier={current.tier} />

      {/* Fullscreen backdrop for highest tiers */}
      {isFullScreen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.85 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 bg-black/80 backdrop-blur-md pointer-events-auto"
        />
      )}

      {/* Celebration Card / Banner */}
      <div
        className={`fixed z-50 transition-all ${
          isFullScreen
            ? "inset-0 flex items-center justify-center p-4 pointer-events-auto"
            : banner
            ? "top-20 left-1/2 -translate-x-1/2 max-w-2xl w-[calc(100%-2rem)] pointer-events-auto"
            : "bottom-16 left-6 max-w-md w-[calc(100%-3rem)] pointer-events-auto"
        }`}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={current.id}
            initial={{ opacity: 0, y: isFullScreen ? 40 : -30, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, y: isFullScreen ? -40 : -20 }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
            className={`relative overflow-hidden rounded-2xl border p-6 shadow-2xl ${
              isFullScreen
                ? "w-full max-w-2xl bg-[#0D1426] border-[#FFC857]/40 glow-gold text-center py-10"
                : "bg-[#0D1426]/95 border-[#7568FF]/30 glow-primary backdrop-blur-xl"
            }`}
            style={{
              borderColor: meta.color,
            }}
          >
            {/* Top accent light sweep */}
            <div
              className="absolute -top-12 left-1/2 -translate-x-1/2 w-48 h-24 rounded-full blur-2xl opacity-60"
              style={{ backgroundColor: meta.color }}
            />

            {/* Controls Bar */}
            <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
              <button
                onClick={paused ? resume : pause}
                title={paused ? "Resume celebration" : "Pause celebration"}
                className="p-1.5 rounded-lg bg-surface hover:bg-surface-hover text-muted hover:text-white transition-colors"
              >
                {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={skip}
                title="Skip this celebration"
                className="p-1.5 rounded-lg bg-surface hover:bg-surface-hover text-muted hover:text-white transition-colors"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={finishCurrent}
                title="Dismiss"
                className="p-1.5 rounded-lg bg-surface hover:bg-surface-hover text-muted hover:text-white transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Content Area */}
            <div className={`relative z-10 flex ${isFullScreen ? "flex-col items-center" : "items-start gap-4"}`}>
              {/* Icon badge */}
              <div
                className={`flex items-center justify-center rounded-xl shadow-lg ${
                  isFullScreen ? "w-20 h-20 mb-4" : "w-12 h-12 shrink-0"
                }`}
                style={{
                  backgroundColor: `${meta.color}20`,
                  border: `1px solid ${meta.color}60`,
                  color: meta.color,
                }}
              >
                {current.tier === "top-performer" && <Crown className={isFullScreen ? "w-10 h-10" : "w-6 h-6"} />}
                {current.tier === "milestone" && <Flame className={isFullScreen ? "w-10 h-10" : "w-6 h-6"} />}
                {current.tier === "spin-unlocked" && <Gift className={isFullScreen ? "w-10 h-10" : "w-6 h-6"} />}
                {current.tier === "team-target" && <Trophy className={isFullScreen ? "w-10 h-10" : "w-6 h-6"} />}
                {current.tier === "special" && <Sparkles className={isFullScreen ? "w-10 h-10" : "w-6 h-6"} />}
                {current.tier === "sale" && <CheckCircle2 className={isFullScreen ? "w-10 h-10" : "w-6 h-6"} />}
              </div>

              {/* Text */}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md"
                    style={{
                      backgroundColor: `${meta.color}25`,
                      color: meta.color,
                    }}
                  >
                    {meta.label}
                  </span>
                  {queue.length > 0 && (
                    <span className="text-[11px] font-mono text-muted">
                      +{queue.length} in queue
                    </span>
                  )}
                </div>

                <h3
                  className={`font-heading font-bold text-white tracking-tight ${
                    isFullScreen ? "text-3xl lg:text-4xl mt-2 mb-3" : "text-lg"
                  }`}
                >
                  {current.headline}
                </h3>

                <p
                  className={`text-secondary text-sm ${
                    isFullScreen ? "text-base max-w-lg mx-auto" : "mt-0.5"
                  }`}
                >
                  {current.subline}
                </p>

                {current.agentName && (
                  <div className={`mt-3 flex items-center gap-2 ${isFullScreen ? "justify-center" : ""}`}>
                    <span className="font-semibold text-white text-sm">
                      {current.agentName}
                    </span>
                    {current.teamName && (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{
                          backgroundColor: `${current.teamColor || meta.color}25`,
                          color: current.teamColor || meta.color,
                        }}
                      >
                        {current.teamName}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Subtle Progress Bar */}
            <motion.div
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{
                duration: settings.celebrationDuration * meta.durationFactor,
                ease: "linear",
              }}
              style={{
                originX: 0,
                backgroundColor: meta.color,
              }}
              className="absolute bottom-0 left-0 right-0 h-1 opacity-70"
            />
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  );
}
