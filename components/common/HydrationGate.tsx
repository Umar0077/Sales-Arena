"use client";

import { useArenaStore } from "@/store/arena-store";
import { useSettingsStore } from "@/store/settings-store";
import { useRewardsStore } from "@/store/rewards-store";

/**
 * Demo data and settings live in the browser (localStorage), so the server cannot
 * render them. Children render only once both stores have loaded, which keeps the
 * server HTML and the first browser render identical.
 */
export function HydrationGate({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const arenaReady = useArenaStore((s) => s.hydrated);
  const settingsReady = useSettingsStore((s) => s.hydrated);
  const rewardsReady = useRewardsStore((s) => s.hydrated);
  const ready = arenaReady && settingsReady && rewardsReady;
  if (!ready) {
    if (fallback !== undefined) return <>{fallback}</>;
    return (
      <div className="grid flex-1 place-items-center py-24" aria-busy="true" aria-live="polite">
        <div className="flex items-center gap-3 text-sm font-medium text-text-muted">
          <span className="h-2 w-2 animate-ping rounded-full bg-secondary" />
          Loading live data…
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
