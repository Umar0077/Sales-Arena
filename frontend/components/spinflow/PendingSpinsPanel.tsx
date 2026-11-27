"use client";

import { useEffect } from "react";
import { Disc3, Sparkles } from "lucide-react";
import { useSpinBoardStore } from "@/frontend/stores/spin-board-store";
import { useSpinFlowStore } from "@/frontend/stores/spin-flow-store";
import { useSettingsStore } from "@/frontend/stores/settings-store";
import { useArenaStore } from "@/frontend/stores/arena-store";
import { AgentEmoji } from "@/frontend/components/celebrations/AgentEmoji";
import { useArenaTheme } from "@/frontend/theme/arena-theme";
import { cn } from "@/shared/utils";

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase() || "FE";

/**
 * Persistent, non-blocking "SPIN AVAILABLE" invitation dock backed by PostgreSQL
 * (/api/arena/spin/pending). Remains visible across refreshes and reconnects until
 * each agent's pending spin credits are consumed.
 */
export function PendingSpinsPanel() {
  const { isChristmas } = useArenaTheme();
  const pending = useSpinBoardStore((s) => s.pending);
  const pendingLoaded = useSpinBoardStore((s) => s.pendingLoaded);
  const refreshPending = useSpinBoardStore((s) => s.refreshPending);
  const spinFeatureEnabled = useSettingsStore((s) => s.spinFeatureEnabled);
  const spinFlowEnabled = useSettingsStore((s) => s.spinFlowEnabled);
  const arenaEnabled = useSettingsStore((s) => s.arenaEnabled);
  const stage = useSpinFlowStore((s) => s.stage);
  const agents = useArenaStore((s) => s.agents);

  useEffect(() => {
    if (!pendingLoaded && arenaEnabled && spinFeatureEnabled && spinFlowEnabled) {
      void refreshPending();
    }
  }, [pendingLoaded, arenaEnabled, spinFeatureEnabled, spinFlowEnabled, refreshPending]);

  if (!arenaEnabled || !spinFeatureEnabled || !spinFlowEnabled) return null;
  if (stage !== "idle" || pending.length === 0) return null;

  const launchSpin = (item: (typeof pending)[number]) => {
    const matched = agents.find((a) => a.userCode === item.user_code);
    useSpinFlowStore.getState().push({
      agentId: matched?.id ?? item.agent_id,
      userCode: item.user_code,
      agentName: item.name,
      periodSales: 0,
      available: item.available,
      reason: "launch",
      origin: "automatic",
    });
  };

  return (
    <aside
      aria-label="Pending spin invitations"
      data-testid="pending-spins-panel"
      className="pointer-events-none fixed bottom-5 left-4 z-40 flex max-w-[calc(100vw-2rem)] flex-col gap-2 sm:left-6"
    >
      <div
        className={cn(
          "pointer-events-auto flex max-h-[38vh] flex-wrap items-center gap-2.5 overflow-y-auto rounded-2xl border px-3.5 py-2.5 shadow-[0_14px_40px_-10px_rgba(0,0,0,0.75)] backdrop-blur-md",
          isChristmas
            ? "border-[#D8AF58]/45 bg-[#190B10]/90"
            : "border-gold/35 bg-[#0C1226]/90",
        )}
      >
        <div className="flex items-center gap-1.5 pr-1 text-[11px] font-extrabold uppercase tracking-[0.2em] text-gold">
          <Sparkles className="h-3.5 w-3.5" />
          <span>SPIN AVAILABLE</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {pending.map((item) => {
            const matched = agents.find((a) => a.userCode === item.user_code);
            const agentId = matched?.id ?? item.agent_id;
            return (
              <div
                key={item.user_code}
                data-testid={`pending-spin-${item.user_code}`}
                className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.05] py-1.5 pl-2 pr-2"
              >
                <div className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/10">
                  <AgentEmoji
                    agentId={agentId}
                    name={item.name}
                    className="h-8 w-8 object-contain"
                    fallback={
                      <span className="text-xs font-bold text-white">
                        {initialsOf(item.name)}
                      </span>
                    }
                  />
                </div>
                <div className="min-w-0 leading-tight">
                  <div className="max-w-[140px] truncate text-xs font-bold text-white">
                    {item.name}
                  </div>
                  <div className="text-[11px] font-semibold text-gold tabular">
                    {item.available} Spin{item.available === 1 ? "" : "s"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => launchSpin(item)}
                  data-testid={`pending-spin-cta-${item.user_code}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#FFC857] to-[#FF8A47] px-2.5 py-1.5 text-xs font-extrabold text-[#1A1206] shadow transition-transform hover:scale-[1.03] active:scale-[0.98]"
                >
                  <Disc3 className="h-3.5 w-3.5" />
                  SPIN NOW
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
