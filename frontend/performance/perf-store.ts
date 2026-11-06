"use client";

import { create } from "zustand";
import type { FrameStats } from "./frame-monitor";

export interface CanvasInfo {
  id: string;
  label: string;
  width: number;
  height: number;
  dpr: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

export interface SpinPerfRecord extends FrameStats {
  at: string;
  quality: string;
  durationMs: number;
}

interface PerfStore {
  canvases: Record<string, CanvasInfo>;
  spins: SpinPerfRecord[];
  register: (info: CanvasInfo) => void;
  update: (id: string, patch: Partial<CanvasInfo>) => void;
  unregister: (id: string) => void;
  addSpin: (record: SpinPerfRecord) => void;
}

export const usePerfStore = create<PerfStore>()((set, get) => ({
  canvases: {},
  spins: [],
  register: (info) => set({ canvases: { ...get().canvases, [info.id]: info } }),
  update: (id, patch) => {
    const c = get().canvases[id];
    if (c) set({ canvases: { ...get().canvases, [id]: { ...c, ...patch } } });
  },
  unregister: (id) => {
    const next = { ...get().canvases };
    delete next[id];
    set({ canvases: next });
  },
  addSpin: (record) => {
    const spins = [record, ...get().spins].slice(0, 20);
    set({ spins });
    if (typeof window !== "undefined") {
      (window as unknown as { __SALES_ARENA_PERF__?: unknown }).__SALES_ARENA_PERF__ = { spins };
    }
  },
}));
