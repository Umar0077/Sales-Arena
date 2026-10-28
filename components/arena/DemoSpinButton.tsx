"use client";

import { Sparkles } from "lucide-react";
import { useArenaStore, pickData } from "@/store/arena-store";
import { useSettingsStore } from "@/store/settings-store";
import { useSpinFlowStore } from "@/store/spin-flow-store";
import { computeAllCredits } from "@/features/targets/eligibility";
import { audioEngine } from "@/lib/audio/engine";

/**
 * Presentation helper: runs the real spin journey on demand.
 * Picks the active agent closest to their target and records the demo sales they
 * still need, so the genuine "target completed → SPIN NOW" popup opens.
 * Hide it in Admin → Live Arena Controls.
 */
export function DemoSpinButton() {
  const visible = useSettingsStore((s) => s.showDemoSpinButton);
  const spinEnabled = useSettingsStore((s) => s.spinFeatureEnabled);
  const online = useSettingsStore((s) => s.arenaEnabled);
  const busy = useSpinFlowStore((s) => s.stage !== "idle" || s.queue.length > 0);

  if (!visible || !spinEnabled || !online) return null;

  const run = () => {
    if (useSpinFlowStore.getState().stage !== "idle") return;
    audioEngine.unlock();
    const store = useArenaStore.getState();
    const data = pickData(store);
    const credits = computeAllCredits(data);
    const candidates = data.agents
      .filter((a) => a.active)
      .map((a) => credits.get(a.id)!)
      .filter((c) => c && c.ruleEnabled && c.salesToNext !== null);
    const push = useSpinFlowStore.getState().push;

    if (candidates.length === 0) {
      // Spin rules are switched off: fall back to a bonus spin for someone.
      const agent = data.agents.find((a) => a.active);
      if (!agent) return;
      store.addBonusCredits(agent.id, 1);
      const c = computeAllCredits(pickData(useArenaStore.getState())).get(agent.id)!;
      push({ agentId: agent.id, periodSales: c.periodSales, available: c.available, reason: "bonus" });
      return;
    }

    const fewest = Math.min(...candidates.map((c) => c.salesToNext!));
    const pool = candidates.filter((c) => c.salesToNext === fewest);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    for (let i = 0; i < fewest; i++) {
      store.recordSale({ agentId: pick.agentId, status: "approved", source: "demo-simulator", celebrate: false });
    }
    // The arena's unlock detector queues the popup too; the queue merges duplicates.
    const after = computeAllCredits(pickData(useArenaStore.getState())).get(pick.agentId)!;
    push({ agentId: pick.agentId, periodSales: after.periodSales, available: after.available, reason: "target" });
  };

  return (
    <button
      onClick={run}
      disabled={busy}
      title="Shows the full spin journey: a demo agent hits their target, then SPIN NOW, the wheel and the prize reveal"
      data-testid="demo-spin"
      className="inline-flex h-10 items-center gap-2 rounded-xl border border-gold/40 bg-gold/10 px-3.5 text-sm font-semibold text-gold shadow-[0_6px_20px_-8px_rgba(255,200,87,0.6)] transition-all hover:bg-gold/20 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
    >
      <Sparkles className="h-4 w-4" />
      <span className="hidden sm:inline">Demo spin</span>
    </button>
  );
}
