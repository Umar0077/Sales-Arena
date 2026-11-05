"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useTeamCelebrationStore, type StandingsSnapshot, type TeamCelebrationItem } from "@/store/team-celebration-store";
import { useCelebrationStore } from "@/store/celebration-store";
import { useBonusFlowStore } from "@/store/bonus-flow-store";
import { useSpinFlowStore } from "@/store/spin-flow-store";
import { useSettingsStore } from "@/store/settings-store";
import { useReducedMotion } from "@/lib/performance/reduced-motion";
import { noteShown } from "@/lib/live/latency";
import { audioEngine } from "@/lib/audio/engine";
import { playTeamStinger, stopTeamStinger } from "@/lib/audio/team-stingers";
import { celebrationMs, headlineFor, themeFor, verifiedTeamTotal, type CelebrationTheme } from "@/lib/teams/celebration";
import type { TeamStandings } from "@/lib/teams/use-team-standings";
import type { CelebrationEvent } from "@/types";
export type MotionLevel = "full" | "lite" | "static";

const PERIOD_WORD: Record<string, string> = { day: "today", week: "this week", month: "this month" };

/**
 * Owner-supplied emblem artwork for the preset themes (public/teams/celebrations, converted to WebP from the
 * originals in assets/teams/originals without editing the artwork). Any other team uses its own crest.
 */
export const EMBLEM_ART: Readonly<Record<Exclude<CelebrationTheme, "crest">, { src: string; alt: string }>> = Object.freeze({
  lion: { src: "/teams/celebrations/sigma-lion-emblem.webp", alt: "Team Sigma lion emblem" },
  panther: { src: "/teams/celebrations/panthers-panther-emblem.webp", alt: "Team Panthers panther emblem" },
});

/** Theme light: Sigma warm gold, Panthers electric cyan / violet, other teams their own colours. */
const PALETTE: Record<CelebrationTheme, { a: string; b: string; text: string }> = {
  lion: { a: "#F5C451", b: "#7568FF", text: "linear-gradient(180deg,#FFF7DA 0%,#FFE08F 50%,#E9B04A 100%)" },
  panther: { a: "#27D5FF", b: "#8B5CFF", text: "linear-gradient(180deg,#FFFFFF 0%,#D6F7FF 50%,#A99BFF 100%)" },
  crest: { a: "#7568FF", b: "#27D5FF", text: "linear-gradient(180deg,#FFFFFF 0%,#ECE9FF 60%,#BDB6FF 100%)" },
};

const initials = (name: string) => {
  const p = name.replace(/^team\s+/i, "").trim().split(/\s+/).filter(Boolean);
  return ((p.length > 1 ? p[0][0] + p[p.length - 1][0] : (p[0] ?? "T").slice(0, 2)) || "T").toUpperCase();
};

function Crest({ src, name, color, className }: { src: string | null; name: string; color: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken)
    return (
      <div
        className={`grid aspect-square place-items-center rounded-[22%] font-heading font-extrabold text-white ${className ?? ""}`}
        style={{ background: `radial-gradient(circle at 50% 35%, ${color}66, ${color}1f 70%)`, border: `2px solid ${color}aa`, fontSize: "clamp(28px, 6vh, 72px)", boxShadow: `0 0 48px -6px ${color}` }}
        aria-label={`${name} crest`}
        data-testid="team-celebration-crest"
        data-fallback="initials"
      >
        {initials(name)}
      </div>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- official crest from /public or an Admin upload (data URL), shown at its own proportions
    <img src={src} alt={`${name} official crest`} onError={() => setBroken(true)} className={`aspect-square object-contain ${className ?? ""}`} draggable={false} data-testid="team-celebration-crest" />
  );
}

/**
 * The Owner's emblem on a lit glass plate. The emblems are transparent line art (black on transparent): a backlight
 * behind them (warm for Sigma, cool for Panthers) shows them clearly on the dark arena. The artwork itself is shown
 * as is, fitted whole (object-fit: contain). Motion is layered (plate, artwork and light move at different depths),
 * not character animation.
 */
