import { ArenaBackdrop } from "@/frontend/components/layout/ArenaBackdrop";
import { ArenaHeader } from "@/frontend/components/layout/ArenaHeader";
import { CelebrationOverlay } from "@/frontend/components/celebrations/CelebrationOverlay";
import { ArenaEventBridge } from "@/frontend/components/arena/ArenaEventBridge";
import { AutoSimulator } from "@/frontend/components/arena/AutoSimulator";
import { SpinFlow } from "@/frontend/components/spinflow/SpinFlow";
import { HydrationGate } from "@/frontend/components/common/HydrationGate";
import { ArenaContent, WhenArenaOnline } from "@/frontend/components/arena/ArenaSwitch";
import { PoweredBy } from "@/frontend/components/brand/PoweredBy";
import { RewardRuntime } from "@/frontend/components/rewards/RewardRuntime";
import { ArenaCub } from "@/frontend/components/cub/ArenaCub";
import { LiveApiSync } from "@/frontend/components/arena/LiveApiSync";
import { LiveDataGate, ArenaSkeleton } from "@/frontend/components/arena/LiveDataGate";

/** Public Live Arena shell (TV display). No admin navigation here. */
export default function ArenaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <ArenaBackdrop />
      <ArenaHeader />
      <main className="flex-1 flex flex-col pb-24">
        <HydrationGate fallback={<ArenaSkeleton />}>
          <ArenaContent>
            <LiveDataGate>{children}</LiveDataGate>
          </ArenaContent>
        </HydrationGate>
      </main>
      {/* Live runtime: stops entirely while the admin has the Live Arena switched off. */}
      <WhenArenaOnline>
        <ArenaEventBridge />
        <AutoSimulator />
        <CelebrationOverlay />
        <SpinFlow />
        <RewardRuntime />
        <ArenaCub />
      </WhenArenaOnline>
      {/* Data + settings sync keeps running while offline, so an admin can switch the arena back on remotely. */}
      <LiveApiSync />
      <PoweredBy size="lg" />
    </div>
  );
}
