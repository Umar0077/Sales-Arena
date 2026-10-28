import { ArenaBackdrop } from "@/components/layout/ArenaBackdrop";
import { ArenaHeader } from "@/components/layout/ArenaHeader";
import { CelebrationOverlay } from "@/components/celebrations/CelebrationOverlay";
import { ArenaEventBridge } from "@/components/arena/ArenaEventBridge";
import { AutoSimulator } from "@/components/arena/AutoSimulator";
import { SpinFlow } from "@/components/spinflow/SpinFlow";
import { HydrationGate } from "@/components/common/HydrationGate";
import { ArenaContent, WhenArenaOnline } from "@/components/arena/ArenaSwitch";
import { PoweredBy } from "@/components/brand/PoweredBy";

/** Public Live Arena shell (TV display). No admin navigation here. */
export default function ArenaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <ArenaBackdrop />
      <ArenaHeader />
      <main className="flex-1 flex flex-col pb-14">
        <HydrationGate>
          <ArenaContent>{children}</ArenaContent>
        </HydrationGate>
      </main>
      {/* Live runtime: stops entirely while the admin has the Live Arena switched off. */}
      <WhenArenaOnline>
        <ArenaEventBridge />
        <AutoSimulator />
        <CelebrationOverlay />
        <SpinFlow />
      </WhenArenaOnline>
      <PoweredBy />
    </div>
  );
}
