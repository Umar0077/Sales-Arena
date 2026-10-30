"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play } from "lucide-react";
import { useArenaStore } from "@/store/arena-store";
import { useSettingsStore } from "@/store/settings-store";
import dynamic from "next/dynamic";
import { wheelRewards } from "@/features/spins/selector";
import { validateWheel } from "@/features/rewards/validation";
import { planSpin, scaleProfile, DEFAULT_PROFILE, type SpinPlan } from "@/features/spins/wheel-math";
import { GhostButton } from "./ui";
import type { Reward } from "@/types";

const WheelCanvas = dynamic(() => import("@/components/spinner/WheelCanvas").then((m) => m.WheelCanvas), {
  ssr: false,
  loading: () => (
    <div className="relative aspect-[1/1.08] max-h-[86vh] w-full flex items-center justify-center rounded-2xl border border-white/5 bg-white/[0.02]">
      <div className="font-heading text-xs text-text-muted">Loading 3D Spinner preview...</div>
    </div>
  ),
});

/** Live preview of the wheel with current prizes and appearance. Test spins are not recorded. */
export function SpinnerPreview({ prizes }: { prizes?: Reward[] } = {}) {
  const storeRewards = useArenaStore((s) => s.rewards);
  const liveMode = useArenaStore((s) => s.liveMode);
  const [dbPrizes, setDbPrizes] = useState<Reward[] | null>(null);
  // Live mode without a passed catalog: read the same PostgreSQL wheel catalog the Live Arena uses.
  useEffect(() => {
    if (prizes || !liveMode) return;
    let alive = true;
    fetch("/api/arena/catalog", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (alive && j.ok)
          setDbPrizes(j.prizes.map((p: Reward & { displayOrder: number }, i: number) => ({ ...p, active: true, weight: 1, order: i })));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [prizes, liveMode]);
  // Admin passes the PostgreSQL catalog; demo data uses the local list.
  const rewards = prizes ?? (liveMode ? (dbPrizes ?? []) : storeRewards);
  const durationScale = useSettingsStore((s) => s.spinDurationScale);
  const segments = useMemo(() => wheelRewards(rewards), [rewards]);
  const check = validateWheel(rewards);
  const rotationRef = useRef(0);
  const [plan, setPlan] = useState<SpinPlan | null>(null);
  const [winner, setWinner] = useState<number | null>(null);
  const [landed, setLanded] = useState<string | null>(null);

  const test = () => {
    if (plan || segments.length === 0) return;
    const target = Math.floor(Math.random() * segments.length);
    setWinner(null);
    setLanded(null);
    setPlan(planSpin(rotationRef.current, target, segments.length, 0, scaleProfile(DEFAULT_PROFILE, durationScale)));
  };

  const done = useCallback(
    (i: number) => {
      setPlan(null);
      setWinner(i);
      setLanded(segments[i]?.title ?? null);
    },
    [segments],
  );

  if (!check.valid) {
    return <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">{check.message}</p>;
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="w-full max-w-[460px]">
        <WheelCanvas
          canvasId="spinner-admin-preview"
          rewards={segments}
          activeSpinPlan={plan}
          currentRotationRef={rotationRef}
          onSpinComplete={done}
          phase={plan ? "spinning" : winner !== null ? "result" : "idle"}
          winnerIndex={winner}
        />
      </div>
      <div className="flex items-center gap-3">
        <GhostButton onClick={test} disabled={!!plan}>
          <Play className="h-4 w-4" /> {plan ? "Spinning…" : "Test spin"}
        </GhostButton>
        {landed && <span className="text-sm text-text-secondary">Landed on <b className="text-white">{landed}</b></span>}
      </div>
      <p className="text-xs text-text-muted">Preview only — test spins are not saved.</p>
    </div>
  );
}
