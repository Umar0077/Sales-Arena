"use client";

import { useState } from "react";
import { Play, Sparkles, Trophy, Disc3, Shield, PartyPopper } from "lucide-react";
import { ArenaThemeScope } from "@/frontend/theme/arena-theme";
import { ChristmasSnowfall } from "@/frontend/components/theme/ChristmasSnowfall";
import { CelebrationOverlay } from "@/frontend/components/celebrations/CelebrationOverlay";
import { CubStage } from "@/frontend/components/cub/CubStage";
import type { CubPose } from "@/frontend/cub/machine";
import { audioEngine } from "@/frontend/audio/engine";
import { playCubSoundPreview } from "@/frontend/cub/sounds";
import { playTeamStinger } from "@/frontend/audio/team-stingers";
import { playCelebrationSound } from "@/frontend/audio/celebration-sounds";
import type {
  ArenaThemeId,
  SnowfallIntensity,
  VisualIntensity,
  CelebrationEvent,
} from "@/shared/types";
import { cn } from "@/shared/utils";

export type PreviewArenaScreen =
  | "daily"
  | "weekly"
  | "monthly"
  | "teams"
  | "spin"
  | "celebration";

const SCREEN_TABS: Array<{ id: PreviewArenaScreen; label: string }> = [
  { id: "daily", label: "Daily Arena" },
  { id: "weekly", label: "Weekly Arena" },
  { id: "monthly", label: "Monthly Arena" },
  { id: "teams", label: "Teams Arena" },
  { id: "spin", label: "Spin & Win" },
  { id: "celebration", label: "Sale Celebration" },
];

const SAMPLE_LEADERS = [
  { rank: 1, name: "Mansoor Arshad", code: "CLS-FDBC4C55", submitted: 5, validated: 4, credited: "3.5" },
  { rank: 2, name: "Hamna Nasir", code: "CLS-536D6AA1", submitted: 4, validated: 3, credited: "3.0" },
  { rank: 3, name: "Rohan Ali", code: "CLS-FF485B25", submitted: 3, validated: 3, credited: "2.5" },
];

const SAMPLE_CELEBRATION_EVENT: CelebrationEvent = {
  id: "preview_theme_sale",
  tier: "sale",
  headline: "NEW SALE APPROVED!",
  subline: "Just made a sale!",
  agentId: null,
  agentName: "Mansoor Arshad",
  teamName: "Team Sigma",
  teamColor: "#F5C451",
  value: 128,
  createdAt: "2026-12-25T12:00:00.000Z",
  preview: true,
};

export interface ThemeTvPreviewProps {
  theme: ArenaThemeId;
  snowfall: SnowfallIntensity;
  christmasSounds: boolean;
  christmasSantaCub: boolean;
  effectsIntensity: VisualIntensity;
}

