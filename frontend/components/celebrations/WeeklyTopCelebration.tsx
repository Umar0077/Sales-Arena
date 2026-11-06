"use client";

import { Crown } from "lucide-react";
import { useReducedMotion } from "@/frontend/performance/reduced-motion";
import { useLiteDisplay } from "@/frontend/performance/lite";
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
 * celebration queue (CelebrationOverlay) as the "weekly-top" tier: it waits for any sale card, bonus popup, team
 * celebration or spin on screen, and ends on its own after WEEKLY_TOP_MS (it fades itself out in its last 0.7 s).
 * Golden confetti (fewer particles in Lite, none with reduced motion), cinematic light rays and beams (full motion
 * only), transform / opacity animations only; reduced motion shows the still composition.
 */
export function WeeklyTopCelebration({ event, motion }: { event: CelebrationEvent; motion: WeeklyTopMotion }) {
  const sales = Math.max(0, Math.round(event.value ?? 0));
  const dur = WEEKLY_TOP_MS[motion];
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Congratulations! This week's top performer: ${event.agentName}, ${sales} approved sales.`}
      data-testid="weekly-top-celebration"
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
        <div className="wtp-medal relative grid place-items-center" aria-hidden>
          <div className="wtp-ring absolute inset-0 rounded-full" />
          <div className="wtp-ring wtp-ring-2 absolute inset-0 rounded-full" />
          <div className="relative grid h-full w-full place-items-center rounded-full border-2 border-[#FFD978]/80 bg-[radial-gradient(circle_at_50%_35%,#3A2A0A,#120C02_75%)] shadow-[0_0_60px_-6px_#F5C451]">
            <Crown className="h-[46%] w-[46%] text-[#FFD978] drop-shadow-[0_0_18px_rgba(255,200,87,0.9)]" />
          </div>
        </div>

        <h2 className="wtp-headline relative mt-[3vh] font-heading font-black uppercase" data-testid="weekly-top-headline">
          <span className="wtp-headline-text">CONGRATULATIONS!</span>
          {motion === "full" && (
            <span className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
              <span className="wtp-sweep absolute inset-0" />
            </span>
          )}
        </h2>
        <div className="wtp-rule" aria-hidden />
        <p className="wtp-kicker font-semibold uppercase text-[#FFE7A6]" data-testid="weekly-top-kicker">
          THIS WEEK&apos;S TOP PERFORMER
        </p>
        <p className="wtp-name mt-[1.2vh] max-w-[92vw] break-words font-heading font-extrabold text-white" data-testid="weekly-top-name">
          {event.agentName}
        </p>
        <div className="wtp-chip mt-[2vh] inline-flex items-baseline gap-3 rounded-full border border-[#FFD978]/60 bg-[#120C02]/80 px-7 py-2.5 shadow-[0_0_40px_-8px_#F5C451]" data-testid="weekly-top-sales">
          <span className="font-heading font-black tabular-nums text-[#FFD978]">{sales}</span>
          <span className="font-semibold uppercase tracking-[0.18em] text-white">approved sale{sales === 1 ? "" : "s"}</span>
        </div>
        {event.subline && (
          <p className="wtp-week mt-[1.6vh] text-[clamp(13px,1.8vh,20px)] text-text-secondary" data-testid="weekly-top-week">
            {event.subline}
          </p>
        )}
      </div>
    </div>
  );
}
