"use client";

import { memo } from "react";
import { motion, LayoutGroup } from "motion/react";
import { Crown, Trophy, Medal, Users } from "lucide-react";
import type { CloserRow } from "@/shared/sales/leads";
import { useSettingsStore } from "@/frontend/stores/settings-store";
import { cn } from "@/shared/utils";
import { EarnedBonus } from "@/frontend/components/arena/EarnedBonus";

const PLACES = [
  { label: "1ST", name: "Gold", icon: Crown, color: "#FFC857", ring: "rgba(255,200,87,0.6)", glow: "rgba(255,200,87,0.35)", grad: "linear-gradient(135deg, #FFE08A, #E8A317)", tint: "rgba(255,200,87,0.13)" },
  { label: "2ND", name: "Silver", icon: Trophy, color: "#D7DEEA", ring: "rgba(215,222,234,0.45)", glow: "rgba(215,222,234,0.2)", grad: "linear-gradient(135deg, #F1F4FA, #9AA4B6)", tint: "rgba(215,222,234,0.08)" },
  { label: "3RD", name: "Bronze", icon: Medal, color: "#E0915A", ring: "rgba(224,145,90,0.5)", glow: "rgba(224,145,90,0.25)", grad: "linear-gradient(135deg, #F2B27D, #B4652E)", tint: "rgba(224,145,90,0.1)" },
];

type Tier = "daily" | "weekly" | "monthly";
const LEADER_WORD: Record<Tier, string> = { daily: "WEEK LEADER", weekly: "WEEKLY CHAMPION", monthly: "MONTHLY CHAMPION" };

/**
 * Gold / silver / bronze podium for the top closers of a period (ranking unchanged: validated sales, then submitted
 * leads). Adapts to how many closers there are: one → a centred champion card, two → a balanced pair, three → the
 * full podium. Never shows placeholders. Someone with no validated sale is never called a validated-sales champion,
 * and a tie on validated sales decided by submitted leads says so.
 */
