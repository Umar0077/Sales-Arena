"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useTeamCelebrationStore, type StandingsSnapshot, type TeamCelebrationItem } from "@/frontend/stores/team-celebration-store";
import { useCelebrationStore } from "@/frontend/stores/celebration-store";
import { useBonusFlowStore } from "@/frontend/stores/bonus-flow-store";
import { useSpinFlowStore } from "@/frontend/stores/spin-flow-store";
import { useSettingsStore } from "@/frontend/stores/settings-store";
import { useReducedMotion } from "@/frontend/performance/reduced-motion";
import { noteShown } from "@/frontend/live/latency";
import { audioEngine } from "@/frontend/audio/engine";
import { playTeamStinger, stopTeamStinger } from "@/frontend/audio/team-stingers";
import { prepareCelebrationSound } from "@/frontend/audio/celebration-sounds";
import { computeFrameStats, type FrameStats } from "@/frontend/performance/frame-monitor";
import { useLiteDisplay } from "@/frontend/performance/lite";
import { whenExitStalled } from "@/frontend/performance/exit-recovery";
import { celebrationMs, headlineFor, themeFor, verifiedTeamTotal, type CelebrationTheme } from "@/shared/teams/celebration";
import type { TeamStandings } from "@/frontend/hooks/use-team-standings";
import type { CelebrationEvent } from "@/shared/types";
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
        <div className="tc-emblem-sheen" aria-hidden />
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
        exit={still ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -18 }}
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
  const lite = useLiteDisplay();
  const mode = useSettingsStore((s) => s.teamSaleMotion);
  // Reduced motion is the viewer's own preference: always honoured, whatever the performance settings.
  if (reduced) return "static";
  // Lite: the Admin chose it, the display is in Performance mode, or (Auto) this display is a weak device or was
  // MEASURED struggling during earlier celebrations. Lite keeps the emblem, text, closer and sound.
  return lite || mode === "lite" ? "lite" : "full";
}

export function toSnapshot(data: TeamStandings | null): StandingsSnapshot | null {
  if (!data) return null;
  return {
    period: data.period,
    label: data.label,
    teams: data.teams.map((t) => ({ id: t.id, name: t.name, validated: t.validated, logoUrl: t.logoUrl, color: t.color, accentSecondary: t.accentSecondary })),
  };
}

/** Artwork decoded before a celebration starts (and kept in memory): no pop-in or decode jank mid-animation. */
const imageCache = new Map<string, Promise<void>>();
const keepAlive: HTMLImageElement[] = [];
export function preloadImage(src: string | null | undefined): Promise<void> {
  if (!src || typeof Image === "undefined") return Promise.resolve();
  let p = imageCache.get(src);
  if (!p) {
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    keepAlive.push(img);
    p = (typeof img.decode === "function" ? img.decode() : new Promise<void>((res) => ((img.onload = () => res()), (img.onerror = () => res())))).catch(() => {
      imageCache.delete(src); // a failed load is retried next time; the view still shows its fallback
    });
    imageCache.set(src, p);
  }
  return p;
}
const within = (p: Promise<unknown>, ms: number) => Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);
/** Longest a celebration waits for its artwork / sound to be ready before it starts anyway. */
const PREPARE_MS = 800;
/** The exit animation normally reports back in ~0.3 s; if it never does (hidden tab, stalled frame) the queue moves on. */
const EXIT_RECOVERY_MS = 1500;

const subscribeVisibility = (cb: () => void) => {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
};
function useDocumentVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, () => document.visibilityState !== "hidden", () => true);
}

