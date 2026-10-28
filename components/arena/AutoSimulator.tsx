"use client";

import { useEffect } from "react";
import { useArenaStore } from "@/store/arena-store";
import { useSettingsStore } from "@/store/settings-store";
import { useSpinFlowStore } from "@/store/spin-flow-store";

/**
 * Demo-only: submits a random lead (validated, pending, rejected or duplicate) every few seconds while
 * "Auto-simulate sales" is on (Admin → Live Arena Controls). Pauses during a spin.
 */
export function AutoSimulator() {
  const enabled = useSettingsStore((s) => s.autoSimulate);
  const every = useSettingsStore((s) => s.autoSimulateEverySec);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const jitter = 0.6 + Math.random() * 0.8;
      timer = setTimeout(tick, Math.max(2, every) * 1000 * jitter);
    };
    const tick = () => {
      if (useSpinFlowStore.getState().stage === "idle") {
        const s = useArenaStore.getState();
        const pending = s.sales.filter((x) => x.status === "pending");
        if (pending.length && Math.random() < 0.3) {
          // A previously submitted lead gets validated.
          s.setLeadStatus(pending[Math.floor(Math.random() * pending.length)].id, "approved");
        } else {
          const agents = s.agents.filter((a) => a.active);
          if (agents.length) {
            const agent = agents[Math.floor(Math.random() * agents.length)];
            const r = Math.random();
            const status = r < 0.45 ? "approved" : r < 0.8 ? "pending" : r < 0.92 ? "rejected" : "duplicate";
            s.recordSale({ agentId: agent.id, status, source: "demo-simulator", celebrate: true });
          }
        }
      }
      schedule();
    };
    schedule();
    return () => clearTimeout(timer);
  }, [enabled, every]);

  return null;
}
