"use client";

import { Coins } from "lucide-react";
import { useArenaStore } from "@/frontend/stores/arena-store";
import { useLiveStore } from "@/frontend/stores/live-store";
import { cn } from "@/shared/utils";

type Period = "day" | "week" | "month";
const WORD: Record<Period, string> = { day: "today", week: "this week", month: "this month" };

/**
 * Compact "Earned <period>: PKR x" for one agent, from PostgreSQL bonus_awards (cash, not cancelled /
 * reversed, visible programs only). Never derived from sales counts. Live mode only.
 *   row:    shown only when the agent has a real award in the period (clean rows otherwise)
 *   podium: always shows the real amount (a genuine zero is fine), "unavailable" if it failed to load
 */
export function EarnedBonus({ code, period, variant }: { code: string; period: Period; variant: "row" | "podium" }) {
  const liveMode = useArenaStore((s) => s.liveMode);
  const entry = useLiveStore((s) => s.agentBonus?.byAgent[code.toUpperCase()] ?? null);
  const fallbackCurrency = useLiveStore((s) => s.agentBonus?.currency ?? null);
  const loaded = useLiveStore((s) => s.agentBonus !== null);
  const failed = useLiveStore((s) => s.awardSummaryStatus === "error");
  if (!liveMode) return null;

  const p = entry?.[period];
  const earned = p?.earned ?? 0;
  if (!loaded) {
    if (!failed || variant === "row") return null;
    return <div className="mt-1 text-[11px] text-text-muted" data-testid="earned-bonus" data-state="unavailable">Bonus {WORD[period]}: unavailable</div>;
  }
  if (variant === "row" && earned <= 0) return null;
  const currency = entry?.currency ?? fallbackCurrency ?? "";
  const text = `${currency} ${Math.round(earned).toLocaleString("en-US")}`.trim();

  return (
    <div
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate tabular",
        variant === "row" ? "mt-0.5 text-[11px] font-semibold text-gold" : "mt-1.5 rounded-lg bg-gold/10 px-2 py-0.5 text-[11px] font-semibold text-gold",
        earned <= 0 && "bg-white/[0.04] text-text-muted",
      )}
      data-testid="earned-bonus"
      data-code={code.toUpperCase()}
      data-amount={earned}
      title={p && p.count ? `${p.count} bonus award${p.count === 1 ? "" : "s"} ${WORD[period]} (earned, not necessarily paid)` : undefined}
    >
      <Coins className="h-3 w-3 shrink-0" aria-hidden />
      Earned {WORD[period]}: {text}
    </div>
  );
}