function Emblem({ theme, name }: { theme: Exclude<CelebrationTheme, "crest">; name: string }) {
  const art = EMBLEM_ART[theme];
  return (
    <div className="tc-emblem" data-testid="team-emblem" data-emblem={theme}>
      <div className="tc-emblem-plate">
        {/* light behind the artwork (the panther PNG is transparent: its black linework is lit from behind) */}
        <div className="tc-emblem-backlight" aria-hidden />
        <div className="tc-emblem-art">
          {/* eslint-disable-next-line @next/next/no-img-element -- static Owner artwork, shown at its own 16:9 proportions */}
          <img src={art.src} alt={art.alt.replace(/^Team \w+/, name)} className="tc-emblem-img" draggable={false} data-testid="team-emblem-img" />
        </div>
        <div className="tc-emblem-light" aria-hidden />
        <div className="tc-emblem-edge" aria-hidden />
      </div>
    </div>
  );
}

export interface CelebrationViewProps {
  item: TeamCelebrationItem;
  /** Display name / logo / colours, preferring this display's current standings (a renamed team shows its new name). */
  name: string;
  logoUrl: string | null;
  color: string;
  accent: string | null;
  total: { value: number; period: string } | null;
  motionLevel: MotionLevel;
}

/** The celebration itself (pure presentation; also used by the Admin preview). */
export function TeamSaleCelebrationView({ item, name, logoUrl, color, accent, total, motionLevel }: CelebrationViewProps) {
  const theme = themeFor(item.team);
  const pal = theme === "crest" ? { ...PALETTE.crest, a: color, b: accent ?? PALETTE.crest.b } : PALETTE[theme];
  const headline = headlineFor(name);
  const agent = item.event.agentName || item.event.agentId || "";
  const still = motionLevel === "static";

  return (
    <motion.div
      key={item.event.id}
      role="status"
      aria-live="assertive"
      aria-label={`${headline} ${agent ? `Closed by ${agent}.` : ""}`}
      data-testid="team-celebration"
      data-theme={theme}
      data-team-id={item.team.id}
      data-case={item.event.id}
      data-motion={motionLevel}
      data-preview={item.preview ? "true" : undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.3 } }}
      transition={{ duration: still ? 0.25 : 0.4 }}
      className={`tc-root tc-${motionLevel} tc-theme-${theme} pointer-events-none fixed inset-0 z-50 flex items-center justify-center overflow-hidden px-4`}
      style={{ ["--tc-a" as string]: pal.a, ["--tc-b" as string]: pal.b }}
    >
      {/* Atmosphere: navy vignette with the team's light (temporary; the rankings stay faintly visible behind) */}
      <div className="tc-backdrop absolute inset-0" />

      {/* Exit: the whole stage recedes and lifts away (opacity only for reduced motion) */}
      <motion.div
        className="relative flex w-full max-w-[min(1500px,96vw)] flex-col items-center text-center"
        exit={still ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -18, filter: "blur(4px)" }}
        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      >
        <div className="tc-stage relative flex items-center justify-center">
          {theme === "crest" ? (
            <div className="tc-crest-hero relative" data-testid="team-crest-hero">
              <Crest src={logoUrl} name={name} color={color} className="tc-crest-hero-size drop-shadow-[0_24px_30px_rgba(0,0,0,0.7)]" />
            </div>
          ) : (
            <>
              <Emblem theme={theme} name={name} />
              {/* the official crest stays the team's identity, docked on the plate */}
              <div className="tc-crest absolute">
                <Crest src={logoUrl} name={name} color={color} className="tc-crest-size drop-shadow-[0_14px_20px_rgba(0,0,0,0.8)]" />
              </div>
            </>
          )}
        </div>

        {/* Announcement */}
        <h2 className="tc-headline relative font-heading font-extrabold uppercase" data-testid="team-celebration-headline" data-headline={headline}>
          <span className="tc-headline-text" style={{ backgroundImage: pal.text }}>
            {headline}
          </span>
        </h2>
        <div className="tc-rule" aria-hidden />

        {agent && (
          <p className="tc-agent flex flex-wrap items-baseline justify-center gap-x-4 gap-y-1">
            <span className="text-[clamp(11px,1.45vh,15px)] font-semibold uppercase tracking-[0.42em] text-text-secondary">Closed by</span>{" "}
            <span className="max-w-[90vw] break-words font-heading text-[clamp(20px,min(2.5vw,4.2vh),44px)] font-bold tracking-[0.01em] text-white [text-shadow:0_2px_18px_rgba(0,0,0,0.85)]" data-testid="team-celebration-agent">
              {agent}
            </span>
          </p>
        )}

        <div className="mt-[1.2vh] flex min-h-[clamp(28px,4.4vh,46px)] flex-wrap items-center justify-center gap-2">
          {total && (
            <span
              className="tc-total inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[clamp(13px,1.9vh,20px)] font-semibold text-white"
              style={{ borderColor: `${pal.a}88`, background: "rgba(8,12,26,0.78)", boxShadow: `0 0 26px -8px ${pal.a}` }}
              data-testid="team-celebration-total"
            >
              {name}{" "}
              <span className="h-1 w-1 rounded-full bg-white/50" aria-hidden />{" "}
              <span className="font-heading font-extrabold tabular-nums" style={{ color: pal.a }}>
                {total.value}
              </span>{" "}
              validated {PERIOD_WORD[total.period] ?? ""}
            </span>
          )}
          {item.preview && (
            <span className="rounded-full border border-amber-300/50 bg-amber-400/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-amber-200" data-testid="team-celebration-preview">
              Preview · not a real sale
            </span>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Give a sale back to the standard sale card (the same rules as ArenaEventBridge). */
function handBack(event: CelebrationEvent) {
  if (useSettingsStore.getState().saleCelebrationStyle === "off") return;
  useCelebrationStore.getState().enqueue(event);
}

const saleKey = (id: string) => (id.startsWith("celeb_sale_") ? id.slice("celeb_sale_".length) : id);

export function useMotionLevel(): MotionLevel {
  const reduced = useReducedMotion();
  const quality = useSettingsStore((s) => s.quality);
  const mode = useSettingsStore((s) => s.teamSaleMotion);
  if (reduced) return "static";
  return quality === "performance" || mode === "lite" ? "lite" : "full";
}

export function toSnapshot(data: TeamStandings | null): StandingsSnapshot | null {
  if (!data) return null;
  return {
    period: data.period,
    label: data.label,
    teams: data.teams.map((t) => ({ id: t.id, name: t.name, validated: t.validated, logoUrl: t.logoUrl, color: t.color, accentSecondary: t.accentSecondary })),
  };
}

/**
 * Teams Arena celebration layer (mounted by the Teams Arena screen only).
 *  - While mounted, ArenaEventBridge routes competing teams' live sales here instead of the sale card.
 *  - One celebration at a time, in arrival order; never while a bonus popup is queued / open or a spin is
 *    running (the bonus keeps its priority), never over a standard sale card.
 *  - Keyed by sale id: a standings refresh never restarts the animation.
 *  - Leaving Teams Arena: anything still waiting goes back to the standard sale card (never lost).
 */
export function TeamSaleCelebrationLayer({ data }: { data: TeamStandings | null }) {
  const current = useTeamCelebrationStore((s) => s.current);
  const queued = useTeamCelebrationStore((s) => s.queue.length);
  const latest = useTeamCelebrationStore((s) => s.latest);
  const bonusBusy = useBonusFlowStore((s) => s.active !== null || s.queue.length > 0);
  const spinStage = useSpinFlowStore((s) => s.stage);
  const cardBusy = useCelebrationStore((s) => s.current !== null);
  const motionLevel = useMotionLevel();
  // A bonus popup / sale card / spin that just closed is still fading out: the next celebration waits for it.
  const wasBusy = useRef(false);

  useEffect(() => {
    const st = useTeamCelebrationStore.getState();
    st.setMounted(true);
    return () => {
      const s = useTeamCelebrationStore.getState();
      s.setMounted(false);
      s.setLatest(null);
      s.finish();
      stopTeamStinger();
      for (const it of s.drain()) handBack(it.event);
    };
  }, []);

  useEffect(() => {
    useTeamCelebrationStore.getState().setLatest(toSnapshot(data));
  }, [data]);

  // Start the next celebration when nothing else is on screen.
  useEffect(() => {
    const busy = bonusBusy || spinStage !== "idle" || cardBusy;
    if (busy) wasBusy.current = true;
    if (current || !queued || busy) return;
    const delay = wasBusy.current ? 800 : 200;
    wasBusy.current = false;
    const t = setTimeout(() => {
      const st = useTeamCelebrationStore.getState();
      const item = st.next();
      if (!item) return;
      // Re-checked at show time: a team archived while its sale waited is not celebrated as competing.
      if (st.latest && !st.latest.teams.some((x) => x.id === item.team.id)) {
        st.finish();
        handBack(item.event);
        return;
      }
      noteShown("sale", saleKey(item.event.id));
      const s = useSettingsStore.getState();
      const sound = playTeamStinger(themeFor(item.team), { soundEnabled: s.soundEnabled, saleCategory: s.soundCategories?.sale !== false, teamSaleSound: s.teamSaleSound !== false });
      document.documentElement.dataset.teamStinger = sound; // diagnostics: played / muted / locked (autoplay)
    }, delay);
    return () => clearTimeout(t);
  }, [current, queued, bonusBusy, spinStage, cardBusy]);

  // Each celebration ends on its own timer (no loop survives it).
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => useTeamCelebrationStore.getState().finish(), celebrationMs(motionLevel === "lite" ? "lite" : "full", motionLevel === "static"));
    return () => clearTimeout(t);
  }, [current, motionLevel]);

  const snap = current ? latest?.teams.find((t) => t.id === current.team.id) : undefined;
  const total = current ? verifiedTeamTotal(current.baseline, latest, current.team.id) : null;
  return (
    <CelebrationPortal>
      {current && (
        <TeamSaleCelebrationView
          key={current.event.id}
          item={current}
          name={snap?.name ?? current.team.name}
          logoUrl={snap?.logoUrl ?? current.team.logoUrl}
          color={snap?.color ?? current.team.color}
          accent={snap?.accentSecondary ?? current.team.accentSecondary}
          total={total !== null && latest ? { value: total, period: latest.period } : null}
          motionLevel={motionLevel}
        />
      )}
    </CelebrationPortal>
  );
}

