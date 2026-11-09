"use client";

import { Gift, Target, Trophy, Users, BadgeCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AnimatedCounter } from "@/frontend/components/arena/AnimatedCounter";
import { TimeAgo } from "@/frontend/components/common/TimeAgo";
import { formatReward } from "@/frontend/rewards/engine";
import { useArenaStore } from "@/frontend/stores/arena-store";
import type { BonusAward } from "@/frontend/stores/rewards-store";
import { cn } from "@/shared/utils";

/** Screen heading: name, active campaign rule and an honest "Demo data" label. */
export function ScreenTitle({ eyebrow, title, rule, accent, inactiveNote, tone }: { eyebrow: string; title: string; rule?: string; accent: string; inactiveNote?: string; tone?: "championship" }) {
  const dataSourceMode = useArenaStore((s) => s.dataSourceMode);
  const champ = tone === "championship";

  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="hidden h-11 w-1.5 shrink-0 rounded-full sm:block" style={{ background: champ ? "linear-gradient(180deg, #FFE08A, #7568FF)" : `linear-gradient(180deg, ${accent}, transparent)`, boxShadow: `0 0 16px ${champ ? "rgba(255,200,87,0.5)" : `${accent}66`}` }} />
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-[0.3em]" style={{ color: champ ? "#FFD978" : accent }}>{eyebrow}</p>
          <h1
            className={cn("font-heading font-extrabold text-white", champ ? "bg-gradient-to-r from-white via-[#FFF1C9] to-[#FFD978] bg-clip-text text-[clamp(1.6rem,2.2vw,2.4rem)] uppercase tracking-tight text-transparent" : "text-2xl uppercase tracking-tight lg:text-3xl")}
            data-testid="arena-screen-title"
          >
            {title}
          </h1>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {rule && (
          <span className="rounded-full border px-3 py-1.5 text-sm font-semibold" style={{ borderColor: `${accent}55`, color: accent, background: `${accent}12` }} data-testid="campaign-rule">
            {rule}
          </span>
        )}
        {inactiveNote && (
          <span
            className={cn("rounded-full border px-4 py-1.5 text-sm font-semibold", champ ? "border-gold/40 bg-gradient-to-r from-gold/15 to-primary/15 text-[#FFE7A6] shadow-[0_0_24px_-10px_rgba(255,200,87,0.7)]" : "border-white/15 bg-white/[0.06] text-text-secondary")}
            data-testid="period-date-badge"
          >
            {inactiveNote}
          </span>
        )}
        {/* Live connection status is in the header (SafeQuoteStatus); only demo data is labelled here. */}
        {dataSourceMode !== "production" && (
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
          <div key={s.label} className="ac-kpi" style={{ ["--ac" as string]: s.accent } as React.CSSProperties}>
            <div className="ac-kpi__head">
              <span className="ac-kpi__label">{s.label}</span>
              <span className="ac-kpi__icon">
                <Icon className="h-4 w-4" />
              </span>
            </div>
            <div className="font-heading font-black text-white kpi-number tabular" data-testid={s.testId}>
              <AnimatedCounter value={s.value} formatter={s.format ?? ((v) => Math.round(v).toLocaleString("en-US"))} />
            </div>
            {s.progress !== undefined && (
              <div className="ac-kpi__bar" role="progressbar" aria-valuenow={Math.round(Math.min(100, s.progress * 100))} aria-valuemin={0} aria-valuemax={100} aria-label={`${s.label} progress`}>
                <div style={{ width: `${Math.min(100, s.progress * 100)}%` }} />
              </div>
            )}
            {s.sub && <div className="ac-kpi__sub">{s.sub}</div>}
          </div>
        );
      })}
    </div>
  );
}

export const STAT_ICONS = { Gift, Target, Trophy, Users, BadgeCheck };

/** Feed of awards for a program and period. */
export function AwardFeed({ title, awards, currency, accent, empty }: { title: string; awards: BonusAward[]; currency: string; accent: string; empty: string }) {
  return (
    <div className="ac-panel flex h-full flex-col p-5 lg:p-6">
      <div className="mb-4 flex items-center justify-between border-b border-white/[0.06] pb-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: `${accent}1c`, border: `1px solid ${accent}40` }}>
            <Trophy className="h-4 w-4" style={{ color: accent }} />
          </span>
          <h3 className="font-heading text-base font-bold tracking-wide text-white">{title}</h3>
        </div>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: `${accent}22`, color: accent }}>BONUSES</span>
      </div>
      <ul className="max-h-[420px] space-y-2.5 overflow-y-auto pr-1" data-testid="award-feed">
        {awards.length === 0 && (
          <li className="ac-empty">
            <span className="ac-empty__icon">
              <Gift className="h-5 w-5" style={{ color: accent }} />
            </span>
            <span className="text-sm font-semibold text-text-secondary">{empty}</span>
            <span className="text-xs text-text-muted">Bonus achievements appear here the moment they are earned.</span>
          </li>
        )}
        {awards.slice(0, 12).map((a) => (
          <li key={a.id} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-gradient-to-r from-white/[0.04] to-transparent p-3">
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
              {formatReward(a.amount, a.prizeLabel, a.currency ?? currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