export const TopPerformersPodium = memo(function TopPerformersPodium({
  rows,
  title,
  subtitle,
  testId,
  bonusPeriod,
  tier = "weekly",
}: {
  rows: CloserRow[];
  title: string;
  subtitle: string;
  testId?: string;
  bonusPeriod?: "day" | "week" | "month";
  tier?: Tier;
}) {
  const animate = useSettingsStore((s) => s.leaderboardAnimations);
  const top = rows.slice(0, 3);
  const n = top.length;
  const monthly = tier === "monthly";
  const compact = tier === "daily";
  // Display order: 3 → 2nd, 1st, 3rd (champion in the centre); 2 → 1st, 2nd; 1 → the champion alone.
  const order = n === 3 ? [1, 0, 2] : n === 2 ? [0, 1] : [0];

  const tagFor = (r: CloserRow, idx: number): string => {
    if (r.counts.validated === 0) return "LEADING ON SUBMITTED LEADS";
    const next = top[idx + 1];
    const prev = top[idx - 1];
    if ((next && next.counts.validated === r.counts.validated) || (prev && prev.counts.validated === r.counts.validated)) {
      return idx === 0 ? "AHEAD ON SUBMITTED LEADS" : `${PLACES[idx].name.toUpperCase()} · TIE ON VALIDATED`;
    }
    return idx === 0 ? LEADER_WORD[tier] : `${PLACES[idx].name.toUpperCase()} FINALIST`;
  };

  return (
    <section
      aria-label={title}
      data-testid={testId}
      data-count={n}
      className={cn(
        "relative overflow-hidden rounded-3xl border bg-gradient-to-b p-5 lg:px-6",
        compact ? "lg:py-4" : "lg:py-5",
        monthly ? "border-gold/30 from-[#1C1438]/95 via-[#120F2C]/95 to-[#0A0F20]/95 shadow-[0_40px_90px_-50px_rgba(255,200,87,0.55)]" : "border-gold/20 from-[#16123A]/90 to-[#0B1122]/90",
      )}
    >
      <div className={cn("ac-podium-spot", monthly && "ac-podium-spot--monthly")} aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
      <div className={cn("relative flex flex-wrap items-end justify-between gap-2", compact ? "mb-3" : "mb-4")}>
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-gold/35 bg-gold/10 shadow-[0_0_20px_-6px_rgba(255,200,87,0.6)]">
            <Trophy className="h-5 w-5 text-gold" />
          </span>
          <div>
            <h2 className={cn("font-heading font-extrabold tracking-tight text-white", monthly ? "text-2xl lg:text-[1.7rem]" : "text-xl lg:text-2xl")}>{title}</h2>
            <p className="text-xs text-text-muted">{subtitle}</p>
          </div>
        </div>
        {n > 0 && n < 3 && (
          <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold text-text-secondary">
            <Users className="h-3.5 w-3.5" /> {n} ranked closer{n === 1 ? "" : "s"} so far
          </span>
        )}
      </div>

      {n === 0 ? (
        <div className="ac-empty relative">
          <span className="ac-empty__icon">
            <Trophy className="h-5 w-5 text-gold" />
          </span>
          <p className="text-sm font-semibold text-text-secondary">No validated sales yet.</p>
          <p className="text-xs text-text-muted">The podium fills as soon as the first sale is validated.</p>
        </div>
      ) : (
        <LayoutGroup>
          <ol
            className={cn(
              "relative grid gap-4",
              n === 3 && "sm:grid-cols-3 sm:items-start",
              n === 2 && "mx-auto max-w-[980px] sm:grid-cols-2 sm:items-start",
              n === 1 && "mx-auto max-w-[700px]",
            )}
          >
            {order.map((idx) => {
              const r = top[idx];
              const p = PLACES[idx];
              const Icon = r.counts.validated === 0 && idx === 0 ? Users : p.icon;
              const rate = Math.round(r.rate);
              const champ = idx === 0;
              const solo = n === 1;
              return (
                <motion.li
                  key={r.agent.id}
                  layout={animate ? "position" : false}
                  transition={{ type: "spring", stiffness: 320, damping: 30 }}
                  data-rank={idx + 1}
                  data-code={r.code}
                  className={cn(
                    "@container relative flex min-w-0 overflow-hidden rounded-2xl border px-4 text-center",
                    solo ? "flex-col items-center sm:grid sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-6 sm:px-7 sm:text-left" : "flex-col items-center",
                    compact ? "pb-3 pt-3" : "pb-4 pt-4",
                    champ && n === 3 && "order-first sm:order-none",
                    !champ && n === 3 && (idx === 1 ? (compact ? "sm:mt-4" : "sm:mt-8") : compact ? "sm:mt-6" : "sm:mt-12"),
                    !champ && n === 2 && (compact ? "sm:mt-4" : "sm:mt-8"),
                  )}
                  style={{
                    borderColor: champ ? "transparent" : p.ring,
                    background: `radial-gradient(90% 70% at 50% 0%, ${p.tint}, transparent 70%), linear-gradient(180deg, rgba(22,26,52,0.92), rgba(10,14,30,0.94))`,
                    boxShadow: champ ? `0 0 ${monthly ? 80 : 56}px -16px ${p.glow}` : `0 20px 40px -30px ${p.glow}`,
                  }}
                >
                  {champ && <span className="ac-champ-ring" aria-hidden />}
                  {champ && r.counts.validated > 0 && <span className="ac-champ-sheen" aria-hidden />}

                  {/* Medal + rank */}
                  <div className={cn("relative flex flex-col items-center", solo && "sm:py-1")}>
                    <motion.div animate={champ && animate ? { y: [0, -4, 0] } : undefined} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }} className="mb-1">
                      <Icon className={cn(champ ? "h-7 w-7" : "h-6 w-6")} style={{ color: p.color, filter: `drop-shadow(0 0 10px ${p.glow})` }} />
                    </motion.div>
                    <div
                      className={cn("grid place-items-center rounded-2xl font-heading font-extrabold", champ && !compact ? "h-14 w-14 text-2xl" : "h-12 w-12 text-xl")}
                      style={{ background: p.grad, color: "#1A1206", boxShadow: `0 0 22px ${p.glow}` }}
                    >
                      {idx + 1}
                    </div>
                  </div>

                  {/* Name, code, standing */}
                  <div className={cn("relative w-full min-w-0", solo && "sm:w-auto")}>
                    <div
                      className={cn("mt-2 w-full truncate font-heading font-bold text-white", champ ? "text-[clamp(1.05rem,8cqi,1.45rem)]" : "text-[clamp(0.95rem,9cqi,1.15rem)]", solo && "sm:mt-0 sm:text-2xl")}
                      title={r.agent.name}
                    >
                      {r.agent.name}
                    </div>
                    <div className="text-[11px] font-medium text-text-muted tabular">{r.code}</div>
                    {(!compact || champ || r.counts.validated === 0) && <div
                      className={cn("mt-1.5 inline-flex max-w-full items-center truncate rounded-full border px-2.5 py-0.5 text-[10px] font-bold tracking-[0.14em]")}
                      style={{ borderColor: `${p.color}55`, color: p.color, background: `${p.color}14` }}
                      data-testid="podium-standing"
                    >
                      {tagFor(r, idx)}
                    </div>}
                    {solo && bonusPeriod && (
                      <div className="hidden sm:block">
                        <EarnedBonus code={r.code} period={bonusPeriod} variant="podium" />
                      </div>
                    )}
                  </div>

                  {/* Numbers */}
                  <div className={cn("relative flex w-full flex-col items-center", solo && "sm:w-[15rem]")}>
                    <div
                      className={cn("mt-2 font-heading font-black leading-none tabular", champ ? (monthly ? "text-[clamp(2.2rem,26cqi,3.4rem)]" : "text-[clamp(2rem,24cqi,3rem)]") : "text-[clamp(1.75rem,22cqi,2.5rem)]", solo && "sm:mt-0 sm:text-6xl")}
                      style={{ color: p.color, textShadow: champ ? `0 0 26px ${p.glow}` : undefined }}
                      data-col="validated"
                    >
                      {r.counts.validated}
                    </div>
                    <div className="text-[10px] font-bold tracking-[0.2em] text-text-muted">VALIDATED</div>
                    {bonusPeriod && <div className={cn(solo && "sm:hidden")}><EarnedBonus code={r.code} period={bonusPeriod} variant="podium" /></div>}
                    <div className="mt-2 grid w-full grid-cols-1 gap-2 text-left @[13rem]:grid-cols-2">
                      <div className="rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Submitted</div>
                        <div className="font-heading text-lg font-bold text-white tabular" data-col="submitted">{r.counts.submitted}</div>
                      </div>
                      <div className="rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Closed rate</div>
                        <div className="font-heading text-lg font-bold text-white tabular" data-col="rate">{rate}%</div>
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.min(100, rate)}%`, background: p.grad }} />
                    </div>
                  </div>
                </motion.li>
              );
            })}
          </ol>
        </LayoutGroup>
      )}
    </section>
  );
});
