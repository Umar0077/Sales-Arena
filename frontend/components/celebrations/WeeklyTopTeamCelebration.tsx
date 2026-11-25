"use client";

import { useState } from "react";
import { Trophy } from "lucide-react";
import { useArenaTheme } from "@/frontend/theme/arena-theme";
import { AgentEmoji } from "./AgentEmoji";
import { ConfettiCanvas } from "./ConfettiCanvas";
import { WEEKLY_TOP_MS, type WeeklyTopMotion } from "./WeeklyTopCelebration";
import type { CelebrationEvent } from "@/shared/types";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "FE";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Weekly Top Team Performers celebration (Admin-triggered squad recognition).
 * Displays the winning team's logo at the top, team name + "THIS WEEK'S TOP PERFORMERS",
 * and a balanced TV-friendly grid of all winning team members' emojis & names.
 */
export function WeeklyTopTeamCelebration({
  event,
  motion,
}: {
  event: CelebrationEvent;
  motion: WeeklyTopMotion;
}) {
  const { isChristmas, theme: arenaTheme } = useArenaTheme();
  const [logoBroken, setLogoBroken] = useState(false);
  const dur = WEEKLY_TOP_MS[motion];
  const teamName = event.teamName ?? "Winning Team";
  const teamColor = event.teamColor || "#F5C451";
  const sales = Math.max(0, event.value ?? 0);
  const members = event.teamMembers ?? [];

  const compactGrid = members.length > 6;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${teamName} — This Week's Top Performers! ${sales} approved sales.`}
      data-testid="weekly-top-team-celebration"
      data-arena-theme={arenaTheme}
      data-motion={motion}
      data-case={event.id}
      className={`wtp-root wtt-root wtp-${motion} pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-hidden px-4 py-4`}
      style={{ ["--wtp-dur" as string]: `${dur}ms`, ["--wtt-accent" as string]: teamColor }}
    >
      <div className="wtp-backdrop absolute inset-0" />
      {motion === "full" && <div className="wtp-rays absolute left-1/2 top-1/2" aria-hidden />}
      {motion !== "static" && <ConfettiCanvas active tier="weekly-top-team" />}

      <div className="relative flex w-full max-w-[min(1440px,94vw)] flex-col items-center text-center">
        {/* Top Winning Team Logo */}
        <div className="wtt-logo-wrap relative flex items-center justify-center">
          <div
            className="pointer-events-none absolute inset-[-20%] rounded-full blur-2xl opacity-60"
            style={{ background: `radial-gradient(circle, ${teamColor}, transparent 70%)` }}
            aria-hidden
          />
          {event.teamLogoUrl && !logoBroken ? (
            // eslint-disable-next-line @next/next/no-img-element -- official team crest/logo
            <img
              src={event.teamLogoUrl}
              alt={`${teamName} logo`}
              onError={() => setLogoBroken(true)}
              data-testid="weekly-top-team-logo"
              className="wtt-logo relative z-10 h-[clamp(64px,11vh,124px)] w-auto object-contain drop-shadow-[0_12px_28px_rgba(0,0,0,0.8)]"
              draggable={false}
            />
          ) : (
            <div
              data-testid="weekly-top-team-logo"
              className="wtt-logo relative z-10 grid h-[clamp(64px,11vh,118px)] w-[clamp(64px,11vh,118px)] place-items-center rounded-2xl border-2 font-heading text-2xl font-black text-white shadow-2xl"
              style={{
                borderColor: `${teamColor}AA`,
                background: `radial-gradient(circle at 35% 30%, ${teamColor}66, #0B1022 80%)`,
              }}
            >
              {initials(teamName.replace(/^team\s+/i, ""))}
            </div>
          )}
        </div>

        {/* Team Title & Headline */}
        <p
          className="wtt-kicker mt-[1.2vh] inline-flex items-center gap-2 rounded-full border px-4 py-1 text-[clamp(10px,1.4vh,15px)] font-extrabold uppercase tracking-[0.28em]"
          style={{
            borderColor: `${teamColor}66`,
            background: `${teamColor}1A`,
            color: "#FFE7A6",
          }}
        >
          <Trophy className="h-3.5 w-3.5 text-[#FFD978]" />
          {isChristmas ? "🎄 WEEKLY TOP TEAM PERFORMERS" : "WEEKLY TOP TEAM PERFORMERS"}
        </p>

        <h2
          className="wtt-headline mt-[1vh] font-heading text-[clamp(26px,min(4.6vw,6.8vh),80px)] font-black uppercase leading-tight tracking-wide text-white"
          data-testid="weekly-top-team-headline"
          style={{ textShadow: `0 4px 28px rgba(0,0,0,0.85), 0 0 36px ${teamColor}55` }}
        >
          {teamName} — This Week&apos;s Top Performers
        </h2>

        <div className="mt-[0.8vh] flex flex-wrap items-center justify-center gap-2">
          <div
            data-testid="weekly-top-team-sales"
            className="inline-flex items-baseline gap-2 rounded-full border border-[#FFD978]/60 bg-[#120C02]/80 px-5 py-1.5 shadow-[0_0_32px_-8px_#F5C451]"
          >
            <span className="font-heading text-[clamp(18px,2.8vh,34px)] font-black tabular-nums text-[#FFD978]">
              {sales}
            </span>
            <span className="text-[clamp(10px,1.4vh,15px)] font-semibold uppercase tracking-[0.16em] text-white">
              team approved sale{sales === 1 ? "" : "s"}
            </span>
          </div>
          {event.subline && (
            <span className="rounded-full border border-white/15 bg-white/5 px-3.5 py-1 text-[clamp(10px,1.4vh,14px)] text-text-secondary">
              {event.subline}
            </span>
          )}
        </div>

        {/* Squad Grid of All Winning Team Member Emojis */}
        {members.length > 0 && (
          <div
            data-testid="weekly-top-team-members"
            className={`wtt-members-grid mt-[2.2vh] grid w-full max-w-[min(1260px,92vw)] justify-center gap-3 sm:gap-4 ${
              compactGrid
                ? "grid-cols-3 sm:grid-cols-4 md:grid-cols-5"
                : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
            }`}
          >
            {members.map((member) => (
              <div
                key={member.userCode || member.name}
                data-testid="weekly-top-team-member"
                className="wtt-member-card flex flex-col items-center rounded-2xl border border-white/15 bg-black/35 px-2.5 py-3 backdrop-blur-md"
                style={{ boxShadow: `0 12px 32px -12px rgba(0,0,0,0.8), inset 0 1px 0 ${teamColor}33` }}
              >
                <div className="flex h-[clamp(64px,13vh,148px)] w-full items-center justify-center">
                  <AgentEmoji
                    agentId={member.userCode}
                    name={member.name}
                    className="wtt-member-emoji h-full w-auto max-w-full object-contain drop-shadow-[0_10px_18px_rgba(0,0,0,0.75)]"
                    fallback={
                      <div
                        className="grid h-[clamp(56px,10vh,104px)] w-[clamp(56px,10vh,104px)] place-items-center rounded-full border-2 font-heading text-lg font-extrabold text-white"
                        style={{
                          borderColor: `${teamColor}88`,
                          background: `radial-gradient(circle at 35% 30%, ${teamColor}44, #0F172A 80%)`,
                        }}
                      >
                        {initials(member.name)}
                      </div>
                    }
                  />
                </div>
                <p className="wtt-member-name mt-1.5 line-clamp-1 font-heading text-[clamp(11px,1.6vh,17px)] font-extrabold text-white">
                  {member.name}
                </p>
                {typeof member.validated === "number" && (
                  <p className="text-[clamp(9px,1.2vh,13px)] font-semibold text-[#FFE7A6]/90 tabular-nums">
                    {member.validated} sale{member.validated === 1 ? "" : "s"}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
