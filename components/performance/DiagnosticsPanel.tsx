"use client";

import { useEffect, useState } from "react";
import { frameMonitor, type FrameStats } from "@/lib/performance/frame-monitor";
import { usePerfStore } from "@/lib/performance/perf-store";
import { useSettingsStore } from "@/store/settings-store";
import { useArenaStore } from "@/store/arena-store";
import { QUALITY_PRESETS } from "@/lib/performance/quality";
import { Activity, X, Gauge, Layers, RefreshCcw } from "lucide-react";
import type { QualitySetting } from "@/types";

export function DiagnosticsPanel() {
  const [stats, setStats] = useState<FrameStats>({
    fps: 60,
    avgFps: 60,
    frameTimeAvg: 16.6,
    frameTimeP95: 18.0,
    frameTimeMax: 22.0,
    dropped: 0,
    refreshInterval: 16.67,
    samples: 60,
  });
  const [collapsed, setCollapsed] = useState(false);

  const canvases = usePerfStore((s) => s.canvases);
  const spins = usePerfStore((s) => s.spins);
  const settings = useSettingsStore();
  const dataSourceMode = useArenaStore((s) => s.dataSourceMode ?? "demo");
  const apiStatus = useArenaStore((s) => s.apiSyncStatus ?? "unconfigured");

  useEffect(() => {
    return frameMonitor.subscribe((s) => setStats(s));
  }, []);

  const activeCanvases = Object.values(canvases);
  const fpsColor =
    stats.fps >= 55 ? "text-emerald-400" : stats.fps >= 35 ? "text-amber-400" : "text-rose-400";

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-surface/90 border border-primary/20 px-3 py-1.5 font-mono text-xs text-white shadow-lg backdrop-blur hover:bg-surface-hover"
      >
        <Activity className="w-3.5 h-3.5 text-secondary" />
        <span className={fpsColor}>{Math.round(stats.fps)} FPS</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 w-80 rounded-xl bg-[#0D1426]/95 border border-primary/20 p-4 font-mono text-xs text-text-primary shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-3">
        <div className="flex items-center gap-2 font-semibold text-white">
          <Activity className="w-4 h-4 text-secondary" />
          <span>PERF DIAGNOSTICS</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCollapsed(true)}
            className="rounded p-1 hover:bg-white/10 text-muted hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Primary KPI grid */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="rounded-lg bg-surface p-2.5">
          <span className="text-[10px] text-muted block uppercase">Current FPS</span>
          <span className={`text-xl font-bold font-heading ${fpsColor}`}>
            {stats.fps ? stats.fps.toFixed(1) : "--"}
          </span>
          <span className="text-[10px] text-muted block mt-0.5">
            Avg: {stats.avgFps.toFixed(1)} FPS
          </span>
        </div>

        <div className="rounded-lg bg-surface p-2.5">
          <span className="text-[10px] text-muted block uppercase">Frame Time</span>
          <span className="text-xl font-bold font-heading text-white">
            {stats.frameTimeAvg ? stats.frameTimeAvg.toFixed(1) : "--"}
            <span className="text-xs font-normal text-muted">ms</span>
          </span>
          <span className="text-[10px] text-muted block mt-0.5">
            P95: {stats.frameTimeP95.toFixed(1)}ms
          </span>
        </div>
      </div>

      {/* Frame drops & refresh rate */}
      <div className="space-y-1.5 py-1 text-[11px] border-t border-white/5 pt-2">
        <div className="flex justify-between">
          <span className="text-muted">Target Refresh:</span>
          <span>{(1000 / stats.refreshInterval).toFixed(0)} Hz</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Est. Dropped Frames:</span>
          <span className={stats.dropped > 5 ? "text-amber-400 font-semibold" : ""}>
            {stats.dropped}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted">Active WebGL:</span>
          <span className="text-secondary font-semibold">
            {activeCanvases.length} canvas{activeCanvases.length === 1 ? "" : "es"}
          </span>
        </div>
      </div>

      {/* Live Environment Diagnostics */}
      <div className="mt-3 border-t border-white/5 pt-2 text-[10px] space-y-1">
        <div className="flex justify-between items-center">
          <span className="text-muted">Data Engine:</span>
          <span className={dataSourceMode === "production" ? "text-emerald-400 font-bold" : "text-purple-400 font-bold"}>
            {dataSourceMode === "production" ? "PRODUCTION (LIVE)" : "DEMO (SIMULATED)"}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-muted">Safe Quote API:</span>
          <span className={apiStatus === "connected" ? "text-emerald-400" : "text-amber-400"}>
            {apiStatus.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Quality preset switcher */}
      <div className="mt-3 border-t border-white/5 pt-2">
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-[10px] uppercase text-muted">Quality Preset:</span>
          <span className="text-[10px] font-bold uppercase text-primary">
            {settings.quality === "auto" ? `Auto (${settings.autoQuality})` : settings.quality}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {(["ultra", "high", "balanced", "low"] as const).map((q) => (
            <button
              key={q}
              onClick={() => settings.update({ quality: q })}
              className={`py-1 rounded text-[10px] font-semibold uppercase transition-all ${
                settings.quality === q
                  ? "bg-primary text-white"
                  : "bg-surface hover:bg-surface-hover text-muted"
              }`}
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Last Spin Benchmark */}
      {spins.length > 0 && (
        <div className="mt-3 border-t border-white/5 pt-2 text-[10px]">
          <span className="text-muted block uppercase">Last 3D Spin Metrics:</span>
          <div className="flex justify-between mt-1 text-secondary">
            <span>Avg {spins[0].avgFps.toFixed(1)} FPS</span>
            <span>P95 {spins[0].frameTimeP95.toFixed(1)}ms</span>
            <span>{spins[0].durationMs ? `${(spins[0].durationMs / 1000).toFixed(1)}s` : ""}</span>
          </div>
        </div>
      )}
    </div>
  );
}
