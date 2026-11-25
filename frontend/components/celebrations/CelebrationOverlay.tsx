"use client";

import { AgentEmoji } from "./AgentEmoji";
import { useEffect } from "react";
import { noteShown } from "@/frontend/live/latency";
import { motion, AnimatePresence } from "motion/react";
import { useCelebrationStore } from "@/frontend/stores/celebration-store";
import { useBonusFlowStore } from "@/frontend/stores/bonus-flow-store";
import { useSpinFlowStore } from "@/frontend/stores/spin-flow-store";
import { teamCelebrationBusy, useTeamCelebrationStore } from "@/frontend/stores/team-celebration-store";
import { useSettingsStore } from "@/frontend/stores/settings-store";
import { useLiteDisplay } from "@/frontend/performance/lite";
import { useReducedMotion } from "@/frontend/performance/reduced-motion";
import { useArenaTheme } from "@/frontend/theme/arena-theme";
import { audioEngine } from "@/frontend/audio/engine";
import { announceSaleVoice, cancelVoiceAnnouncement } from "@/frontend/audio/voice-announcer";
import { ConfettiCanvas } from "./ConfettiCanvas";
import { WEEKLY_TOP_MS, WeeklyTopCelebration, useWeeklyTopMotion } from "./WeeklyTopCelebration";
import { WeeklyTopTeamCelebration } from "./WeeklyTopTeamCelebration";
import { celebrationSoundAllowed, playCelebrationSound } from "@/frontend/audio/celebration-sounds";
import { TIERS, SALE_CELEBRATION_MAX_MS, saleCelebrationDurationMs } from "@/frontend/features/celebrations/tiers";
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

