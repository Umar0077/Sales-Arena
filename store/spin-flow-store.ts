"use client";

import { create } from "zustand";
import { uid } from "@/lib/utils";
import type { Agent } from "@/types";

/**
 * Live Arena "target completed → SPIN NOW → wheel → prize → back" flow.
 * Not persisted: a refresh simply returns to the Live Arena (the earned spin stays
 * available, because credits are derived from sales in the arena store).
 */

export interface SpinUnlock {
  id: string;
  agentId: string;
  /** Approved sales in the rule period when the spin was earned. */
  periodSales: number;
  /** Spins available at the time of the event. */
  available: number;
  reason: "target" | "bonus" | "launch";
  /** Presentation-only run: never touches sales, credits, the server or the database. */
  demo?: boolean;
}

/**
 * Stand-in shown by the Demo spin button while the arena runs on live Safe Quote data,
 * so a presentation never puts a fake win next to a real closer's name.
 */
export const DEMO_AGENT: Agent = {
  id: "__demo_spin__",
  name: "Demo Spin",
  initials: "DS",
  teamId: "",
  campaignId: "",
  active: true,
  title: "Presentation demo",
  hue: 268,
  joinedAt: "2026-01-01T00:00:00.000Z",
};

export type SpinFlowStage = "idle" | "achievement" | "transition" | "spin" | "closing";

interface SpinFlowState {
  queue: SpinUnlock[];
  active: SpinUnlock | null;
  stage: SpinFlowStage;
  push: (unlock: Omit<SpinUnlock, "id">) => void;
  /** Promote the next queued unlock (no-op while a flow is active). */
  next: () => SpinUnlock | null;
  setStage: (stage: SpinFlowStage) => void;
  /** End the current flow and return to the Live Arena. */
  finish: () => void;
  clear: () => void;
}

/**
 * Queue rule: one entry per agent. A repeat event for a queued agent (bulk or
 * simultaneous sales) updates that entry instead of stacking another popup.
 * Launch requests jump the queue.
 */
export function enqueueUnlock(queue: SpinUnlock[], unlock: SpinUnlock, activeAgentId: string | null): SpinUnlock[] {
  if (unlock.agentId === activeAgentId) return queue;
  const i = queue.findIndex((q) => q.agentId === unlock.agentId);
  if (i >= 0) {
    const merged = { ...queue[i], periodSales: unlock.periodSales, available: unlock.available };
    if (unlock.reason === "launch") return [{ ...merged, reason: "launch" }, ...queue.filter((_, j) => j !== i)];
    return queue.map((q, j) => (j === i ? merged : q));
  }
  return unlock.reason === "launch" ? [unlock, ...queue] : [...queue, unlock];
}

export const useSpinFlowStore = create<SpinFlowState>()((set, get) => ({
  queue: [],
  active: null,
  stage: "idle",
  push: (u) => {
    const s = get();
    set({ queue: enqueueUnlock(s.queue, { ...u, id: uid("unlock") }, s.active?.agentId ?? null) });
  },
  next: () => {
    const s = get();
    if (s.active || s.queue.length === 0) return null;
    const [head, ...rest] = s.queue;
    set({ active: head, queue: rest, stage: head.reason === "launch" ? "transition" : "achievement" });
    return head;
  },
  setStage: (stage) => set({ stage }),
  finish: () => set({ active: null, stage: "idle" }),
  clear: () => set({ queue: [], active: null, stage: "idle" }),
}));
