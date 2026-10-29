"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { X, Disc3, Loader2 } from "lucide-react";
import { useArenaStore, pickData } from "@/store/arena-store";
import { useSettingsStore } from "@/store/settings-store";
import { WheelCanvas } from "@/components/spinner/WheelCanvas";
import type { WheelPhase } from "@/components/spinner/Wheel3D";
import { planSpin, scaleProfile, DEFAULT_PROFILE, type SpinPlan } from "@/features/spins/wheel-math";
import { wheelRewards } from "@/features/spins/selector";
import { computeSpinCredit } from "@/features/targets/eligibility";
import { audioEngine } from "@/lib/audio/engine";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { cn } from "@/lib/utils";
import { closerCode } from "@/features/sales/leads";
import type { Reward } from "@/types";

type StageState = "ready" | "preparing" | "spinning" | "decelerating" | "result";

export interface SpinOutcome {
  reward: Reward;
  spinsLeft: number;
}

interface Props {
  agentId: string;
  reducedMotion: boolean;
  /** Fired once the wheel has stopped and the spin is recorded. */
  onResult: (outcome: SpinOutcome) => void;
  onClose: () => void;
}

/** The 3D Spin Arena screen for one agent. */
export function SpinStage({ agentId, reducedMotion, onResult, onClose }: Props) {
  const rewards = useArenaStore((s) => s.rewards);
  const agent = useArenaStore((s) => s.agents.find((a) => a.id === agentId));
  const team = useArenaStore((s) => s.teams.find((t) => t.id === agent?.teamId));
  const sales = useArenaStore((s) => s.sales);
  const spins = useArenaStore((s) => s.spins);
  const bonus = useArenaStore((s) => s.bonusCredits);
  const seeded = useSettingsStore((s) => s.seededSpins);
  const seed = useSettingsStore((s) => s.spinSeed);
  const durationScale = useSettingsStore((s) => s.spinDurationScale);

  const [state, setState] = useState<StageState>("ready");
  const [plan, setPlan] = useState<SpinPlan | null>(null);
  const [winner, setWinner] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // While a spin runs, the wheel keeps the exact segment list the result was chosen from.
  const [spinSegments, setSpinSegments] = useState<Reward[] | null>(null);
  const rotationRef = useRef(0);
  const busyRef = useRef(false);
  const pending = useRef<{ spinId: string; reward: Reward; index: number } | null>(null);

  const liveSegments = useMemo(() => wheelRewards(rewards), [rewards]);
  const segments = spinSegments ?? liveSegments;
  const available = useMemo(
    () => (agent ? computeSpinCredit(pickData(useArenaStore.getState()), agent.id).available : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agent, sales, spins, bonus],
  );

  const phase: WheelPhase = state === "preparing" ? "preparing" : state === "spinning" || state === "decelerating" ? "spinning" : state === "result" ? "result" : "idle";

  const startSpin = () => {
    if (busyRef.current || !agent) return; // one spin at a time
    if (available <= 0) {
      setError("No spins available for this agent.");
      return;
    }
    busyRef.current = true;
    setError(null);
    setState("preparing");
    audioEngine.unlock();
    audioEngine.play("wheelActivate");

    setTimeout(
      async () => {
        let serverRewardId: string | undefined = undefined;
        try {
          const userCode = closerCode(agent);
          const spinRes = await fetch("/api/arena/spin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userCode }),
          });
          if (spinRes.ok) {
            const data = await spinRes.json();
            if (data.ok && data.reward?.id) {
              serverRewardId = data.reward.id;
            }
          }
        } catch {
          // If server API fails or in demo mode, fall back to client simulation
        }

        const res = useArenaStore.getState().startSpin(agent.id, { seeded, seed, serverRewardId });
        if (!res.ok) {
          setError(res.reason);
          setState("ready");
          busyRef.current = false;
          return;
        }
        pending.current = { spinId: res.spin.id, reward: res.reward, index: res.segmentIndex };
        setSpinSegments(res.segments);
        const profile = scaleProfile(DEFAULT_PROFILE, durationScale * (reducedMotion ? 0.6 : 1));
        setPlan(planSpin(rotationRef.current, res.segmentIndex, res.segments.length, 0, profile));
        setState("spinning");
      },
      reducedMotion ? 250 : 750,
    );
  };

  const handlePhase = useCallback((p: string) => {
    if (p === "decelerating") setState("decelerating");
  }, []);

  const handleComplete = useCallback(
    (landed: number) => {
      const p = pending.current;
      if (!p) return;
      pending.current = null;
      if (landed !== p.index) console.warn(`[spin] landed on ${landed}, expected ${p.index}`);
      setPlan(null);
      setWinner(p.index);
      setState("result");
      useArenaStore.getState().completeSpin(p.spinId);
      const left = computeSpinCredit(pickData(useArenaStore.getState()), agentId).available;
      // Let the winning segment glow for a beat before the full reveal.
      setTimeout(() => onResult({ reward: p.reward, spinsLeft: left }), reducedMotion ? 300 : 1100);
    },
    [agentId, onResult, reducedMotion],
  );

  if (!agent) {
    return (
      <div className="grid h-full place-items-center text-center">
        <div>
          <p className="text-lg font-semibold text-white">Agent not found.</p>
          <button onClick={onClose} className="mt-4 rounded-xl bg-primary px-5 py-2.5 font-semibold text-white">Back to Live Arena</button>
        </div>
      </div>
    );
  }

  const busy = state !== "ready";
  const label =
    state === "preparing" ? "CHARGING…" : state === "spinning" ? "SPINNING…" : state === "decelerating" ? "SLOWING DOWN…" : state === "result" ? "WINNER!" : "SPIN THE WHEEL";

  return (
    <div className="relative flex h-full flex-col">
      {/* Top bar: brand, agent, spins */}
      <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-8">
        <BrandLogo size={40} subtitle="3D Spin Arena" />
        <button
          onClick={onClose}
          disabled={busy}
          title={busy ? "Wait for the spin to finish" : "Back to the Live Arena"}
          className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-text-secondary transition-colors hover:text-white disabled:opacity-30"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col items-center justify-center gap-4 px-4 pb-4 lg:flex-row lg:gap-8 lg:px-8">
        {/* Agent card */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15 }}
          className="order-1 w-full max-w-xs shrink-0 rounded-3xl lg:max-w-[17rem] border border-white/10 bg-[#0B1122]/80 p-5 text-center backdrop-blur-xl lg:order-none"
        >
          <p className="text-[11px] font-bold tracking-[0.25em] text-secondary">NOW SPINNING</p>
          <div
            className="mx-auto mt-3 grid h-16 w-16 place-items-center rounded-2xl font-heading text-xl font-bold text-white"
            style={{ background: `linear-gradient(135deg, hsl(${agent.hue} 75% 55%), hsl(${(agent.hue + 40) % 360} 70% 38%))` }}
          >
            {agent.initials}
          </div>
          <h2 className="mt-3 font-heading text-2xl font-extrabold text-white" data-testid="spin-agent-name">{agent.name}</h2>
          {team && <p className="mt-0.5 text-sm font-medium" style={{ color: team.color }}>Team {team.name}</p>}
          <div className="mt-4 rounded-2xl border border-gold/30 bg-gold/10 px-4 py-3">
            <div className="font-heading text-4xl font-extrabold text-gold tabular" data-testid="spins-available">{available}</div>
            <div className="text-xs font-semibold tracking-wider text-gold/80">SPIN{available === 1 ? "" : "S"} AVAILABLE</div>
          </div>
        </motion.div>

        {/* Wheel */}
        <div className="order-0 w-full max-w-[min(92vh,1100px)] lg:min-w-0 lg:flex-1 lg:order-none">
          <WheelCanvas
            rewards={segments}
            activeSpinPlan={plan}
            currentRotationRef={rotationRef}
            onSpinComplete={handleComplete}
            onPhaseChange={handlePhase}
            phase={phase}
            winnerIndex={winner}
          />
        </div>

        {/* Spin control */}
        <div className="order-2 flex w-full max-w-xs shrink-0 flex-col items-center gap-3 lg:max-w-[17rem] lg:order-none">
          <button
            onClick={startSpin}
            disabled={busy || available <= 0}
            data-testid="spin-button"
            className={cn(
              "relative inline-flex w-full items-center justify-center gap-3 rounded-2xl px-8 py-5 font-heading text-xl font-extrabold tracking-wide transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-secondary/50",
              busy
                ? "cursor-default bg-white/10 text-white"
                : "spin-cta bg-gradient-to-r from-[#22D3FF] via-[#8B5CFF] to-[#FF3DB4] text-white shadow-[0_14px_44px_-10px_rgba(139,92,255,0.9)] hover:scale-[1.03] active:scale-[0.97] disabled:opacity-40 disabled:hover:scale-100",
            )}
          >
            {busy && state !== "result" ? <Loader2 className="h-6 w-6 animate-spin" /> : <Disc3 className="h-6 w-6" />}
            {label}
          </button>
          {error && <p className="text-center text-sm font-medium text-rose-400">{error}</p>}
          <p className="text-center text-xs text-text-muted">{segments.length} prizes on the wheel</p>
        </div>
      </div>
    </div>
  );
}