/**
 * Rendered on document.body: a celebration is always positioned against the screen, never against a moving or
 * transformed screen container (on a phone the arena page is taller than the screen).
 */
export function CelebrationPortal({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(<AnimatePresence mode="wait">{children}</AnimatePresence>, document.body);
}

/** Admin preview: local to the Admin's own screen (no request, no stream event, no data), sound on click. */
export function previewItem(kind: "lion" | "panther" | "crest"): TeamCelebrationItem {
  const team =
    kind === "lion"
      ? { id: "preview-sigma", slug: "sigma", name: "Team Sigma", logoUrl: "/teams/team-sigma.webp", color: "#F5C451", accentSecondary: "#7568FF" }
      : kind === "panther"
        ? { id: "preview-panthers", slug: "panthers", name: "Team Panthers", logoUrl: "/teams/team-panthers.webp", color: "#27D5FF", accentSecondary: "#8B5CFF" }
        : { id: "preview-generic", slug: "preview-generic", name: "Team Nova", logoUrl: null, color: "#36E0B5", accentSecondary: "#27D5FF" };
  const now = new Date().toISOString();
  return {
    event: { id: `preview_${kind}_${Date.now()}`, tier: "sale", headline: "", subline: "", agentId: null, agentName: "Sample Agent", teamName: team.name, teamColor: team.color, value: null, createdAt: now, preview: true },
    team: { ...team, active: true, businessDate: now.slice(0, 10) },
    baseline: null,
    enqueuedAt: Date.now(),
    preview: true,
  };
}

export function playPreviewSound(kind: "lion" | "panther" | "crest") {
  audioEngine.unlock();
  const s = useSettingsStore.getState();
  // A tick later: the click has just resumed the audio context.
  setTimeout(() => playTeamStinger(kind, { soundEnabled: s.soundEnabled, saleCategory: s.soundCategories?.sale !== false, teamSaleSound: s.teamSaleSound !== false }), 60);
}
