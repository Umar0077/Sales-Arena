"use client";

import { Sparkles } from "lucide-react";
import { useSettingsStore } from "@/store/settings-store";
import { useSpinFlowStore, DEMO_AGENT } from "@/store/spin-flow-store";
import { audioEngine } from "@/lib/audio/engine";
import { useArenaMode } from "@/store/arena-mode-store";

/**
 * Showcase only, and only on the Spin & Win screen: runs the full popup → wheel → prize
 * journey for a labelled "Demo Spin". It records no sale, grants no credit, touches no
 * prize stock and sends nothing to the server. Hide it in Admin → Live Arena Controls.
 */
export function DemoSpinButton() {
  const visible = useSettingsStore((s) => s.showDemoSpinButton);
  const spinEnabled = useSettingsStore((s) => s.spinFeatureEnabled);
  const online = useSettingsStore((s) => s.arenaEnabled);
  const busy = useSpinFlowStore((s) => s.stage !== "idle" || s.queue.length > 0);
  const mode = useArenaMode();

  if (!visible || !online || !spinEnabled || mode !== "spin") return null;

  const run = () => {
    if (useSpinFlowStore.getState().stage !== "idle") return;
    audioEngine.unlock();
    useSpinFlowStore.getState().push({ agentId: DEMO_AGENT.id, periodSales: 2, available: 1, reason: "target", demo: true });
  };

  return (
    <button
      onClick={run}
      disabled={busy}
      title="Demonstration only: shows the spin journey with a demo identity. Nothing is saved."
      data-testid="demo-spin"
      className="inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-gold/40 bg-gold/10 px-3.5 text-sm font-semibold text-gold shadow-[0_6px_20px_-8px_rgba(255,200,87,0.6)] transition-all hover:bg-gold/20 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
    >
      <Sparkles className="h-4 w-4" />
      <span className="hidden sm:inline">Demo spin</span>
    </button>
  );
}
