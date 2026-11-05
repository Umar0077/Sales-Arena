"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Crown, Send, BadgeCheck, Percent, Users, Trophy, ShieldAlert, TrendingUp, TrendingDown, Radio } from "lucide-react";
import { useReducedMotion } from "@/lib/performance/reduced-motion";
import { useSettingsStore } from "@/store/settings-store";
import { AnimatedCounter } from "@/components/arena/AnimatedCounter";
import { useTeamStandings, type TeamPeriod, type TeamStandings } from "@/lib/teams/use-team-standings";
import type { RankedMember, RankedTeam, TopPerformer } from "@/lib/teams/ranking";
import { cn } from "@/lib/utils";

const PERIODS: Array<{ id: TeamPeriod; label: string }> = [
  { id: "day", label: "Today" },
  { id: "week", label: "This Week" },
  { id: "month", label: "This Month" },
];
/** Placement colours (the arena's gold / silver / bronze). */
const MEDAL = {
  1: { color: "#F5C451", soft: "rgba(245,196,81,0.18)", glow: "rgba(245,196,81,0.55)", label: "1ST", word: "FIRST PLACE" },
  2: { color: "#C9D1E0", soft: "rgba(201,209,224,0.14)", glow: "rgba(201,209,224,0.38)", label: "2ND", word: "SECOND PLACE" },
  3: { color: "#D08A4F", soft: "rgba(208,138,79,0.14)", glow: "rgba(208,138,79,0.36)", label: "3RD", word: "THIRD PLACE" },
} as const;
const medal = (rank: number) => MEDAL[rank as 1 | 2 | 3] ?? null;
/** How far forward each placement sits: the leader is lifted and in front, 2nd and 3rd step back. */
const DEPTH: Record<number, { lift: number; scale: number; z: number; shadow: string }> = {
  1: { lift: -8, scale: 1, z: 30, shadow: "0 30px 60px -28px rgba(0,0,0,0.9)" },
  2: { lift: 0, scale: 0.975, z: 20, shadow: "0 22px 44px -26px rgba(0,0,0,0.85)" },
  3: { lift: 4, scale: 0.955, z: 10, shadow: "0 16px 34px -24px rgba(0,0,0,0.8)" },
};
const PERIOD_KEY = "sales-arena:teams-period";

const initials = (name: string) => {
  const p = name.trim().split(/\s+/);
  return ((p.length > 1 ? p[0][0] + p[p.length - 1][0] : name.slice(0, 2)) || "?").toUpperCase();
};
const rate = (v: number | null) => (v === null ? "—" : `${v.toFixed(v >= 10 ? 0 : 1)}%`);

/** The team crest. Transparent artwork, kept crisp (contain, never cropped); initials if it cannot load. */
function TeamLogo({ team, size, className, glow, fluid }: { team: Pick<RankedTeam, "logoUrl" | "name" | "color">; size: number; className?: string; glow?: boolean; fluid?: boolean }) {
  const [broken, setBroken] = useState(false);
  if (!team.logoUrl || broken)
    return (
      <div className={cn("grid shrink-0 place-items-center rounded-2xl font-heading font-extrabold text-white", className)} style={{ width: size, height: size, background: `${team.color}22`, border: `1px solid ${team.color}66` }} aria-label={team.name}>
        {initials(team.name.replace(/^team\s+/i, ""))}
      </div>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- official artwork from /public or an Admin upload (data URL); next/image cannot take data: uploads
    <img
      src={team.logoUrl}
      alt={`${team.name} logo`}
      width={size}
      height={size}
      onError={() => setBroken(true)}
      className={cn("shrink-0 object-contain", className)}
      style={{ width: fluid ? undefined : size, height: fluid ? undefined : size, filter: glow ? `drop-shadow(0 12px 14px rgba(0,0,0,0.65)) drop-shadow(0 0 16px ${team.color}55)` : undefined }}
      draggable={false}
      data-testid="team-logo"
    />
  );
}