export function ThemeTvPreview({
  theme,
  snowfall,
  christmasSounds,
  christmasSantaCub,
  effectsIntensity,
}: ThemeTvPreviewProps) {
  const [screen, setScreen] = useState<PreviewArenaScreen>("daily");
  const [cubPose, setCubPose] = useState<CubPose>("wave");
  const [cubPlayKey, setCubPlayKey] = useState(1);
  const isChristmas = theme === "christmas";
  const useChristmasAudio = isChristmas && christmasSounds;

  const triggerCubPose = (pose: CubPose) => {
    setCubPose(pose);
    setCubPlayKey((k) => k + 1);
    if (pose === "bonus") {
      playCubSoundPreview(useChristmasAudio ? "hohoho" : "bonus", useChristmasAudio);
    } else if (pose === "dance") {
      playCubSoundPreview(useChristmasAudio ? "jingle" : "intro", useChristmasAudio);
    } else if (pose === "feeding") {
      playCubSoundPreview("feeding", useChristmasAudio);
    } else {
      playCubSoundPreview(useChristmasAudio ? "chime" : "intro", useChristmasAudio);
    }
  };

  const previewSound = (kind: "sale" | "bonus" | "team" | "hohoho" | "sleigh") => {
    audioEngine.unlock();
    if (kind === "sale") {
      audioEngine.playThemePreview("sale", useChristmasAudio ? "christmas" : "normal");
    } else if (kind === "bonus") {
      if (useChristmasAudio) {
        audioEngine.playThemePreview("target", "christmas");
      } else {
        playCelebrationSound("bonus", { allowed: true });
      }
    } else if (kind === "team") {
      playTeamStinger("lion", {
        soundEnabled: true,
        saleCategory: true,
        teamSaleSound: true,
        forceChristmas: useChristmasAudio,
      });
    } else if (kind === "hohoho") {
      playCubSoundPreview("hohoho", true);
    } else if (kind === "sleigh") {
      playCubSoundPreview("jingle", true);
    }
  };

  return (
    <div className="space-y-4" data-testid="theme-tv-preview">
      {/* Screen Mode Selector + Local Mascot Action Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex flex-wrap gap-1 rounded-xl border border-white/10 bg-[#070B16]/80 p-1" role="tablist" aria-label="Preview Arena screen">
          {SCREEN_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={screen === tab.id}
              data-testid={`preview-tab-${tab.id}`}
              onClick={() => setScreen(tab.id)}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors",
                screen === tab.id
                  ? "bg-primary text-white shadow"
                  : "text-text-secondary hover:bg-white/5 hover:text-white",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Mascot Action:
          </span>
          {(
            [
              ["wave", "Wave"],
              ["dance", "Dance"],
              ["bonus", "Celebrate"],
              ["jump", "Jump"],
              ["feeding", "Eat Token"],
            ] as Array<[CubPose, string]>
          ).map(([pose, label]) => (
            <button
              key={pose}
              type="button"
              data-testid={`preview-cub-${pose}`}
              onClick={() => triggerCubPose(pose)}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors",
                cubPose === pose
                  ? "border-secondary/60 bg-secondary/15 text-secondary"
                  : "border-white/10 bg-white/[0.04] text-text-secondary hover:bg-white/[0.08] hover:text-white",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 16:9 TV Monitor Frame */}
      <div
        data-preview-stage="true"
        data-testid="theme-tv-monitor"
        className="relative aspect-video w-full overflow-hidden rounded-2xl border-2 border-white/15 bg-[#050814] shadow-[0_24px_70px_-15px_rgba(0,0,0,0.85)]"
      >
        <ArenaThemeScope
          theme={theme}
          snowfall={snowfall}
          christmasSounds={christmasSounds}
          christmasSantaCub={christmasSantaCub}
          effectsIntensity={effectsIntensity}
          preview
          className="arena-backdrop relative flex h-full w-full flex-col justify-between overflow-hidden p-4 sm:p-5"
        >
          <ChristmasSnowfall contained />

          {/* Simulated Broadcast Header */}
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-3.5 py-2 backdrop-blur-md">
            <div className="flex items-center gap-2.5">
              <div className="grid h-8 w-8 place-items-center rounded-lg border border-white/15 bg-white/5 font-heading text-xs font-black text-white">
                FE
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-heading text-xs font-extrabold tracking-wide text-white sm:text-sm">
                    FE SALES ARENA
                  </span>
                  {isChristmas && (
                    <span
                      data-testid="preview-christmas-badge"
                      className="inline-flex items-center gap-1 rounded-full border border-[#D8AF58]/60 bg-gradient-to-r from-[#8B1A2B]/85 via-[#5E1220]/90 to-[#1E4D3B]/85 px-2 py-0.5 font-heading text-[9px] font-extrabold uppercase tracking-[0.16em] text-[#F5D68E]"
                    >
                      🎄 CHRISTMAS EDITION
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-text-muted">
                  16:9 Broadcast Preview · {isChristmas ? "Christmas Theme" : "Normal Arena Theme"} (Draft Only)
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-0.5 text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                PREVIEW MODE
              </span>
            </div>
          </div>

          {/* Main Broadcast Body */}
          <div className="relative z-10 my-auto grid grid-cols-1 gap-3 py-2 lg:grid-cols-[1fr_210px]">
            {screen === "celebration" ? (
              <div className="relative min-h-[230px] overflow-hidden rounded-2xl border border-white/10 bg-black/25">
                <CelebrationOverlay previewEvent={SAMPLE_CELEBRATION_EVENT} />
              </div>
            ) : screen === "teams" ? (
              <div className="grid grid-cols-3 items-center gap-2.5">
                <div className="ac-panel rounded-2xl border p-3 text-center">
                  <div className="mx-auto mb-1.5 grid h-10 w-10 place-items-center rounded-xl border border-amber-300/40 bg-amber-400/15 font-heading text-sm font-black text-amber-200">
                    TS
                  </div>
                  <p className="font-heading text-xs font-extrabold uppercase tracking-wider text-white">
                    Team Sigma
                  </p>
                  <p className="mt-1 font-heading text-2xl font-black text-[#F5C451] tabular-nums">
                    18.5
                  </p>
                  <p className="text-[10px] text-text-muted">21 Validated Sales</p>
                </div>

                <div className="flex flex-col items-center justify-center text-center">
                  <div className="teams-vs-badge grid h-12 w-12 place-items-center rounded-full border border-white/20 bg-white/5 font-heading text-sm font-black text-white">
                    VS
                  </div>
                  <span className="mt-1.5 text-[10px] font-bold uppercase tracking-widest text-text-secondary">
                    {isChristmas ? "🎄 Holiday Clash" : "Live Battle"}
                  </span>
                </div>

                <div className="ac-panel rounded-2xl border p-3 text-center">
                  <div className="mx-auto mb-1.5 grid h-10 w-10 place-items-center rounded-xl border border-cyan-300/40 bg-cyan-400/15 font-heading text-sm font-black text-cyan-200">
                    TP
                  </div>
                  <p className="font-heading text-xs font-extrabold uppercase tracking-wider text-white">
                    Team Panthers
                  </p>
                  <p className="mt-1 font-heading text-2xl font-black text-secondary tabular-nums">
                    17.0
                  </p>
                  <p className="text-[10px] text-text-muted">19 Validated Sales</p>
                </div>
              </div>
            ) : screen === "spin" ? (
              <div className="ac-panel flex flex-col items-center justify-center rounded-2xl border p-4 text-center">
                <div
                  className={cn(
                    "grid h-24 w-24 place-items-center rounded-full border-4 shadow-lg",
                    isChristmas
                      ? "border-[#D8AF58] bg-gradient-to-br from-[#A61F32] via-[#173D32] to-[#3A0C18] shadow-[#D8AF58]/30"
                      : "border-primary/70 bg-gradient-to-br from-primary/40 via-secondary/20 to-[#0B1024] shadow-primary/30",
                  )}
                >
                  <Disc3 className="h-12 w-12 animate-spin text-white [animation-duration:9s]" />
                </div>
                <p className="mt-2.5 font-heading text-sm font-extrabold uppercase tracking-wider text-white">
                  {isChristmas ? "🎄 Holiday Spin & Win Stage" : "3D Spin & Win Stage"}
                </p>
                <p className="text-xs text-text-secondary">
                  3 Spins Unlocked · Weighted Target Progress Active
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {/* KPI Cards Row */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="ac-kpi rounded-xl border p-2.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                      {screen === "daily" ? "Today Validated" : screen === "weekly" ? "Weekly Validated" : "Monthly Validated"}
                    </span>
                    <p className="mt-0.5 font-heading text-xl font-black text-white tabular-nums">
                      {screen === "daily" ? "34" : screen === "weekly" ? "148" : "562"}
                    </p>
                  </div>
                  <div className="ac-kpi rounded-xl border p-2.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                      Credited Points
                    </span>
                    <p className="mt-0.5 font-heading text-xl font-black text-[#F5D68E] tabular-nums">
                      {screen === "daily" ? "31.5" : screen === "weekly" ? "136.0" : "518.5"}
                    </p>
                  </div>
                  <div className="ac-kpi rounded-xl border p-2.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                      Top Closer
                    </span>
                    <p className="mt-0.5 truncate font-heading text-sm font-extrabold text-white">
                      Mansoor Arshad
                    </p>
                  </div>
                </div>

                {/* Leaderboard Rows */}
                <div className="ac-panel space-y-1.5 rounded-xl border p-2.5">
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-text-muted">
                    <span className="inline-flex items-center gap-1">
                      <Trophy className="h-3 w-3 text-[#D8AF58]" />
                      {screen.toUpperCase()} TOP PERFORMERS
                    </span>
                    <span>VALIDATED / CREDITED</span>
                  </div>
                  {SAMPLE_LEADERS.map((r) => (
                    <div
                      key={r.code}
                      className={cn(
                        "lb-row flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs",
                        r.rank === 1
                          ? "lb-row-gold border-[#D8AF58]/50 bg-[#D8AF58]/10"
                          : "border-white/10 bg-white/[0.03]",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="grid h-5 w-5 place-items-center rounded-full bg-white/10 font-heading text-[10px] font-extrabold text-white">
                          {r.rank}
                        </span>
                        <span className="font-semibold text-white">{r.name}</span>
                      </div>
                      <div className="flex items-center gap-3 font-heading font-bold tabular-nums">
                        <span className="text-emerald-300">{r.validated} sales</span>
                        <span className="text-[#F5D68E]">{r.credited} pts</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Mascot Corner Preview */}
            <div className="ac-panel flex flex-col items-center justify-center rounded-2xl border p-2.5 text-center">
              <div className="relative flex h-[145px] w-full items-center justify-center">
                <CubStage
                  pose={cubPose}
                  playKey={cubPlayKey}
                  size={122}
                  motion="full"
                  testId="preview-arena-cub"
                  bubble={{
                    title: isChristmas && christmasSantaCub ? "Ho Ho Ho!" : "Let's close!",
                    detail: isChristmas ? "Holiday Arena" : "Arena Cub",
                    side: "top",
                    compact: true,
                  }}
                />
              </div>
              <p className="mt-1 text-[11px] font-bold text-white" data-testid="preview-cub-costume-label">
                {isChristmas && christmasSantaCub ? "🎅 Santa Arena Cub" : "🦁 Normal Arena Cub"}
              </p>
            </div>
          </div>
        </ArenaThemeScope>
      </div>

      {/* Local Audio Previews */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-2.5">
        <div className="text-xs text-text-secondary">
          <span className="font-semibold text-white">Local Theme Audio Test:</span> Plays in your browser only — never broadcasts to office TVs.
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            data-testid="theme-preview-sound-sale"
            onClick={() => previewSound("sale")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-white/[0.09]"
          >
            <Play className="h-3 w-3 text-secondary" />
            Preview Sale Sound
          </button>
          <button
            type="button"
            data-testid="theme-preview-sound-bonus"
            onClick={() => previewSound("bonus")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-white/[0.09]"
          >
            <PartyPopper className="h-3 w-3 text-[#F5D68E]" />
            Preview Bonus Sound
          </button>
          <button
            type="button"
            data-testid="theme-preview-sound-team"
            onClick={() => previewSound("team")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-white/[0.09]"
          >
            <Shield className="h-3 w-3 text-primary-hover" />
            Preview Team Sound
          </button>
          <button
            type="button"
            data-testid="theme-preview-sound-hohoho"
            onClick={() => previewSound("hohoho")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8AF58]/40 bg-[#A61F32]/20 px-2.5 py-1.5 text-xs font-semibold text-[#F5D68E] hover:bg-[#A61F32]/35"
          >
            <Sparkles className="h-3 w-3 text-[#F5D68E]" />
            Preview Mascot Ho Ho Ho
          </button>
          <button
            type="button"
            data-testid="theme-preview-sound-sleigh"
            onClick={() => previewSound("sleigh")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#D8AF58]/40 bg-[#173D32]/30 px-2.5 py-1.5 text-xs font-semibold text-[#F5D68E] hover:bg-[#173D32]/50"
          >
            <Play className="h-3 w-3 text-[#F5D68E]" />
            Preview Sleigh Bells
          </button>
        </div>
      </div>
    </div>
  );
}