export function CelebrationOverlay({ previewEvent }: { previewEvent?: import("@/shared/types").CelebrationEvent } = {}) {
  const { current: liveCurrent, queue, paused, advance, finishCurrent, skip, pause, resume } = useCelebrationStore();
  const current = previewEvent ?? liveCurrent;
  const settings = useSettingsStore();
  // Teams Arena only: a team sale celebration on screen goes first (never two sale overlays at once). On every
  // other screen the team layer is not mounted, so this is always false there.
  const teamBusy = useTeamCelebrationStore(teamCelebrationBusy);
  // The Weekly Top Performer ceremony is full screen: it also waits for a running spin (never on top of Spin & Win).
  const spinStage = useSpinFlowStore((s) => s.stage);
  // ... and for a bonus popup that is queued, open or still fading out (the bonus goes first).
  const bonusBusy = useBonusFlowStore((s) => s.active !== null || s.queue.length > 0 || s.exiting);
  const weeklyTopMotion = useWeeklyTopMotion();
  const lite = useLiteDisplay();
  const reducedMotion = useReducedMotion();
  const { isChristmas } = useArenaTheme();

  // Advance queue when current is null and queue has items
  useEffect(() => {
    if (previewEvent) return;
    if ((queue[0]?.tier === "weekly-top" || queue[0]?.tier === "weekly-top-team") && (spinStage !== "idle" || bonusBusy)) return;
    if (!current && queue.length > 0 && !paused && !teamBusy) {
      const next = advance();
      if (next) {
        const meta = TIERS[next.tier] || TIERS.sale;
        // Play sound corresponding to the tier; standard sales sequence sound -> voice announcement in the active effect below.
        if (next.tier === "weekly-top" || next.tier === "weekly-top-team") {
          playCelebrationSound("bonus", { allowed: celebrationSoundAllowed(meta.sound), key: next.id });
        } else if (next.tier !== "sale") audioEngine.play(meta.sound);
      }
    }
  }, [current, queue, paused, advance, teamBusy, spinStage, bonusBusy, previewEvent]);

  // A pause belongs to an open bonus popup or spin journey. If neither is open any more (an owner unmounted
  // before resuming), the pause is stale: release it so sale popups never wait for minutes.
  useEffect(() => {
    if (previewEvent) return;
    if (!paused) return;
    const id = setInterval(() => {
      if (!useBonusFlowStore.getState().active && useSpinFlowStore.getState().stage === "idle") resume();
    }, 5000);
    return () => clearInterval(id);
  }, [paused, resume, previewEvent]);

  // Auto-finish after tier duration (and for standard sales: sequence existing sale sound -> friendly female voice)
  useEffect(() => {
    if (previewEvent) return;
    if (!current || paused) return;
    if (current.id.startsWith("celeb_sale_")) noteShown("sale", current.id.slice("celeb_sale_".length)); // delivery timeline

    const meta = TIERS[current.tier] || TIERS.sale;
    const isStandardSale = current.tier === "sale";
    const baseDurationMs =
      current.tier === "weekly-top" || current.tier === "weekly-top-team"
        ? WEEKLY_TOP_MS[weeklyTopMotion]
        : isStandardSale
        ? saleCelebrationDurationMs(settings.celebrationDuration)
        : settings.celebrationDuration * meta.durationFactor * 1000;

    if (!isStandardSale) {
      const timer = setTimeout(() => {
        finishCurrent();
      }, baseDurationMs);
      return () => clearTimeout(timer);
    }

    let alive = true;
    const ownerToken = `celeb_${current.id}`;
    const minHoldPromise = new Promise<void>((r) => setTimeout(r, baseDurationMs));
    const maxCapPromise = new Promise<void>((r) => setTimeout(r, Math.max(baseDurationMs, SALE_CELEBRATION_MAX_MS)));

    const audioAndVoice = audioEngine
      .playWithCompletion("sale")
      .catch(() => "skipped" as const)
      .then(() => {
        if (!alive) return;
        return announceSaleVoice({
          eventId: current.id,
          agentName: current.agentName,
          ownerToken,
        });
      })
      .catch(() => undefined);

    void Promise.race([Promise.all([minHoldPromise, audioAndVoice]), maxCapPromise]).then(() => {
      if (alive) finishCurrent();
    });

    return () => {
      alive = false;
      cancelVoiceAnnouncement(ownerToken);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the ceremony length is fixed when it starts
  }, [current, paused, settings.celebrationDuration, finishCurrent]);

  if (!current) return null;
  if (current.tier === "weekly-top") return <WeeklyTopCelebration key={current.id} event={current} motion={weeklyTopMotion} />;
  if (current.tier === "weekly-top-team") return <WeeklyTopTeamCelebration key={current.id} event={current} motion={weeklyTopMotion} />;

  const meta = TIERS[current.tier] || TIERS.sale;
  const isSale = current.tier === "sale";
  const isFullScreen = isSale || meta.fullscreen;
  const banner = !isFullScreen && settings.saleCelebrationStyle === "banner";
  const defaultSaleHeading = isChristmas ? "CHRISTMAS SALE APPROVED!" : "NEW SALE APPROVED!";
  const saleTopHeading =
    current.headline &&
    current.headline !== "SALE VALIDATED!" &&
    current.headline !== "Approved Sale" &&
    !(isChristmas && current.headline === "NEW SALE APPROVED!")
      ? current.headline
      : defaultSaleHeading;
  const salePillText =
    current.headline &&
    current.headline.toUpperCase() !== "NEW SALE APPROVED!" &&
    current.headline.toUpperCase() !== "CHRISTMAS SALE APPROVED!"
      ? current.headline
      : isChristmas
      ? "Holiday Approved Sale"
      : meta.label;

  return (
    <>
      {/* Particle explosion */}
      <ConfettiCanvas active={!!current} tier={current.tier} />

      {/* Fullscreen backdrop for sale and highest tiers */}
      {isFullScreen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0.15 : 0.28 }}
            className={
              lite
                ? "fixed inset-0 z-40 bg-[#03050C]/90 pointer-events-auto"
                : "fixed inset-0 z-40 bg-[#03050C]/80 backdrop-blur-md pointer-events-auto"
            }
            data-lite={lite || undefined}
          />
          {isSale && !reducedMotion && !lite && (
            <div
              className="reveal-rays pointer-events-none fixed left-1/2 top-1/2 z-40 h-[150vmax] w-[150vmax] -translate-x-1/2 -translate-y-1/2 opacity-45"
              aria-hidden
            />
          )}
          {isSale && (
            <div
              className="pointer-events-none fixed left-1/2 top-1/2 z-40 h-[58vmin] w-[58vmin] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-45"
              style={{
                background:
                  "radial-gradient(circle, rgba(255, 200, 87, 0.42) 0%, rgba(117, 104, 255, 0.24) 45%, transparent 70%)",
              }}
              aria-hidden
            />
          )}
        </>
      )}

      {/* Celebration Card / Banner */}
      <div
        className={`fixed z-50 transition-all ${
          isFullScreen
            ? "inset-0 grid place-items-center p-4 pointer-events-auto"
            : banner
            ? "top-20 left-1/2 -translate-x-1/2 max-w-2xl w-[calc(100%-2rem)] pointer-events-auto"
            : "bottom-16 left-6 max-w-md w-[calc(100%-3rem)] pointer-events-auto"
        }`}
      >
        <AnimatePresence mode="wait">
          {isSale ? (
            <motion.div
              key={current.id}
              role="dialog"
              aria-modal="true"
              aria-label={`${saleTopHeading} ${current.agentName ?? ""}`}
              data-testid="sale-celebration-popup"
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.78, y: 28 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: -16 }}
              transition={{ type: "spring", stiffness: 250, damping: 22 }}
              className={`sale-celeb-card relative w-full max-w-2xl overflow-hidden rounded-[28px] border px-6 pb-7 pt-7 text-center shadow-2xl sm:px-10 ${
                isChristmas
                  ? "border-[#D8AF58]/60 bg-gradient-to-b from-[#3A0C18] via-[#143329] to-[#12060B]"
                  : "border-[#FFC857]/45 bg-gradient-to-b from-[#16123A] via-[#0E1430] to-[#0A0F22]"
              }`}
              style={{
                boxShadow: lite
                  ? "0 24px 60px -15px rgba(0, 0, 0, 0.85)"
                  : isChristmas
                  ? "0 0 95px -12px rgba(216, 175, 88, 0.55), 0 0 50px -10px rgba(166, 31, 50, 0.5), inset 0 1px 0 rgba(255, 248, 238, 0.25)"
                  : "0 0 90px -12px rgba(255, 200, 87, 0.45), 0 0 45px -10px rgba(117, 104, 255, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.12)",
              }}
            >
              {/* Top golden edge highlight */}
              <div
                className="pointer-events-none absolute inset-x-[15%] top-0 h-[2px] bg-gradient-to-r from-transparent via-[#FFC857] to-transparent opacity-90"
                aria-hidden
              />

              {/* Controls Bar */}
              <div hidden={!!previewEvent} className="absolute top-3.5 right-3.5 flex items-center gap-1.5 z-20">
                <button
                  onClick={previewEvent ? undefined : paused ? resume : pause}
                  title={paused ? "Resume celebration" : "Pause celebration"}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-muted hover:text-white transition-colors"
                >
                  {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={previewEvent ? undefined : skip}
                  title="Skip this celebration"
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-muted hover:text-white transition-colors"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={previewEvent ? undefined : finishCurrent}
                  title="Dismiss"
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-muted hover:text-white transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Status Kicker Pill */}
              <div className="relative z-10 flex items-center justify-center gap-2">
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#FFC857]/50 bg-[#FFC857]/12 px-3.5 py-1 text-xs font-bold uppercase tracking-[0.24em] text-[#FFC857]"
                >
                  <Sparkles className="h-3.5 w-3.5 text-[#FFC857]" />
                  <span>{salePillText}</span>
                </span>
                {queue.length > 0 && (
                  <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-mono text-text-secondary">
                    +{queue.length} in queue
                  </span>
                )}
              </div>

              {/* Top Heading */}
              <h2
                data-testid="sale-celebration-heading"
                className="sale-celeb-heading relative z-10 mt-3 font-heading text-3xl font-extrabold tracking-tight text-white sm:text-4xl lg:text-[2.6rem]"
                style={{ textShadow: "0 4px 24px rgba(0, 0, 0, 0.75)" }}
              >
                {saleTopHeading}
              </h2>

              {/* Main Visual: Large Agent Emoji with Soft Radial Illumination */}
              <div className="sale-celeb-stage relative z-10 mx-auto my-3 flex items-center justify-center">
                <div
                  className="pointer-events-none absolute left-1/2 top-1/2 h-[clamp(190px,30vh,340px)] w-[clamp(190px,30vh,340px)] -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{
                    background:
                      "radial-gradient(circle, rgba(255, 200, 87, 0.36) 0%, rgba(117, 104, 255, 0.22) 48%, transparent 72%)",
                  }}
                  aria-hidden
                />
                <AgentEmoji
                  key={current.id}
                  agentId={current.agentId}
                  name={current.agentName ?? "Agent"}
                  className="sale-celeb-emoji relative z-10 mx-auto h-[clamp(160px,27vh,300px)] w-auto max-w-[min(80vw,340px)] object-contain drop-shadow-[0_18px_32px_rgba(0,0,0,0.75)]"
                  fallback={
                    <div
                      className="relative z-10 mx-auto my-3 flex h-28 w-28 items-center justify-center rounded-3xl border border-[#FFC857]/55 bg-gradient-to-br from-[#FFC857]/30 to-[#7568FF]/15 text-[#FFC857] shadow-[0_0_45px_-8px_rgba(255,200,87,0.55)]"
                      data-testid="sale-celebration-fallback"
                    >
                      <CheckCircle2 className="h-14 w-14 drop-shadow-[0_0_14px_rgba(255,200,87,0.65)]" />
                    </div>
                  }
                />
              </div>

              {/* Agent Name */}
              {current.agentName && (
                <motion.h3
                  data-testid="sale-celebration-agent"
                  initial={reducedMotion || lite ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.32, delay: 0.08 }}
                  className="sale-celeb-agent relative z-10 mt-1 font-heading text-2xl font-black uppercase tracking-[0.04em] text-white sm:text-4xl"
                  style={{ textShadow: "0 2px 24px rgba(255, 200, 87, 0.35)" }}
                >
                  {current.agentName}
                </motion.h3>
              )}

              {/* Supporting Text */}
              <motion.div
                initial={reducedMotion || lite ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.32, delay: 0.14 }}
                className="relative z-10 mt-1.5"
              >
                <p
                  data-testid="sale-celebration-support"
                  className="font-heading text-lg font-bold text-[#FFC857] sm:text-2xl"
                  style={{ textShadow: "0 0 20px rgba(255, 200, 87, 0.35)" }}
                >
                  Just made a sale!
                </p>
                {isChristmas && (
                  <p
                    data-testid="sale-celebration-christmas-sub"
                    className="mt-1 font-heading text-sm font-semibold text-[#FFF8EE]/90 sm:text-base"
                  >
                    🎄 Another win this holiday season!
                  </p>
                )}
                {current.subline && current.subline !== "Just made a sale!" && (
                  <p className="mt-1 text-xs font-medium text-secondary sm:text-sm">
                    {current.subline}
                  </p>
                )}
              </motion.div>

              {/* Team & Preview Badges */}
              {(current.teamName || current.preview) && (
                <div className="relative z-10 mt-3.5 flex flex-wrap items-center justify-center gap-2 text-xs sm:text-sm">
                  {current.teamName && (
                    <span
                      className="rounded-full border px-3.5 py-1 font-semibold"
                      style={{
                        borderColor: `${current.teamColor || "#FFC857"}45`,
                        backgroundColor: `${current.teamColor || "#FFC857"}18`,
                        color: current.teamColor || "#FFC857",
                      }}
                    >
                      {current.teamName}
                    </span>
                  )}
                  {current.preview && (
                    <span
                      className="rounded-full border border-amber-300/50 bg-amber-400/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-amber-200"
                      data-testid="sale-celebration-preview-badge"
                    >
                      Preview · not a real sale
                    </span>
                  )}
                </div>
              )}

              {/* Bonus-style Progress Bar */}
              <div className="relative z-10 mx-auto mt-5 h-1.5 w-56 overflow-hidden rounded-full bg-white/10">
                <motion.div
                  className="h-full origin-left rounded-full"
                  style={{ background: "linear-gradient(90deg, #FFC857, #36E0B5)" }}
                  initial={{ scaleX: 1 }}
                  animate={{ scaleX: 0 }}
                  transition={{
                    duration: saleCelebrationDurationMs(settings.celebrationDuration) / 1000,
                    ease: "linear",
                  }}
                />
              </div>
            </motion.div>
          ) : (
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
              <div hidden={!!previewEvent} className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
                <button
                  onClick={previewEvent ? undefined : paused ? resume : pause}
                  title={paused ? "Resume celebration" : "Pause celebration"}
                  className="p-1.5 rounded-lg bg-surface hover:bg-surface-hover text-muted hover:text-white transition-colors"
                >
                  {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={previewEvent ? undefined : skip}
                  title="Skip this celebration"
                  className="p-1.5 rounded-lg bg-surface hover:bg-surface-hover text-muted hover:text-white transition-colors"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={previewEvent ? undefined : finishCurrent}
                  title="Dismiss"
                  className="p-1.5 rounded-lg bg-surface hover:bg-surface-hover text-muted hover:text-white transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Content Area */}
              <div className={`relative z-10 flex ${isFullScreen ? "flex-col items-center" : "items-center gap-4"}`}>
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
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
