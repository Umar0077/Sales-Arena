"use client";

import { memo } from "react";
import { motion, LayoutGroup } from "motion/react";
import { Crown, Trophy, Medal } from "lucide-react";
import type { CloserRow } from "@/features/sales/leads";
import { useSettingsStore } from "@/store/settings-store";
import { cn } from "@/lib/utils";

const PLACES = [
  { label: "1ST", icon: Crown, color: "#FFC857", ring: "rgba(255,200,87,0.6)", glow: "rgba(255,200,87,0.35)", grad: "linear-gradient(135deg, #FFE08A, #E8A317)", height: "sm:pt-4" },
  { label: "2ND", icon: Trophy, color: "#D7DEEA", ring: "rgba(215,222,234,0.45)", glow: "rgba(215,222,234,0.2)", grad: "linear-gradient(135deg, #F1F4FA, #9AA4B6)", height: "sm:mt-8" },
  { label: "3RD", icon: Medal, color: "#E0915A", ring: "rgba(224,145,90,0.5)", glow: "rgba(224,145,90,0.25)", grad: "linear-gradient(135deg, #F2B27D, #B4652E)", height: "sm:mt-12" },
];

/** Gold / silver / bronze podium for the top 3 closers of a period. */
export const TopPerformersPodium = memo(function TopPerformersPodium({ rows, title, subtitle, testId }: { rows: CloserRow[]; title: string; subtitle: string; testId?: string }) {
  const animate = useSettingsStore((s) => s.leaderboardAnimations);
  const top = rows.slice(0, 3);
  // Display order on wide screens: 2nd, 1st, 3rd.
  const order = [1, 0, 2];

  return (
    <section
      aria-label={title}
      data-testid={testId}
      className="relative overflow-hidden rounded-3xl border border-gold/20 bg-gradient-to-b from-[#16123A]/90 to-[#0B1122]/90 p-5 backdrop-blur-xl lg:p-6"
    >
      <div className="pointer-events-none absolute left-1/2 top-0 h-40 w-[70%] -translate-x-1/2 rounded-full bg-gold/10 blur-3xl" />
      <div className="relative mb-5 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-heading text-xl font-extrabold tracking-tight text-white lg:text-2xl">{title}</h2>
          <p className="text-xs text-text-muted">{subtitle}</p>
        </div>
      </div>

      {top.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-muted">No validated sales yet.</p>
      ) : (
        <LayoutGroup>
          <ol className="relative grid gap-3 sm:grid-cols-3 sm:items-start">
            {order.map((idx) => {
              const r = top[idx];
              if (!r) return <li key={`empty-${idx}`} className="hidden sm:block" />;
              const p = PLACES[idx];
              const Icon = p.icon;
              const rate = Math.round(r.rate);
              return (
                <motion.li
                  key={r.agent.id}
                  layout={animate ? "position" : false}
                  transition={{ type: "spring", stiffness: 320, damping: 30 }}
                  data-rank={idx + 1}
                  className={cn("@container relative flex min-w-0 flex-col items-center rounded-2xl border px-4 pb-4 text-center", idx === 0 ? "order-first pt-5 sm:order-none" : "pt-5", p.height)}
                  style={{
                    borderColor: p.ring,
                    background: `linear-gradient(180deg, ${p.glow.replace(/[\d.]+\)$/, "0.14)")}, rgba(11,17,34,0.85))`,
                    boxShadow: idx === 0 ? `0 0 50px -14px ${p.glow}` : undefined,
                  }}
                >
                  <motion.div
                    animate={idx === 0 ? { y: [0, -4, 0] } : undefined}
                    transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                    className="mb-2"
                  >
                    <Icon className="h-6 w-6" style={{ color: p.color, filter: `drop-shadow(0 0 10px ${p.glow})` }} />
                  </motion.div>
                  <div
                    className="grid h-14 w-14 place-items-center rounded-2xl font-heading text-xl font-extrabold"
                    style={{ background: p.grad, color: "#1A1206", boxShadow: `0 0 22px ${p.glow}` }}
                  >
                    {idx + 1}
                  </div>
                  <div className="mt-3 w-full truncate font-heading text-[clamp(0.95rem,9cqi,1.125rem)] font-bold text-white" title={r.agent.name}>{r.agent.name}</div>
                  <div className="text-[11px] font-medium text-text-muted tabular">{r.code}</div>
                  <div className="mt-3 font-heading text-[clamp(1.75rem,22cqi,2.5rem)] font-black leading-none tabular" style={{ color: p.color }} data-col="validated">
                    {r.counts.validated}
                  </div>
                  <div className="text-[10px] font-bold tracking-[0.2em] text-text-muted">VALIDATED</div>
                  <div className="mt-3 grid w-full grid-cols-1 gap-2 text-left @[13rem]:grid-cols-2">
                    <div className="rounded-xl bg-white/[0.04] px-3 py-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Submitted</div>
                      <div className="font-heading text-lg font-bold text-white tabular" data-col="submitted">{r.counts.submitted}</div>
                    </div>
                    <div className="rounded-xl bg-white/[0.04] px-3 py-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Closed rate</div>
                      <div className="font-heading text-lg font-bold text-white tabular" data-col="rate">{rate}%</div>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.min(100, rate)}%`, background: p.grad }} />
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
