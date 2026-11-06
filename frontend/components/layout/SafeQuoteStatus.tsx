"use client";

import { useArenaStore } from "@/frontend/stores/arena-store";
import { cn } from "@/shared/utils";

/**
 * Safe Quote connection status for the Live Arena header. Reads the state LiveApiSync already keeps
 * (no extra stream, no extra requests). LIVE only once real data loaded and the stream is connected.
 */
export function SafeQuoteStatus() {
  const mode = useArenaStore((s) => s.dataSourceMode);
  const status = useArenaStore((s) => s.apiSyncStatus);
  const error = useArenaStore((s) => s.apiSyncError);
  const lastSyncAt = useArenaStore((s) => s.lastSyncAt);

  const state =
    mode !== "production"
      ? { key: "demo", label: "DEMO MODE", short: "DEMO", dot: "bg-purple-400", text: "text-purple-300", box: "border-purple-400/30 bg-purple-400/10" }
      : status === "connected"
        ? { key: "live", label: "SAFE QUOTE LIVE", short: "LIVE", dot: "bg-emerald-500", text: "text-emerald-400", box: "border-emerald-400/30 bg-emerald-400/10" }
        : status === "error"
          ? { key: "reconnecting", label: "SAFE QUOTE RECONNECTING", short: "RECONNECTING", dot: "bg-amber-400", text: "text-amber-300", box: "border-amber-400/30 bg-amber-400/10" }
          : status === "unconfigured"
            ? { key: "disconnected", label: "SAFE QUOTE DISCONNECTED", short: "OFFLINE", dot: "bg-rose-500", text: "text-rose-300", box: "border-rose-400/30 bg-rose-400/10" }
            : { key: "connecting", label: "SAFE QUOTE CONNECTING", short: "CONNECTING", dot: "bg-amber-400", text: "text-amber-300", box: "border-amber-400/30 bg-amber-400/10" };

  const title = [state.label, lastSyncAt ? `last update ${new Date(lastSyncAt).toLocaleTimeString()}` : null, state.key !== "live" ? error : null].filter(Boolean).join(" · ");

  return (
    <div
      role="status"
      aria-label={state.label}
      title={title}
      data-testid="safe-quote-status"
      data-state={state.key}
      className={cn("flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-2.5 py-1.5 font-mono text-[11px] font-semibold sm:px-3.5 sm:py-2", state.box)}
    >
      <span className="relative flex h-2 w-2">
        {state.key === "live" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", state.dot)} />
      </span>
      <span className={cn("hidden md:inline", state.text)}>{state.label}</span>
      <span className={cn("md:hidden", state.text)}>{state.short}</span>
    </div>
  );
}
