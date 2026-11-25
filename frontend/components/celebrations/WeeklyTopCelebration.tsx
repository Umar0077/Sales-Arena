"use client";

import { Crown } from "lucide-react";
import { useReducedMotion } from "@/frontend/performance/reduced-motion";
import { useLiteDisplay } from "@/frontend/performance/lite";
import { useArenaTheme } from "@/frontend/theme/arena-theme";
import { AgentEmoji } from "./AgentEmoji";
import { ConfettiCanvas } from "./ConfettiCanvas";
import type { CelebrationEvent } from "@/shared/types";

/** Ceremony length (ms): full, Lite (lighter motion), reduced motion (still composition). */
export const WEEKLY_TOP_MS = { full: 9500, lite: 8500, static: 7500 } as const;
export type WeeklyTopMotion = keyof typeof WEEKLY_TOP_MS;

export function useWeeklyTopMotion(): WeeklyTopMotion {
  const reduced = useReducedMotion();
  const lite = useLiteDisplay();
  return reduced ? "static" : lite ? "lite" : "full";
}

/**
 * Weekly Top Performer ceremony (Admin-triggered recognition, presentation only). Played by the existing
 * celebration queue (CelebrationOverlay) as the "weekly-top" tier: spotlighting the winner's uploaded
 * emoji (or Crown medal fallback), team name, and weekly validated sales count.
 */
export function WeeklyTopCelebration({ event, motion }: { event: CelebrationEvent; motion: WeeklyTopMotion }) {
  const { isChristmas, theme: arenaTheme } = useArenaTheme();
  const sales = Math.max(0, event.value ?? 0);
  const dur = WEEKLY_TOP_MS[motion];
  const agentName = event.agentName ?? "Weekly Champion";

  const crownFallback = (
    <div className="wtp-medal relative grid place-items-center" data-testid="weekly-top-fallback-medal" aria-hidden>
      <div className="wtp-ring absolute inset-0 rounded-full" />
      <div className="wtp-ring wtp-ring-2 absolute inset-0 rounded-full" />
      <div className="relative grid h-full w-full place-items-center rounded-full border-2 border-[#FFD978]/80 bg-[radial-gradient(circle_at_50%_35%,#3A2A0A,#120C02_75%)] shadow-[0_0_60px_-6px_#F5C451]">
        <Crown className="h-[46%] w-[46%] text-[#FFD978] drop-shadow-[0_0_18px_rgba(255,200,87,0.9)]" />
      </div>
    </div>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Congratulations! This week's top performer: ${agentName}, ${sales} approved sales.`}
      data-testid="weekly-top-celebration"
      data-arena-theme={arenaTheme}
      data-motion={motion}
      data-case={event.id}
      className={`wtp-root wtp-${motion} pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-hidden px-4`}
      style={{ ["--wtp-dur" as string]: `${dur}ms` }}
    >
      <div className="wtp-backdrop absolute inset-0" />
      {motion === "full" && <div className="wtp-rays absolute left-1/2 top-1/2" aria-hidden />}
      {motion === "full" && (
        <>
          <div className="wtp-beam wtp-beam-l absolute bottom-0 left-[8%]" aria-hidden />
          <div className="wtp-beam wtp-beam-r absolute bottom-0 right-[8%]" aria-hidden />
        </>
      )}
      {motion !== "static" && <ConfettiCanvas active tier="weekly-top" />}

      <div className="relative flex w-full max-w-[min(1400px,94vw)] flex-col items-center text-center">
        {/* Prominent Spotlight Visual: Uploaded Agent Emoji or Golden Crown Medal Fallback */}
        <div className="wtp-spotlight relative flex items-center justify-center">
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 h-[clamp(170px,30vh,340px)] w-[clamp(170px,30vh,340px)] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-75"
            style={{
              background: isChristmas
                ? "radial-gradient(circle, rgba(216,175,88,0.42) 0%, rgba(166,31,50,0.28) 48%, transparent 72%)"
                : "radial-gradient(circle, rgba(255,217,120,0.42) 0%, rgba(117,104,255,0.24) 48%, transparent 72%)",
            }}
            aria-hidden
          />
          <AgentEmoji
            key={`${event.id}:${event.agentId ?? agentName}`}
            agentId={event.agentId}
            name={agentName}
            className="wtp-agent-emoji relative z-10 h-[clamp(140px,26vh,280px)] w-auto max-w-[min(70vw,320px)] object-contain drop-shadow-[0_18px_36px_rgba(0,0,0,0.85)]"
            fallback={crownFallback}
          />
        </div>

        <h2 className="wtp-headline relative mt-[1.6vh] font-heading font-black uppercase" data-testid="weekly-top-headline">
          <span className="wtp-headline-text">CONGRATULATIONS!</span>
          {motion === "full" && (
            <span className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
              <span className="wtp-sweep absolute inset-0" />
            </span>
          )}
        </h2>
        <div className="wtp-rule" aria-hidden />
        <p className="wtp-kicker font-semibold uppercase text-[#FFE7A6]" data-testid="weekly-top-kicker">
          {isChristmas ? "🎄 THIS WEEK'S TOP PERFORMER" : "THIS WEEK'S TOP PERFORMER"}
        </p>
        <p className="wtp-name mt-[1vh] max-w-[92vw] break-words font-heading font-extrabold text-white" data-testid="weekly-top-name">
          {agentName}
        </p>

        <div className="wtp-chip mt-[1.6vh] flex flex-wrap items-center justify-center gap-3">
          {event.teamName && (
            <span
              data-testid="weekly-top-team"
              className="inline-flex items-center gap-2 rounded-full border px-4 py-1.5 font-heading text-[clamp(12px,1.5vh,18px)] font-bold uppercase tracking-[0.14em]"
              style={{
                borderColor: `${event.teamColor || "#F5C451"}77`,
                background: `${event.teamColor || "#F5C451"}22`,
                color: event.teamColor || "#FFE7A6",
              }}
            >
              {event.teamName}
            </span>
          )}
          <div
            className="inline-flex items-baseline gap-3 rounded-full border border-[#FFD978]/60 bg-[#120C02]/80 px-6 py-2 shadow-[0_0_40px_-8px_#F5C451]"
            data-testid="weekly-top-sales"
          >
            <span className="font-heading text-[clamp(22px,min(3vw,4.8vh),56px)] font-black tabular-nums text-[#FFD978]">
              {sales}
            </span>
            <span className="text-[clamp(11px,min(1.2vw,1.9vh),20px)] font-semibold uppercase tracking-[0.18em] text-white">
              approved sale{sales === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        {event.subline && (
          <p className="wtp-week mt-[1.2vh] text-[clamp(12px,1.6vh,18px)] text-text-secondary" data-testid="weekly-top-week">
            {event.subline}
          </p>
        )}
      </div>
    </div>
  );
}
