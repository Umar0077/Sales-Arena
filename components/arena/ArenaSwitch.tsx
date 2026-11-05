"use client";

import { useEffect, useState } from "react";
import { MonitorOff } from "lucide-react";
import { useSettingsStore } from "@/store/settings-store";
import { useSpinFlowStore } from "@/store/spin-flow-store";
import { useCelebrationStore } from "@/store/celebration-store";
import { useBonusFlowStore } from "@/store/bonus-flow-store";
import { useTeamCelebrationStore } from "@/store/team-celebration-store";
import { BrandLogo } from "@/components/brand/BrandLogo";

/** True when the admin has switched the Live Arena on (Admin → Live Arena Controls). */
export function useArenaOnline(): boolean {
  return useSettingsStore((s) => s.arenaEnabled);
}

/** Renders its children only while the Live Arena is on (live runtime: celebrations, spins, demo sales). */
export function WhenArenaOnline({ children }: { children: React.ReactNode }) {
  const online = useArenaOnline();
  const hydrated = useSettingsStore((s) => s.hydrated);

  // Switching off mid-show: drop queued spin popups and celebrations.
  useEffect(() => {
    if (hydrated && !online) {
      useSpinFlowStore.getState().clear();
      useCelebrationStore.getState().clear();
      useBonusFlowStore.getState().clear();
      useTeamCelebrationStore.getState().clear();
    }
  }, [online, hydrated]);

  if (hydrated && !online) return null;
  return <>{children}</>;
}

/** Page content, or the offline screen when the Live Arena is switched off. */
export function ArenaContent({ children }: { children: React.ReactNode }) {
  const online = useArenaOnline();
  const message = useSettingsStore((s) => s.arenaOfflineMessage);
  const anyScreen = useSettingsStore((s) => Object.values(s.arenaModes).some(Boolean));
  if (online && anyScreen) return <>{children}</>;
  // All public screens disabled by the admin: same safe offline page (the Admin Panel stays available).
  return <ArenaOffline message={online ? "No Live Arena screens are enabled right now." : message} />;
}

function ArenaOffline({ message }: { message: string }) {
  const [time, setTime] = useState("");
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
    const tick = () => setTime(fmt.format(new Date()));
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="grid flex-1 place-items-center px-6 py-20 text-center" data-testid="arena-offline">
      <div className="max-w-lg">
        <div className="mx-auto mb-8 w-fit">
          <BrandLogo size={64} />
        </div>
        <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-white/[0.04]">
          <MonitorOff className="h-7 w-7 text-text-muted" />
        </div>
        <h1 className="font-heading text-3xl font-extrabold text-white sm:text-4xl">Live Arena is offline</h1>
        <p className="mt-3 text-lg text-text-secondary">{message}</p>
        {time && <p className="mt-8 text-5xl font-extrabold text-white/80 tabular">{time}</p>}
      </div>
    </div>
  );
}
