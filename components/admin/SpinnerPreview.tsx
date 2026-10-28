"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Play } from "lucide-react";
import { useArenaStore } from "@/store/arena-store";
import { useSettingsStore } from "@/store/settings-store";
import { WheelCanvas } from "@/components/spinner/WheelCanvas";
import { wheelRewards } from "@/features/spins/selector";
import { validateWheel } from "@/features/rewards/validation";
import { planSpin, scaleProfile, DEFAULT_PROFILE, type SpinPlan } from "@/features/spins/wheel-math";
import { GhostButton } from "./ui";

/** Live preview of the wheel with current prizes and appearance. Test spins are not recorded. */
export function SpinnerPreview() {
  const rewards = useArenaStore((s) => s.rewards);
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
