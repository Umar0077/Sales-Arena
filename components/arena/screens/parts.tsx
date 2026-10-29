"use client";

import { Gift, Target, Trophy, Users, BadgeCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AnimatedCounter } from "@/components/arena/AnimatedCounter";
import { TimeAgo } from "@/components/common/TimeAgo";
import { formatReward } from "@/lib/rewards/engine";
import { useArenaStore } from "@/store/arena-store";
import type { BonusAward, BonusProgram } from "@/store/rewards-store";
import { cn } from "@/lib/utils";

/** Screen heading: name, active campaign rule and an honest "Demo data" label. */
export function ScreenTitle({ eyebrow, title, rule, accent, inactiveNote }: { eyebrow: string; title: string; rule?: string; accent: string; inactiveNote?: string }) {
  const dataSourceMode = useArenaStore((s) => s.dataSourceMode);

  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs font-bold tracking-[0.3em]" style={{ color: accent }}>{eyebrow}</p>
        <h1 className="font-heading text-2xl font-extrabold text-white lg:text-3xl" data-testid="arena-screen-title">{title}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {rule && (
          <span className="rounded-full border px-3 py-1.5 text-sm font-semibold" style={{ borderColor: `${accent}55`, color: accent, background: `${accent}12` }} data-testid="campaign-rule">
            {rule}
          </span>
        )}
        {inactiveNote && <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-sm font-semibold text-text-muted">{inactiveNote}</span>}
        {dataSourceMode === "production" ? (
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold tracking-[0.15em] text-emerald-400" title="Connected to Safe Quote Live Sales API">
            SAFE QUOTE LIVE
          </span>
        ) : (
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-bold tracking-[0.15em] text-text-muted" title="Numbers come from the built-in demo data until the live sales API is connected.">
            DEMO DATA
          </span>
        )}
      </div>
    </div>
  );
}

export interface Stat {
  label: string;
  value: number;
  icon: LucideIcon;
  accent: string;
  sub?: string;
  /** 0–1 progress bar. */
  progress?: number;
  format?: (v: number) => string;
  testId?: string;
}

export function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
      {stats.map((s) => {
        const Icon = s.icon;
        return (
          <div key={s.label} className="rounded-2xl border bg-[#0D1426]/80 p-4 backdrop-blur-md" style={{ borderColor: `${s.accent}33` }}>
            <div className="mb-1 flex items-start justify-between gap-2 text-xs font-semibold text-text-muted">
              <span className="min-w-0 uppercase leading-snug">{s.label}</span>
              <Icon className="h-4 w-4 shrink-0" style={{ color: s.accent }} />
            </div>
            <div className="font-heading text-3xl font-black tracking-tight text-white kpi-number tabular" data-testid={s.testId}>
              <AnimatedCounter value={s.value} formatter={s.format ?? ((v) => Math.round(v).toLocaleString("en-US"))} />
            </div>
            {s.progress !== undefined && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, s.progress * 100)}%`, background: s.accent }} />
              </div>
            )}
            {s.sub && <div className="mt-1 truncate text-[11px] text-text-muted">{s.sub}</div>}
          </div>
        );
      })}
    </div>
  );
}

export const STAT_ICONS = { Gift, Target, Trophy, Users, BadgeCheck };

/** Active campaign: the rule, how many qualified, and who is closest. */
export function CampaignCard({
  program,
  currency,
  periodWord,
  qualified,
  close,
  awardsTotal,
  active,
}: {
  program: BonusProgram | undefined;
  currency: string;
  periodWord: string;
  qualified: number;
  close: Array<{ name: string; need: number }>;
  awardsTotal: number;
  active: boolean;
}) {
  if (!program) return null;
  const accent = program.accent;
  const reward = formatReward(program.amount, program.prizeLabel, currency);
  return (
    <div className="relative overflow-hidden rounded-3xl border bg-[#0B1122]/80 p-5 backdrop-blur-xl lg:p-6" style={{ borderColor: `${accent}40` }}>
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full blur-3xl" style={{ background: `${accent}22` }} />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-72">
          <p className="text-xs font-bold tracking-[0.25em]" style={{ color: accent }}>{active ? "ACTIVE CAMPAIGN" : "CAMPAIGN PAUSED"}</p>
          <h2 className="mt-1 font-heading text-xl font-extrabold text-white">{program.name}</h2>
          <p className="mt-1 text-base text-text-secondary">
            Complete <b className="text-white">{program.salesRequired} validated sale{program.salesRequired > 1 ? "s" : ""}</b> {periodWord} to earn{" "}
            <b style={{ color: accent }}>{reward}</b>
            {program.maxAwards > 1 ? ` (up to ${program.maxAwards}× per agent)` : ""}.
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap gap-3">
          <div className="min-w-0 rounded-2xl bg-white/[0.04] px-4 py-3 text-center">
            <div className="font-heading text-[clamp(1.4rem,2.2vw,1.875rem)] font-black text-white tabular" data-testid="campaign-qualified">{qualified}</div>
            <div className="text-[10px] font-bold tracking-[0.15em] text-text-muted">QUALIFIED</div>
          </div>
          <div className="min-w-0 rounded-2xl bg-white/[0.04] px-4 py-3 text-center">
            <div className="break-words font-heading text-[clamp(1.4rem,2.2vw,1.875rem)] font-black tabular" style={{ color: accent }}>{currency} {awardsTotal.toLocaleString("en-US")}</div>
            <div className="text-[10px] font-bold tracking-[0.15em] text-text-muted">BONUSES EARNED</div>
          </div>
        </div>
      </div>
      {close.length > 0 && (
        <div className="relative mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text-muted">Closest to the bonus:</span>
          {close.map((c) => (
            <span key={c.name} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-medium text-white">
              {c.name} <span className="text-text-muted">· {c.need} to go</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Feed of awards for a program and period. */
export function AwardFeed({ title, awards, currency, accent, empty }: { title: string; awards: BonusAward[]; currency: string; accent: string; empty: string }) {
  return (
    <div className="flex h-full flex-col rounded-3xl border border-white/10 bg-[#0D1426]/90 p-5 backdrop-blur-xl lg:p-6">
      <div className="mb-4 flex items-center justify-between border-b border-white/5 pb-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4" style={{ color: accent }} />
          <h3 className="font-heading text-base font-bold tracking-tight text-white">{title}</h3>
        </div>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: `${accent}22`, color: accent }}>BONUSES</span>
      </div>
      <ul className="max-h-[420px] space-y-2.5 overflow-y-auto pr-1" data-testid="award-feed">
        {awards.length === 0 && <li className="py-8 text-center text-sm text-text-muted">{empty}</li>}
        {awards.slice(0, 12).map((a) => (
          <li key={a.id} className="flex items-center gap-3 rounded-xl border border-white/5 bg-surface/40 p-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: `${accent}1f`, color: accent }}>
              <Gift className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-white">{a.agentName}</p>
              <p className="truncate text-[11px] text-text-muted">
                {a.programName} · {a.validatedAtAward} validated · <TimeAgo iso={a.createdAt} />
              </p>
            </div>
            <span className={cn("shrink-0 font-heading text-sm font-bold tabular")} style={{ color: accent }}>
              {formatReward(a.amount, a.prizeLabel, currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
