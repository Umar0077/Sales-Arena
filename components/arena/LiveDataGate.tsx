"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useArenaStore } from "@/store/arena-store";
import { useLiveStore } from "@/store/live-store";

/** Skeleton shaped like the Live Arena: KPI row, hero panel, feeds and leaderboard. */
export function ArenaSkeleton() {
  const block = "rounded-2xl border border-white/[0.06] bg-white/[0.03] animate-pulse";
  return (
    <div className="flex flex-1 flex-col gap-4 px-4 py-4 sm:px-6" aria-busy="true" aria-live="polite" data-testid="arena-skeleton">
      <span className="sr-only">Loading verified live sales data…</span>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`${block} h-[104px] p-4`}>
            <div className="h-3 w-20 rounded bg-white/10" />
            <div className="mt-3 h-8 w-16 rounded bg-white/10" />
            <div className="mt-2 h-2.5 w-24 rounded bg-white/[0.07]" />
          </div>
        ))}
      </div>
      <div className="grid flex-1 gap-4 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-4">
          <div className={`${block} h-56`} />
          <div className="grid gap-4 md:grid-cols-2">
            <div className={`${block} h-64`} />
            <div className={`${block} h-64`} />
          </div>
        </div>
        <div className={`${block} min-h-[420px] p-4`}>
          <div className="h-4 w-40 rounded bg-white/10" />
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="mt-4 flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-white/10" />
              <div className="h-3 flex-1 rounded bg-white/[0.07]" />
              <div className="h-3 w-8 rounded bg-white/10" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Live mode: render the arena only after the first verified Safe Quote response.
 * Before that a skeleton shows; if the first load fails, a clear error with Retry.
 * Demo mode renders straight away.
 */
export function LiveDataGate({ children }: { children: React.ReactNode }) {
  const liveMode = useArenaStore((s) => s.liveMode);
  const synced = useArenaStore((s) => s.lastSyncAt !== null);
  const status = useArenaStore((s) => s.apiSyncStatus);
  const error = useArenaStore((s) => s.apiSyncError);
  const refreshing = useLiveStore((s) => s.refreshing);
  const retry = useLiveStore((s) => s.requestRefresh);

  if (!liveMode || synced) return <>{children}</>;
  if (status === "error" && !refreshing) {
    return (
      <div className="grid flex-1 place-items-center px-4 py-24" role="alert" data-testid="arena-load-error">
        <div className="max-w-md rounded-3xl border border-rose-400/25 bg-[#0D1426]/90 p-8 text-center backdrop-blur-xl">
          <AlertTriangle className="mx-auto h-10 w-10 text-rose-300" />
          <h2 className="mt-4 font-heading text-xl font-bold text-white">Live sales data is unavailable</h2>
          <p className="mt-2 text-sm text-text-muted">
            We couldn&apos;t reach Safe Quote just now{error ? ` (${error})` : ""}. Nothing is shown until real data loads.
          </p>
          <button
            onClick={retry}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary/90"
          >
            <RefreshCw className="h-4 w-4" /> Try again
          </button>
        </div>
      </div>
    );
  }
  return <ArenaSkeleton />;
}
