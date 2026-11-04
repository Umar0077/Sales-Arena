"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Crown, Send, BadgeCheck, Percent, Users, Trophy, ShieldAlert } from "lucide-react";
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
const MEDAL = {
  1: { color: "#F5C451", glow: "rgba(245,196,81,0.45)", label: "1ST" },
  2: { color: "#C9D1E0", glow: "rgba(201,209,224,0.32)", label: "2ND" },
  3: { color: "#D08A4F", glow: "rgba(208,138,79,0.32)", label: "3RD" },
} as const;
const medal = (rank: number) => MEDAL[rank as 1 | 2 | 3] ?? null;
const PERIOD_KEY = "sales-arena:teams-period";

const initials = (name: string) => {
  const p = name.trim().split(/\s+/);
  return ((p.length > 1 ? p[0][0] + p[p.length - 1][0] : name.slice(0, 2)) || "?").toUpperCase();
};
const rate = (v: number | null) => (v === null ? "—" : `${v.toFixed(v >= 10 ? 0 : 1)}%`);

function TeamLogo({ team, size, className }: { team: Pick<RankedTeam, "logoUrl" | "name" | "color">; size: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!team.logoUrl || broken)
    return (
      <div className={cn("grid shrink-0 place-items-center rounded-2xl font-heading font-extrabold text-white", className)} style={{ width: size, height: size, background: `${team.color}22`, border: `1px solid ${team.color}66` }} aria-label={team.name}>
        {initials(team.name.replace(/^team\s+/i, ""))}
      </div>
    );
  // eslint-disable-next-line @next/next/no-img-element -- official artwork from /public or an Admin upload (data URL)
  return <img src={team.logoUrl} alt={`${team.name} logo`} width={size} height={size} onError={() => setBroken(true)} className={cn("shrink-0 rounded-2xl object-cover", className)} style={{ width: size, height: size }} draggable={false} />;
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

  return (
    <div className="mx-auto flex w-full max-w-[1880px] flex-1 flex-col gap-4 px-3 pt-3 sm:px-5 lg:gap-5" data-testid="teams-screen">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-[0.3em] text-secondary">TEAMS ARENA</p>
          <h1 className="font-heading text-2xl font-extrabold text-white lg:text-3xl" data-testid="arena-screen-title">
            Team Competition <span className="text-text-secondary">— Validated Sales</span>
          </h1>
          <p className="mt-0.5 text-sm text-text-muted" data-testid="teams-period-label">{data?.label ?? " "}</p>
        </div>
        <div role="tablist" aria-label="Team competition period" className="flex rounded-xl border border-white/[0.08] bg-[#0B1122]/80 p-1">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={period === p.id}
              data-testid={`teams-period-${p.id}`}
              onClick={() => choose(p.id)}
              className={cn(
                "rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary",
                period === p.id ? "bg-gradient-to-r from-primary to-[#8B5CFF] text-white shadow-[0_0_18px_-4px_rgba(117,104,255,0.9)]" : "text-text-secondary hover:text-white",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {!data && status === "loading" && <div className="h-64 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]" aria-busy="true" />}
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
          <div className="grid gap-4 xl:grid-cols-12">
            <div className="grid gap-4 md:grid-cols-3 xl:col-span-9">
              {data.teams.map((t) => (
                <TeamCard key={t.id} team={t} leader={data.leaderTeamId === t.id} animate={animate} />
              ))}
            </div>
            <TopThree top={data.top} animate={animate} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3" data-testid="team-boards">
            {[...data.teams].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)).map((t) => (
              <TeamBoard key={t.id} team={t} fresh={fresh} animate={animate} />
            ))}
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
            style={{ borderColor: `${takeoverTeam.color}88`, background: "rgba(11,17,34,0.88)", boxShadow: `0 0 40px -8px ${takeoverTeam.color}` }}
          >
            <TeamLogo team={takeoverTeam} size={56} />
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

function TeamCard({ team, leader, animate }: { team: RankedTeam; leader: boolean; animate: boolean }) {
  const m = medal(team.rank);
  return (
    <motion.section
      layout={animate ? "position" : false}
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      data-testid="team-card"
      data-team={team.slug ?? team.id}
      data-rank={team.rank}
      data-leader={leader ? "true" : undefined}
      aria-label={`${team.name}, rank ${team.rank}`}
      className={cn("relative overflow-hidden rounded-2xl border bg-[#0B1122]/85 p-4", leader && animate && "teams-leader-glow")}
      style={{
        borderColor: m ? `${m.color}${leader ? "" : "88"}` : `${team.color}55`,
        boxShadow: m ? `0 0 ${leader ? 38 : 22}px -10px ${m.glow}, inset 0 1px 0 rgba(255,255,255,0.04)` : undefined,
      }}
    >
      <div className="pointer-events-none absolute inset-0 opacity-60" style={{ background: `radial-gradient(120% 80% at 0% 0%, ${team.color}22, transparent 60%), radial-gradient(90% 60% at 100% 100%, ${team.accentSecondary ?? team.color}18, transparent 60%)` }} />
      <div className="relative flex items-center gap-3">
        <div className="relative">
          <TeamLogo team={team} size={88} className="2xl:!h-[120px] 2xl:!w-[120px]" />
          {leader && <Crown className="absolute -top-3 left-1/2 h-6 w-6 -translate-x-1/2 text-gold drop-shadow-[0_0_8px_rgba(245,196,81,0.9)]" aria-label="Leading team" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded-md px-2 py-0.5 font-heading text-xs font-extrabold" style={{ color: m?.color ?? team.color, background: `${m?.color ?? team.color}1f`, border: `1px solid ${m?.color ?? team.color}55` }} data-testid="team-rank">
              {team.tied ? "=" : ""}
              {m?.label ?? `#${team.rank}`}
            </span>
            <span className="text-xs text-text-muted">{team.memberCount} members</span>
          </div>
          <h2 className="truncate font-heading text-xl font-extrabold text-white 2xl:text-3xl" title={team.name} style={{ textShadow: `0 0 18px ${team.color}55` }}>{team.name}</h2>
        </div>
      </div>
      <div className="relative mt-3 grid grid-cols-3 gap-2">
        <Stat icon={BadgeCheck} label="Validated" value={team.validated} accent={team.color} big testId="team-validated" />
        <Stat icon={Send} label="Submitted" value={team.submitted} accent={team.color} testId="team-submitted" />
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
          <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted"><Percent className="h-3 w-3" />Close rate</p>
          <p className="font-heading text-xl font-bold text-white 2xl:text-3xl" data-testid="team-rate">{rate(team.closeRate)}</p>
        </div>
      </div>
    </motion.section>
  );
}

function Stat({ icon: Icon, label, value, accent, big, testId }: { icon: typeof Users; label: string; value: number; accent: string; big?: boolean; testId: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
      <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted"><Icon className="h-3 w-3" />{label}</p>
      <p className={cn("font-heading font-extrabold tabular-nums", big ? "text-3xl 2xl:text-5xl" : "text-xl text-white 2xl:text-3xl")} style={big ? { color: accent, textShadow: `0 0 16px ${accent}66` } : undefined} data-testid={testId} data-value={value}>
        <AnimatedCounter value={value} />
      </p>
    </div>
  );
}

function TopThree({ top, animate }: { top: TopPerformer[]; animate: boolean }) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#0B1122]/85 p-4 xl:col-span-3" data-testid="teams-top3" aria-label="Top 3 performers across all teams">
      <h2 className="flex items-center gap-2 text-xs font-bold tracking-[0.25em] text-gold"><Trophy className="h-4 w-4" />TOP 3 PERFORMERS — ALL TEAMS</h2>
      {top.length === 0 && <p className="mt-3 text-sm text-text-muted">No validated sales yet in this period.</p>}
      <ol className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
        {top.map((p) => {
          const m = medal(p.rank)!;
          return (
            <motion.li
              key={`${p.teamId}|${p.userCode}`}
              layout={animate ? "position" : false}
              data-testid="top-performer"
              data-user={p.userCode}
              data-rank={p.rank}
              className="flex items-center gap-3 rounded-xl border px-3 py-2"
              style={{ borderColor: `${m.color}66`, background: `linear-gradient(90deg, ${m.color}14, transparent 70%)` }}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-heading text-sm font-extrabold text-[#0B1122]" style={{ background: m.color, boxShadow: `0 0 14px ${m.glow}` }}>{p.rank}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-white 2xl:text-lg" title={p.name}>{p.name}</p>
                <p className="flex items-center gap-1.5 text-xs text-text-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element -- official team artwork */}
                  {p.teamLogoUrl && <img src={p.teamLogoUrl} alt="" width={16} height={16} className="h-4 w-4 rounded" />}
                  <span className="truncate" style={{ color: p.teamColor }}>{p.teamName}</span>
                  {p.designation && <DesignationChip d={p.designation} />}
                </p>
              </div>
              <div className="text-right">
                <p className="font-heading text-xl font-extrabold text-white tabular-nums 2xl:text-3xl">{p.validated}</p>
                <p className="text-[10px] uppercase tracking-wider text-text-muted">{p.submitted} sub.</p>
              </div>
            </motion.li>
          );
        })}
      </ol>
    </section>
  );
}

function DesignationChip({ d }: { d: "senior" | "junior" }) {
  return (
    <span className={cn("rounded px-1.5 py-px text-[10px] font-bold tracking-wider", d === "senior" ? "bg-secondary/15 text-secondary" : "bg-[#A855F7]/15 text-[#C9A3FF]")} data-testid="designation">
      {d === "senior" ? "SR" : "JR"}
    </span>
  );
}

function TeamBoard({ team, fresh, animate }: { team: RankedTeam; fresh: Set<string>; animate: boolean }) {
  const best = Math.max(1, ...team.members.map((m) => m.validated));
  const members = useMemo(() => team.members, [team.members]);
  return (
    <section className="flex min-h-0 flex-col rounded-2xl border bg-[#0B1122]/85" style={{ borderColor: `${team.color}44` }} data-testid="team-board" data-team={team.slug ?? team.id} aria-label={`${team.name} leaderboard`}>
      <header className="flex items-center gap-2.5 border-b border-white/[0.06] px-3 py-2.5">
        <TeamLogo team={team} size={34} />
        <h3 className="truncate font-heading text-base font-bold text-white 2xl:text-xl">{team.name}</h3>
        <span className="ml-auto text-xs text-text-muted">{members.length} {members.length === 1 ? "member" : "members"}</span>
      </header>
      <div className="grid grid-cols-[1.7rem_minmax(0,1fr)_2rem_2.4rem_2.8rem] sm:grid-cols-[2rem_minmax(0,1fr)_2.2rem_3rem_3.2rem_3.4rem] 2xl:grid-cols-[2.6rem_minmax(0,1fr)_2.8rem_4rem_4.2rem_4.4rem] items-center gap-x-1.5 px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted 2xl:text-xs">
        <span>#</span>
        <span>Agent</span>
        <span className="text-center">Role</span>
        <span className="text-right">Sub.</span>
        <span className="text-right">Valid.</span>
        <span className="hidden text-right sm:block">Rate</span>
      </div>
      {members.length === 0 && <p className="px-3 py-4 text-sm text-text-muted">No members assigned.</p>}
      <ol className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 lg:max-h-[min(52vh,30rem)] 2xl:max-h-[min(56vh,36rem)]" data-testid="team-board-rows">
        {members.map((m) => (
          <MemberRow key={m.userCode} m={m} team={team} best={best} fresh={fresh.has(`${team.id}|${m.userCode}`)} animate={animate} />
        ))}
      </ol>
    </section>
  );
}

function MemberRow({ m, team, best, fresh, animate }: { m: RankedMember; team: RankedTeam; best: number; fresh: boolean; animate: boolean }) {
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
        "relative grid grid-cols-[1.7rem_minmax(0,1fr)_2rem_2.4rem_2.8rem] sm:grid-cols-[2rem_minmax(0,1fr)_2.2rem_3rem_3.2rem_3.4rem] 2xl:grid-cols-[2.6rem_minmax(0,1fr)_2.8rem_4rem_4.2rem_4.4rem] items-center gap-x-1.5 rounded-lg px-1.5 py-1.5 text-sm transition-colors duration-700 2xl:py-2 2xl:text-lg",
        fresh ? "bg-emerald-400/15" : "odd:bg-white/[0.015]",
        m.validated === 0 && "text-text-muted",
      )}
    >
      <span className="grid h-6 w-6 place-items-center rounded-full text-xs font-bold tabular-nums 2xl:h-8 2xl:w-8 2xl:text-sm" style={md ? { background: md.color, color: "#0B1122" } : { background: "rgba(255,255,255,0.05)" }} aria-label={`Rank ${m.rank}${m.tied ? " (tied)" : ""}`}>
        {m.rank}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="hidden h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white sm:grid 2xl:h-9 2xl:w-9 2xl:text-xs" style={{ background: `${team.color}33`, border: `1px solid ${team.color}55` }} aria-hidden>
          {initials(m.name)}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1">
            <span className={cn("truncate font-medium", m.validated > 0 ? "text-white" : "")} title={m.name}>{m.name}</span>
            {isLeader && <Crown className="h-3.5 w-3.5 shrink-0 text-gold" aria-label="Team leader" />}
            {m.former && <span className="shrink-0 rounded bg-white/5 px-1 text-[9px] uppercase text-text-muted" title="Left the team during this period">left</span>}
          </span>
          <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-white/[0.05]">
            <span className="block h-full rounded-full transition-[width] duration-700" style={{ width: `${(m.validated / best) * 100}%`, background: team.color }} />
          </span>
        </span>
      </span>
      <span className="text-center">{m.designation ? <DesignationChip d={m.designation} /> : <span className="text-[10px] text-text-muted">—</span>}</span>
      <span className="text-right tabular-nums" data-testid="member-submitted">{m.submitted}</span>
      <span className={cn("text-right font-heading font-bold tabular-nums", m.validated > 0 && "text-white")} data-testid="member-validated">{m.validated}</span>
      <span className="hidden text-right tabular-nums text-text-secondary sm:block">{rate(m.closeRate)}</span>
    </motion.li>
  );
}