/** Frame pacing while a celebration plays (a rAF sampler that runs only during the celebration). */
function measureFrames(): () => { stats: FrameStats; hidden: boolean } {
  const deltas: number[] = [];
  let last = 0;
  let raf = 0;
  let hidden = document.visibilityState === "hidden";
  const frame = (t: number) => {
    if (last) deltas.push(t - last);
    last = t;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  const onVis = () => {
    if (document.visibilityState === "hidden") hidden = true;
  };
  document.addEventListener("visibilitychange", onVis);
  return () => {
    cancelAnimationFrame(raf);
    document.removeEventListener("visibilitychange", onVis);
    return { stats: computeFrameStats(deltas, deltas.length), hidden };
  };
}
const recentFps: number[] = [];
/** Measured, not assumed: two of the last three celebrations below ~40 fps (visible, ≥ 2 s measured) → Lite from then on. */
function recordFrames(r: { stats: FrameStats; hidden: boolean }) {
  const w = window as unknown as { __celebrationFrames?: Array<FrameStats & { hidden: boolean }> };
  (w.__celebrationFrames ??= []).push({ ...r.stats, hidden: r.hidden });
  if (w.__celebrationFrames.length > 30) w.__celebrationFrames.shift();
  // Valid when the tab stayed visible and at least 2 s of frames were seen (a very slow PC draws few frames: that
  // is exactly the case to detect, so the frame COUNT is not the criterion).
  if (r.hidden || r.stats.samples < 2 || r.stats.samples * r.stats.frameTimeAvg < 2000) return;
  recentFps.push(r.stats.avgFps);
  if (recentFps.length > 3) recentFps.shift();
  if (recentFps.filter((f) => f < 40).length >= 2) useTeamCelebrationStore.getState().setMeasuredLite(true);
}

/**
 * Teams Arena celebration layer (mounted by the Teams Arena screen only).
 *  - While mounted, ArenaEventBridge routes competing teams' live sales here instead of the sale card.
 *  - One celebration at a time, in arrival order, through the store's state machine (preparing → playing →
 *    finishing → idle); never while a bonus popup is queued, open or still fading out, a spin is running or a
 *    standard sale card is up (the bonus keeps its priority).
 *  - Keyed by sale id: a standings refresh never restarts the animation or its sound.
 *  - Hidden tab: no new celebration starts while the tab is hidden (the queue waits, nothing is dropped); a
 *    celebration whose time ran out while hidden ends at once when the tab is shown again.
 *  - Leaving Teams Arena: anything not yet shown goes back to the standard sale card (never lost).
 */
export function TeamSaleCelebrationLayer({ data }: { data: TeamStandings | null }) {
  const current = useTeamCelebrationStore((s) => s.current);
  const phase = useTeamCelebrationStore((s) => s.phase);
  const queued = useTeamCelebrationStore((s) => s.queue.length);
  const latest = useTeamCelebrationStore((s) => s.latest);
  const bonusBusy = useBonusFlowStore((s) => s.active !== null || s.queue.length > 0 || s.exiting);
  const spinStage = useSpinFlowStore((s) => s.stage);
  const cardBusy = useCelebrationStore((s) => s.current !== null);
  const motionLevel = useMotionLevel();
  const visible = useDocumentVisible();

  useEffect(() => {
    const st = useTeamCelebrationStore.getState();
    st.setMounted(true);
    Object.values(EMBLEM_ART).forEach((a) => void preloadImage(a.src));
    void prepareCelebrationSound("sigma");
    void prepareCelebrationSound("panthers");
    return () => {
      const s = useTeamCelebrationStore.getState();
      s.setMounted(false);
      s.setLatest(null);
      const notShown = s.phase === "preparing" && s.current ? [s.current] : [];
      s.reset();
      stopTeamStinger();
      for (const it of [...notShown, ...s.drain()]) {
        s.count("handedBack");
        handBack(it.event);
      }
    };
  }, []);

  useEffect(() => {
    useTeamCelebrationStore.getState().setLatest(toSnapshot(data));
    data?.teams.forEach((t) => void preloadImage(t.logoUrl));
  }, [data]);

  // idle → preparing, when nothing else is on screen
  useEffect(() => {
    if (phase !== "idle" || !queued || bonusBusy || spinStage !== "idle" || cardBusy || !visible) return;
    const t = setTimeout(() => {
      const st = useTeamCelebrationStore.getState();
      const item = st.next();
      if (!item) return;
      // Re-checked at show time: a team archived while its sale waited is not celebrated as competing.
      if (st.latest && !st.latest.teams.some((x) => x.id === item.team.id)) {
        useTeamCelebrationStore.getState().finish();
        useTeamCelebrationStore.getState().count("handedBack");
        handBack(item.event);
      }
    }, 50); // coalesces a burst of state changes into one decision
    return () => clearTimeout(t);
  }, [phase, queued, bonusBusy, spinStage, cardBusy, visible]);

  // preparing → playing: artwork decoded and sound ready (bounded), then the animation and its sound start together
  useEffect(() => {
    if (phase !== "preparing" || !current) return;
    let alive = true;
    const theme = themeFor(current.team);
    const logo = useTeamCelebrationStore.getState().latest?.teams.find((t) => t.id === current.team.id)?.logoUrl ?? current.team.logoUrl;
    const sound = theme === "lion" ? "sigma" : theme === "panther" ? "panthers" : null;
    void within(Promise.all([preloadImage(theme === "crest" ? null : EMBLEM_ART[theme].src), preloadImage(logo), sound ? prepareCelebrationSound(sound) : null]), PREPARE_MS).then(() => {
      const st = useTeamCelebrationStore.getState();
      if (!alive || st.current !== current || st.phase !== "preparing") return;
      st.play();
      noteShown("sale", saleKey(current.event.id));
      const s = useSettingsStore.getState();
      const result = playTeamStinger(theme, { soundEnabled: s.soundEnabled, saleCategory: s.soundCategories?.sale !== false, teamSaleSound: s.teamSaleSound !== false }, current.event.id);
      document.documentElement.dataset.teamStinger = result; // diagnostics: played / muted / locked (autoplay)
    });
    return () => {
      alive = false;
    };
  }, [phase, current]);

  // playing: ends on its own clock (timestamp-based, so a throttled timer or a hidden tab cannot extend it)
  useEffect(() => {
    if (phase !== "playing") return;
    const endAt = useTeamCelebrationStore.getState().phaseAt + celebrationMs(motionLevel === "lite" ? "lite" : "full", motionLevel === "static");
    const check = () => {
      const st = useTeamCelebrationStore.getState();
      if (st.phase === "playing" && performance.now() >= endAt - 5) st.finish();
    };
    const t = setTimeout(check, Math.max(0, endAt - performance.now()));
    document.addEventListener("visibilitychange", check);
    const stopMeasure = measureFrames();
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", check);
      recordFrames(stopMeasure());
    };
  }, [phase, motionLevel]);

  // While a celebration plays, the decorations underneath it pause (globals.css .tc-celebrating).
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("tc-celebrating", phase === "playing");
    return () => root.classList.remove("tc-celebrating");
  }, [phase]);

  // finishing: released by the exit animation (onExitComplete below) or, if that never comes, by the safety release
  // (hidden tab / frozen page; a slow exit on a visible page is never cut short)
  useEffect(() => {
    if (phase !== "finishing") return;
    return whenExitStalled(() => useTeamCelebrationStore.getState().exited(true), { afterMs: EXIT_RECOVERY_MS });
  }, [phase]);

  const snap = current ? latest?.teams.find((t) => t.id === current.team.id) : undefined;
  const total = current ? verifiedTeamTotal(current.baseline, latest, current.team.id) : null;
  return (
    <CelebrationPortal onExitComplete={() => useTeamCelebrationStore.getState().exited()}>
      {phase === "playing" && current && (
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
export function CelebrationPortal({ children, onExitComplete }: { children: React.ReactNode; onExitComplete?: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence mode="wait" onExitComplete={onExitComplete}>
      {children}
    </AnimatePresence>,
    document.body,
  );
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
