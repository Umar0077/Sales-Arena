"use client";

import { useEffect } from "react";
import { Trophy } from "lucide-react";
import { useSpinBoardStore } from "@/frontend/stores/spin-board-store";
import { useArenaStore } from "@/frontend/stores/arena-store";
import { RewardIconView } from "@/frontend/components/brand/RewardIconView";
import { AgentEmoji } from "@/frontend/components/celebrations/AgentEmoji";
import type { RewardIcon } from "@/shared/types";

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase() || "FE";

function formatShortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * Compact display of actual completed spin prize winners from PostgreSQL
 * (/api/arena/spin/recent-winners), shown on Daily, Weekly, and Monthly Arena.
 */
export function RecentSpinWinners({ limit = 6 }: { limit?: number }) {
  const winners = useSpinBoardStore((s) => s.winners);
  const winnersLoaded = useSpinBoardStore((s) => s.winnersLoaded);
  const refreshWinners = useSpinBoardStore((s) => s.refreshWinners);
  const dataSourceMode = useArenaStore((s) => s.dataSourceMode);
  const agents = useArenaStore((s) => s.agents);

  useEffect(() => {
    if (!winnersLoaded && dataSourceMode === "production") {
      void refreshWinners();
    }
  }, [winnersLoaded, dataSourceMode, refreshWinners]);

  if (dataSourceMode !== "production") return null;

  const visible = winners.slice(0, limit);

  return (
    <section
      aria-label="Recent spin prize winners"
      data-testid="recent-spin-winners"
      className="rounded-2xl border border-white/10 bg-[#0D1426]/80 p-4 backdrop-blur-md"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-gold" />
          <h3 className="font-heading text-xs font-extrabold uppercase tracking-[0.2em] text-white">
            RECENT SPIN WINNERS
          </h3>
        </div>
        <span className="rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gold">
          PRIZES
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="py-3 text-xs text-text-muted">No completed spin prizes recorded yet.</p>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((w) => {
            const matched = agents.find((a) => a.userCode === w.user_code);
            const agentId = matched?.id ?? `agt_${w.user_code}`;
            return (
              <div
                key={w.id}
                data-testid={`spin-winner-${w.id}`}
                className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5"
              >
                <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/10">
                  <AgentEmoji
                    agentId={agentId}
                    name={w.name}
                    className="h-9 w-9 object-contain"
                    fallback={
                      <span className="text-xs font-bold text-white">{initialsOf(w.name)}</span>
                    }
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-white">{w.name}</div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: w.reward_color || "#FFC857" }}>
                    <RewardIconView icon={(w.reward_icon || "gift") as RewardIcon} className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{w.reward_title}</span>
                    {w.mode === "admin_demo_historical_result" && (
                      <span className="rounded border border-gold/30 bg-gold/10 px-1 py-0 text-[9px] uppercase tracking-wider text-gold">
                        Historical
                      </span>
                    )}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] text-text-muted tabular">
                  {formatShortTime(w.created_at)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