/**
 * The crest on a lit plate: a soft disc of the team colour, a slowly turning halo ring and a gentle pulse
 * behind it, and a drop shadow that lifts the artwork off the card. All motion is transform / opacity only and
 * stops for reduced motion and Lite mode (the parent omits the `teams-motion` class).
 */
function CrestPlate({ team, size, rank }: { team: RankedTeam; size: string; rank: number }) {
  const m = medal(rank);
  return (
    <div className="teams-crest relative shrink-0" style={{ width: size, height: size }} aria-hidden={false}>
      <div className="teams-crest-pulse absolute inset-[6%] rounded-full" style={{ background: `radial-gradient(circle, ${team.color}55 0%, ${team.color}1c 45%, transparent 70%)` }} />
      <div
        className="teams-crest-halo absolute inset-[2%] rounded-full"
        style={{
          background: `conic-gradient(from 0deg, transparent 0deg, ${m?.color ?? team.color}cc 50deg, transparent 110deg, transparent 180deg, ${team.color}aa 230deg, transparent 290deg)`,
          WebkitMask: "radial-gradient(circle, transparent 64%, #000 65.5%, #000 67%, transparent 68.5%)",
          mask: "radial-gradient(circle, transparent 64%, #000 65.5%, #000 67%, transparent 68.5%)",
        }}
      />
      <div className="absolute inset-[13%] rounded-full" style={{ background: "radial-gradient(circle at 50% 35%, rgba(255,255,255,0.08), rgba(11,17,34,0.0) 60%)", boxShadow: `inset 0 0 0 1px ${team.color}26` }} />
      <div className="absolute inset-0 grid place-items-center">
        <TeamLogo team={team} size={192} fluid className="relative h-[86%] w-[86%]" glow />
      </div>
    </div>
  );
}

/** The leading team just changed (after the first authoritative load of this period): a short, single banner. */
function useLeadTakeover(data: TeamStandings | null) {
  const [takeover, setTakeover] = useState<{ teamId: string; at: number } | null>(null);
  const prev = useRef<{ period: string; leader: string | null } | null>(null);
  useEffect(() => {
    if (!data) return;
    const p = prev.current;
    prev.current = { period: data.period, leader: data.leaderTeamId };
    if (!p || p.period !== data.period) return; // first load of this period: never a fake "lead change"
    if (data.leaderTeamId && data.leaderTeamId !== p.leader) {
      const next = { teamId: data.leaderTeamId, at: Date.now() };
      const t0 = setTimeout(() => setTakeover(next), 0);
      const t1 = setTimeout(() => setTakeover((cur) => (cur === next ? null : cur)), 5200);
      return () => {
        clearTimeout(t0);
        clearTimeout(t1);
      };
    }
  }, [data]);
  return takeover;
}

/** Members whose validated sales went up since the previous update (row highlight for a few seconds). */
function useFreshSales(data: TeamStandings | null) {
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const prev = useRef<{ period: string; v: Map<string, number> } | null>(null);
  useEffect(() => {
    if (!data) return;
    const v = new Map<string, number>();
    for (const t of data.teams) for (const m of t.members) v.set(`${t.id}|${m.userCode}`, m.validated);
    const p = prev.current;
    prev.current = { period: data.period, v };
    if (!p || p.period !== data.period) return;
    const up = new Set([...v].filter(([k, n]) => n > (p.v.get(k) ?? 0)).map(([k]) => k));
    if (!up.size) return;
    const t0 = setTimeout(() => setFresh(up), 0);
    const t1 = setTimeout(() => setFresh(new Set()), 6000);
    return () => {
      clearTimeout(t0);
      clearTimeout(t1);
    };
  }, [data]);
  return fresh;
}

