"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useLiveStore } from "@/store/live-store";
import { useArenaStore } from "@/store/arena-store";
import { cn } from "@/lib/utils";

function ago(iso: string | null, now: number): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 10) return "Updated just now";
  if (s < 60) return `Updated ${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `Updated ${m} min ago` : `Updated ${new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * Re-fetches every live dataset through LiveApiSync (summary, closers, recent sales,
 * awards, targets). Read-only, never reloads the page, one request at a time.
 */
export function RefreshButton() {
  const liveMode = useArenaStore((s) => s.liveMode);
  const refreshing = useLiveStore((s) => s.refreshing);
  const error = useLiveStore((s) => s.refreshError);
  const lastSuccessAt = useLiveStore((s) => s.lastSuccessAt);
  const requestRefresh = useLiveStore((s) => s.requestRefresh);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  if (!liveMode) return null;
  const label = error ?? (refreshing ? "Refreshing live data…" : ago(lastSuccessAt, now));

  return (
    <div className="flex items-center gap-2">
      <span
        className={cn("hidden lg:inline text-[11px] font-medium tabular", error ? "text-rose-300" : "text-text-muted")}
        aria-live="polite"
        data-testid="refresh-status"
      >
        {label}
      </span>
      <button
        type="button"
        onClick={requestRefresh}
        disabled={refreshing}
        aria-label="Refresh live data"
        title={error ? `${error} Click to retry.` : "Refresh live data"}
        aria-busy={refreshing}
        data-testid="refresh-live"
        className={cn(
          "grid h-10 w-10 place-items-center rounded-xl border bg-surface/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary disabled:cursor-wait",
          error ? "border-rose-400/40 text-rose-300 hover:text-white" : "border-white/5 text-text-muted hover:border-secondary/40 hover:text-secondary",
        )}
      >
        <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
      </button>
    </div>
  );
}
