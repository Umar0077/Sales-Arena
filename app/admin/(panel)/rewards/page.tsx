"use client";

import { useCallback, useState } from "react";
import { Gift } from "lucide-react";
import { SpinnerPreview } from "@/components/admin/SpinnerPreview";
import { PrizesTab, type Prize } from "@/components/admin/spins/PrizesTab";
import type { Reward } from "@/types";

/**
 * Spin & Rewards: live wheel preview + prize odds, managed through the same PostgreSQL
 * catalog as Spin Management → Prizes (one shared component, one API, no local copy).
 */
export default function SpinRewardsPage() {
  const [wheel, setWheel] = useState<Reward[]>([]);

  // Preview = exactly what Live Arena wheels show: active prizes with positive weight and stock, in order.
  const onCatalog = useCallback((prizes: Prize[]) => {
    setWheel(
      prizes
        .filter((p) => p.active && Number(p.weight) > 0 && (p.quantity === null || p.quantity > 0))
        .sort((a, b) => a.display_order - b.display_order || a.id.localeCompare(b.id))
        .map((p, i) => ({ id: p.id, title: p.title, description: p.description, icon: p.icon, color: p.color, active: true, quantity: p.quantity, weight: Number(p.weight), order: i })),
    );
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-heading text-2xl font-bold text-white">
          <Gift className="h-6 w-6 text-gold" /> Spin &amp; Rewards
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          The prize wheel used by every Live Arena display. Prizes are stored in PostgreSQL; the server picks winners by weight, and wheel order never changes the odds. Test spins here are not recorded.
        </p>
      </div>
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_480px]">
        <PrizesTab onCatalog={onCatalog} />
        <div className="rounded-2xl border border-white/[0.07] bg-[#0D1426]/70 p-5">
          <h2 className="mb-3 font-heading text-lg font-bold text-white">Live wheel preview</h2>
          {wheel.length ? <SpinnerPreview prizes={wheel} /> : <p className="text-sm text-text-muted">No prizes on the wheel yet.</p>}
        </div>
      </div>
    </div>
  );
}