export function TeamsScreen() {
  const [period, setPeriod] = useState<TeamPeriod>(() => {
    try {
      const v = sessionStorage.getItem(PERIOD_KEY);
      return v === "week" || v === "month" ? v : "day";
    } catch {
      return "day";
    }
  });
  const choose = (p: TeamPeriod) => {
    setPeriod(p);
    try {
      sessionStorage.setItem(PERIOD_KEY, p);
    } catch {
      /* per-tab convenience only */
    }
  };
  const { data, status } = useTeamStandings(period);
  const reducedSystem = useReducedMotion();
  const quality = useSettingsStore((s) => s.quality);
  const animate = !reducedSystem && quality !== "performance";
  const takeover = useLeadTakeover(data);
  const fresh = useFreshSales(data);
  const takeoverTeam = takeover ? data?.teams.find((t) => t.id === takeover.teamId) : null;
  const leader = data?.teams.find((t) => t.id === data.leaderTeamId) ?? null;
  const topValidated = data?.teams[0]?.validated ?? 0;
  const totalValidated = data?.teams.reduce((s, t) => s + t.validated, 0) ?? 0;

  return (
    <div className={cn("mx-auto flex w-full max-w-[1880px] flex-1 flex-col gap-4 px-3 pt-3 sm:px-5 lg:gap-5", animate && "teams-motion")} data-testid="teams-screen">
      {/* Broadcast header */}
      <header className="relative flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-bold tracking-[0.32em] text-secondary">
            <span className="relative flex h-2 w-2">
              <span className="teams-live-ping absolute inline-flex h-full w-full rounded-full bg-rose-400" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
            </span>
            TEAMS ARENA · LIVE
          </p>
          <h1 className="font-heading text-2xl font-extrabold leading-tight lg:text-[2.1rem] min-[1800px]:text-[2.6rem]" data-testid="arena-screen-title">
            <span className="bg-gradient-to-r from-white via-[#E7E3FF] to-[#9EA8FF] bg-clip-text text-transparent">Team Competition</span>{" "}
            <span className="text-text-secondary">— Validated Sales</span>
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-text-muted" data-testid="teams-period-label">
            <span>{data?.label ?? " "}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {data && data.teams.length > 0 && (
            <div className="hidden items-center gap-3 rounded-xl border border-white/[0.08] bg-[#0B1122]/80 px-3.5 py-1.5 md:flex" data-testid="teams-race-summary">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
                <Radio className="h-3.5 w-3.5 text-secondary" /> Floor total
              </span>
              <span className="font-heading text-lg font-extrabold text-white tabular-nums">{totalValidated}</span>
              <span className="h-5 w-px bg-white/10" />
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: leader ? MEDAL[1].color : undefined }}>
                <Crown className="h-3.5 w-3.5" /> {leader ? leader.name : "Lead open"}
              </span>
            </div>
          )}
          <div role="tablist" aria-label="Team competition period" className="flex rounded-xl border border-white/[0.08] bg-[#0B1122]/80 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                role="tab"
                aria-selected={period === p.id}
                data-testid={`teams-period-${p.id}`}
                onClick={() => choose(p.id)}
                className={cn(
                  "rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary min-[1800px]:px-4 min-[1800px]:py-2 min-[1800px]:text-base",
                  period === p.id ? "bg-gradient-to-r from-primary to-[#8B5CFF] text-white shadow-[0_0_18px_-4px_rgba(117,104,255,0.9)]" : "text-text-secondary hover:text-white",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {!data && status === "loading" && (
        <div className="grid gap-4 md:grid-cols-3 2xl:grid-cols-[1.12fr_1fr_1fr_minmax(19rem,24rem)]" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-72 animate-pulse rounded-[1.4rem] border border-white/[0.06] bg-white/[0.02]" />
          ))}
        </div>
      )}
      {!data && status === "error" && (
        <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-5 text-rose-200" role="status" data-testid="teams-error">
          Team standings are unavailable right now. They reload automatically.
        </div>
      )}
      {data && data.teams.length === 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-text-secondary" data-testid="teams-empty">
          <ShieldAlert className="h-6 w-6 text-secondary" />
          No active teams yet. Teams and their members are set up in Admin → Team Management.
        </div>
      )}

      {data && data.teams.length > 0 && (
        <LayoutGroup>
          <div
            className={cn(
              "grid items-start gap-4 lg:gap-5",
              data.teams.length >= 3 ? "md:grid-cols-3 2xl:grid-cols-[1.12fr_1fr_1fr_minmax(19rem,24rem)]" : "md:grid-cols-2 2xl:grid-cols-[1.12fr_1fr_minmax(19rem,24rem)]",
            )}
          >
            {/* Columns in placement order: 1st on the left, in front; 2nd and 3rd step back. */}
            {data.teams.map((t) => (
              <motion.div key={t.id} layout={animate ? "position" : false} transition={{ type: "spring", stiffness: 240, damping: 30 }} className="flex min-w-0 flex-col gap-3" style={{ zIndex: DEPTH[t.rank]?.z ?? 1 }} data-testid="team-column" data-team={t.slug ?? t.id}>
                <TeamCard team={t} leader={data.leaderTeamId === t.id} topValidated={topValidated} animate={animate} />
                <TeamTop3 team={t} fresh={fresh} animate={animate} />
              </motion.div>
            ))}
            <TopPerformers top={data.top} animate={animate} className="md:col-span-full 2xl:col-span-1" />
          </div>
        </LayoutGroup>
      )}

      <AnimatePresence>
        {takeoverTeam && (
          <motion.div
            key={takeover!.at}
            role="status"
            data-testid="lead-takeover"
            initial={animate ? { opacity: 0, y: 24, scale: 0.96 } : { opacity: 0 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-none fixed inset-x-0 bottom-28 z-40 mx-auto flex w-fit items-center gap-4 rounded-2xl border px-6 py-3 backdrop-blur-md"
            style={{ borderColor: `${MEDAL[1].color}88`, background: "rgba(11,17,34,0.9)", boxShadow: `0 0 44px -8px ${takeoverTeam.color}` }}
          >
            <TeamLogo team={takeoverTeam} size={64} />
            <div>
              <p className="text-xs font-bold tracking-[0.3em] text-gold">NEW LEADER</p>
              <p className="font-heading text-2xl font-extrabold text-white">{takeoverTeam.name} takes the lead!</p>
            </div>
            <Crown className="h-8 w-8 text-gold" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TeamCard({ team, leader, topValidated, animate }: { team: RankedTeam; leader: boolean; topValidated: number; animate: boolean }) {
  const m = medal(team.rank);
  const depth = DEPTH[team.rank] ?? DEPTH[3];
  const accent = team.color;
  const gap = topValidated - team.validated;
  const crest = team.rank === 1 ? "clamp(108px, 9.6vw, 200px)" : team.rank === 2 ? "clamp(96px, 8.2vw, 168px)" : "clamp(90px, 7.6vw, 152px)";
  return (
    <section
      data-testid="team-card"
      data-team={team.slug ?? team.id}
      data-rank={team.rank}
      data-leader={leader ? "true" : undefined}
      aria-label={`${team.name}, rank ${team.rank}`}
      className="relative origin-top rounded-[1.4rem] p-px transition-transform duration-500"
      style={{
        transform: `translateY(${depth.lift}px) scale(${depth.scale})`,
        // Rank frame: a gradient edge in the placement colour fading into the team colour.
        background: `linear-gradient(150deg, ${m?.color ?? accent}${team.rank === 1 ? "" : "aa"}, ${accent}55 45%, rgba(255,255,255,0.06) 70%, ${m?.color ?? accent}66)`,
        boxShadow: `${depth.shadow}, 0 0 ${team.rank === 1 ? 46 : 26}px -14px ${m?.glow ?? accent}`,
      }}
    >
      <div className="relative overflow-hidden rounded-[calc(1.4rem-1px)] bg-[#0A0F20] px-4 pb-4 pt-3.5 min-[1800px]:px-6 min-[1800px]:pb-6 min-[1800px]:pt-5">
        {/* Surface: team light, diagonal energy lines, top sheen */}
        <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(110% 70% at 18% 0%, ${accent}2e, transparent 62%), radial-gradient(80% 60% at 100% 100%, ${(team.accentSecondary ?? accent)}1f, transparent 65%)` }} />
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "repeating-linear-gradient(115deg, #fff 0 1px, transparent 1px 14px)" }} />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${m?.color ?? accent}, transparent)` }} />
        {animate && <div className={cn("teams-sweep pointer-events-none absolute inset-y-0 -left-1/3 w-1/3", team.rank === 1 ? "opacity-100" : "opacity-60")} style={{ animationDelay: `${(team.rank - 1) * 1.6}s` }} />}

        {/* Placement + members */}
        <div className="relative flex items-center justify-between gap-2">
          <span
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-heading text-sm font-extrabold tracking-wider min-[1800px]:text-base"
            style={{ color: m?.color ?? accent, background: m?.soft ?? `${accent}1f`, border: `1px solid ${(m?.color ?? accent)}66`, boxShadow: team.rank === 1 ? `0 0 18px -4px ${MEDAL[1].glow}` : undefined }}
            data-testid="team-rank"
          >
            {leader && <Crown className="h-4 w-4" aria-label="Leading team" />}
            {team.tied ? "=" : ""}
            {m?.label ?? `#${team.rank}`}
          </span>
          <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-text-secondary">
            <Users className="h-3.5 w-3.5" /> {team.memberCount} members
          </span>
        </div>

        {/* Crest + name */}
        <div className="relative mt-2 flex items-center gap-3 min-[1800px]:gap-4">
          <CrestPlate team={team} size={crest} rank={team.rank} />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold tracking-[0.28em] min-[1800px]:text-xs" style={{ color: m?.color ?? accent }}>{m?.word ?? `PLACE ${team.rank}`}</p>
            <h2
              className={cn("font-heading font-extrabold leading-tight text-white", team.rank === 1 ? "text-2xl min-[1800px]:text-[2.5rem]" : "text-xl min-[1800px]:text-[2rem]")}
              title={team.name}
              style={{ textShadow: `0 0 22px ${accent}66` }}
            >
              {team.name}
            </h2>
            <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-text-secondary min-[1800px]:text-sm" data-testid="team-gap">
              {team.rank === 1 && team.validated > 0 ? (
                <>
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-300" />
                  <span className="text-emerald-300">{team.tied ? "Sharing the lead" : "Leading the floor"}</span>
                </>
              ) : gap > 0 ? (
                <>
                  <TrendingDown className="h-3.5 w-3.5 text-amber-200" />
                  <span>
                    <b className="text-white">{gap}</b> behind 1st
                  </span>
                </>
              ) : (
                <span>Level on validated sales</span>
              )}
            </p>
          </div>
        </div>

        {/* Metrics: identical structure on every card */}
        <div className="relative mt-3 grid grid-cols-3 gap-2">
          <Metric icon={BadgeCheck} label="Validated" accent={accent} primary testId="team-validated" value={team.validated} />
          <Metric icon={Send} label="Submitted" accent={accent} testId="team-submitted" value={team.submitted} />
          <Metric icon={Percent} label="Close rate" accent={accent} testId="team-rate" text={rate(team.closeRate)} />
        </div>
      </div>
    </section>
  );
}

function Metric({ icon: Icon, label, value, text, accent, primary, testId }: { icon: typeof Users; label: string; value?: number; text?: string; accent: string; primary?: boolean; testId: string }) {
  return (
    <div
      className="relative overflow-hidden rounded-xl border px-2.5 py-2 min-[1800px]:px-3.5 min-[1800px]:py-3.5"
      style={{ borderColor: primary ? `${accent}55` : "rgba(255,255,255,0.07)", background: primary ? `linear-gradient(160deg, ${accent}1f, rgba(255,255,255,0.015))` : "rgba(255,255,255,0.025)" }}
    >
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted min-[1800px]:text-[11px]"><Icon className="h-3 w-3" />{label}</p>
      <p
        className={cn("font-heading font-extrabold tabular-nums leading-none", primary ? "mt-1 text-[2rem] min-[1800px]:text-6xl" : "mt-1.5 text-xl text-white min-[1800px]:text-4xl")}
        style={primary ? { color: accent, textShadow: `0 0 18px ${accent}77` } : undefined}
        data-testid={testId}
        data-value={value}
      >
        {value !== undefined ? <AnimatedCounter value={value} /> : text}
      </p>
    </div>
  );
}

/** Only the top 3 of the team (validated ↓, submitted ↓, name): a compact live board under the card. */
function TeamTop3({ team, fresh, animate }: { team: RankedTeam; fresh: Set<string>; animate: boolean }) {
  const top = team.members.slice(0, 3);
  return (
    <section
      className="relative overflow-hidden rounded-2xl border bg-[#0A0F20]/90"
      style={{ borderColor: `${team.color}38`, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)" }}
      data-testid="team-board"
      data-team={team.slug ?? team.id}
      aria-label={`${team.name} top 3`}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${team.color}aa, transparent)` }} />
      <header className="flex items-center justify-between gap-2 px-3 pb-1 pt-2.5 min-[1800px]:px-4 min-[1800px]:pt-3.5">
        <h3 className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.22em] min-[1800px]:text-xs" style={{ color: team.color }}>
          <Trophy className="h-3.5 w-3.5" /> TOP 3 · {team.name.toUpperCase()}
        </h3>
        <span className="hidden gap-3 text-[10px] font-semibold uppercase tracking-wider text-text-muted sm:flex min-[1800px]:text-[11px]">
          <span className="w-8 text-right min-[1800px]:w-10">Sub.</span>
          <span className="w-9 text-right min-[1800px]:w-12">Valid.</span>
          <span className="w-10 text-right min-[1800px]:w-12">Rate</span>
        </span>
      </header>
      {top.length === 0 && <p className="px-3 pb-3 pt-1 text-sm text-text-muted">No members assigned.</p>}
      <ol className="space-y-1 px-1.5 pb-2 min-[1800px]:space-y-1.5 min-[1800px]:px-2 min-[1800px]:pb-3" data-testid="team-board-rows">
        {top.map((m) => (
          <MemberRow key={m.userCode} m={m} team={team} fresh={fresh.has(`${team.id}|${m.userCode}`)} animate={animate} />
        ))}
      </ol>
    </section>
  );
}

function MemberRow({ m, team, fresh, animate }: { m: RankedMember; team: RankedTeam; fresh: boolean; animate: boolean }) {
  const md = m.validated > 0 ? medal(m.rank) : null;
  const isLeader = team.leaderUserCode === m.userCode;
  return (
    <motion.li
      layout={animate ? "position" : false}
      transition={{ type: "spring", stiffness: 320, damping: 34 }}
      data-testid="member-row"
      data-user={m.userCode}
      data-rank={m.rank}
      data-validated={m.validated}
      data-fresh={fresh ? "true" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors duration-700 min-[1800px]:gap-3 min-[1800px]:px-3 min-[1800px]:py-3",
        fresh ? "bg-emerald-400/15" : md ? "" : "",
        m.validated === 0 && "text-text-muted",
      )}
      style={!fresh && md ? { background: `linear-gradient(90deg, ${md.soft}, transparent 75%)` } : undefined}
    >
      <span
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full font-heading text-xs font-extrabold tabular-nums min-[1800px]:h-9 min-[1800px]:w-9 min-[1800px]:text-sm"
        style={md ? { background: md.color, color: "#0B1122", boxShadow: `0 0 12px ${md.glow}` } : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)" }}
        aria-label={`Rank ${m.rank}${m.tied ? " (tied)" : ""}`}
      >
        {m.rank}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={cn("truncate text-sm font-semibold min-[1800px]:text-lg", m.validated > 0 ? "text-white" : "")} title={m.name}>{m.name}</span>
          {isLeader && <Crown className="h-3.5 w-3.5 shrink-0 text-gold" aria-label="Team leader" />}
          {m.former && <span className="shrink-0 rounded bg-white/5 px-1 text-[9px] uppercase text-text-muted" title="Left the team during this period">left</span>}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          {m.designation ? <DesignationChip d={m.designation} /> : <span className="text-[10px] text-text-muted">—</span>}
          <span className="text-[10px] text-text-muted sm:hidden">{m.submitted} sub. · {rate(m.closeRate)}</span>
        </span>
      </span>
      <span className="hidden w-8 text-right text-sm tabular-nums text-text-secondary sm:block min-[1800px]:w-10 min-[1800px]:text-lg" data-testid="member-submitted">{m.submitted}</span>
      <span className={cn("w-9 text-right font-heading text-lg font-extrabold tabular-nums min-[1800px]:w-12 min-[1800px]:text-3xl", m.validated > 0 && "text-white")} data-testid="member-validated">{m.validated}</span>
      <span className="hidden w-10 text-right text-xs tabular-nums text-text-secondary sm:block min-[1800px]:w-12 min-[1800px]:text-base">{rate(m.closeRate)}</span>
    </motion.li>
  );
}

function DesignationChip({ d }: { d: "senior" | "junior" }) {
  return (
    <span className={cn("rounded px-1.5 py-px text-[10px] font-bold tracking-wider", d === "senior" ? "bg-secondary/15 text-secondary" : "bg-[#A855F7]/15 text-[#C9A3FF]")} data-testid="designation">
      {d === "senior" ? "SR" : "JR"}
    </span>
  );
}

/** Top performers across all teams: a podium-style live summary. */
function TopPerformers({ top, animate, className }: { top: TopPerformer[]; animate: boolean; className?: string }) {
  const [first, ...rest] = top;
  return (
    <section
      className={cn("relative overflow-hidden rounded-[1.4rem] border border-[#F5C451]/25 bg-[#0A0F20]/90 p-4 min-[1800px]:p-5", className)}
      style={{ boxShadow: "0 24px 50px -30px rgba(0,0,0,0.9), 0 0 30px -18px rgba(245,196,81,0.5)" }}
      data-testid="teams-top3"
      aria-label="Top performers across all teams"
    >
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(90% 55% at 50% 0%, rgba(245,196,81,0.14), transparent 65%), radial-gradient(70% 50% at 100% 100%, rgba(117,104,255,0.12), transparent 70%)" }} />
      <h2 className="relative flex items-center gap-2 text-xs font-bold tracking-[0.24em] text-gold min-[1800px]:text-sm">
        <Trophy className="h-4 w-4" /> TOP PERFORMERS — ALL TEAMS
      </h2>

      {top.length === 0 ? (
        <div className="relative mt-4 space-y-2" data-testid="teams-top3-empty">
          <div className="grid place-items-center rounded-2xl border border-dashed border-[#F5C451]/30 px-4 py-6 text-center">
            <Trophy className="h-10 w-10 text-[#F5C451]/50" />
            <p className="mt-2 font-heading text-base font-bold text-white">The podium is open</p>
            <p className="mt-0.5 text-sm text-text-muted">The first validated sale of the period takes the top spot.</p>
          </div>
          {[2, 3].map((r) => (
            <div key={r} className="flex items-center gap-3 rounded-xl border border-white/[0.06] px-3 py-2 opacity-60">
              <span className="grid h-8 w-8 place-items-center rounded-full border text-xs font-bold" style={{ borderColor: `${MEDAL[r as 2 | 3].color}66`, color: MEDAL[r as 2 | 3].color }}>{r}</span>
              <span className="h-2.5 w-28 rounded-full bg-white/[0.06]" />
            </div>
          ))}
        </div>
      ) : (
        <ol className="relative mt-3 grid gap-2 sm:grid-cols-3 2xl:grid-cols-1 min-[1800px]:gap-3">
          {first && <Performer key={`${first.teamId}|${first.userCode}`} p={first} big animate={animate} />}
          {rest.map((p) => (
            <Performer key={`${p.teamId}|${p.userCode}`} p={p} animate={animate} />
          ))}
        </ol>
      )}
    </section>
  );
}

function Performer({ p, big, animate }: { p: TopPerformer; big?: boolean; animate: boolean }) {
  const m = medal(p.rank)!;
  return (
    <motion.li
      layout={animate ? "position" : false}
      data-testid="top-performer"
      data-user={p.userCode}
      data-rank={p.rank}
      className={cn("relative flex items-center gap-3 overflow-hidden rounded-2xl border", big ? "px-3.5 py-3.5 min-[1800px]:px-4 min-[1800px]:py-6" : "px-3 py-2.5 min-[1800px]:px-4 min-[1800px]:py-4")}
      style={{ borderColor: `${m.color}${big ? "99" : "55"}`, background: `linear-gradient(100deg, ${m.soft}, rgba(10,15,32,0.2) 70%)`, boxShadow: big ? `0 0 26px -10px ${m.glow}` : undefined }}
    >
      <span className="relative shrink-0">
        <span
          className={cn("grid place-items-center rounded-full font-heading font-extrabold text-white", big ? "h-14 w-14 text-base min-[1800px]:h-16 min-[1800px]:w-16 min-[1800px]:text-lg" : "h-10 w-10 text-xs min-[1800px]:h-12 min-[1800px]:w-12 min-[1800px]:text-sm")}
          style={{ background: `radial-gradient(circle at 35% 30%, ${p.teamColor}66, ${p.teamColor}22)`, boxShadow: `0 0 0 2px ${m.color}, 0 0 16px ${m.glow}` }}
          aria-hidden
        >
          {initials(p.name)}
        </span>
        <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full font-heading text-[10px] font-extrabold text-[#0B1122] min-[1800px]:h-6 min-[1800px]:w-6 min-[1800px]:text-xs" style={{ background: m.color }}>{p.rank}</span>
        {big && <Crown className="absolute -top-3 left-1/2 h-5 w-5 -translate-x-1/2 text-gold drop-shadow-[0_0_8px_rgba(245,196,81,0.9)]" aria-label="Top performer" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate font-semibold text-white", big ? "text-base min-[1800px]:text-xl" : "text-sm min-[1800px]:text-lg")} title={p.name}>{p.name}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-text-muted">
          {/* eslint-disable-next-line @next/next/no-img-element -- official team artwork */}
          {p.teamLogoUrl && <img src={p.teamLogoUrl} alt="" width={18} height={18} className="h-[18px] w-[18px] object-contain" />}
          <span className="truncate" style={{ color: p.teamColor }}>{p.teamName}</span>
          {p.designation && <DesignationChip d={p.designation} />}
        </p>
      </div>
      <div className="text-right">
        <p className={cn("font-heading font-extrabold tabular-nums leading-none text-white", big ? "text-3xl min-[1800px]:text-4xl" : "text-xl min-[1800px]:text-3xl")} style={big ? { color: m.color, textShadow: `0 0 16px ${m.glow}` } : undefined}>{p.validated}</p>
        <p className="mt-1 text-[10px] uppercase tracking-wider text-text-muted">{p.submitted} sub.</p>
      </div>
    </motion.li>
  );
}
