"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Disc3, Eye, RotateCcw, Sparkles, Trophy } from "lucide-react";
import { adminApi } from "@/frontend/components/admin/admin-api";
import { Section, Field, SelectField, PrimaryButton, GhostButton } from "@/frontend/components/admin/ui";
import { WheelCanvas } from "@/frontend/components/spinner/WheelCanvas";
import type { WheelPhase } from "@/frontend/components/spinner/Wheel3D";
import { planSpin, DEFAULT_PROFILE, type SpinPlan } from "@/frontend/features/spins/wheel-math";
import { RewardIconView } from "@/frontend/components/brand/RewardIconView";
import { AgentEmoji } from "@/frontend/components/celebrations/AgentEmoji";
import { Notice } from "./shared";
import type { Reward, RewardIcon } from "@/shared/types";
import type { AgentRow } from "./AllocateTab";
import type { Prize } from "./PrizesTab";

const FALLBACK_PRIZES: Reward[] = [
  { id: "prev_1", title: "$100 Cash Bonus", description: "Instant cash reward", icon: "trophy", color: "#FFC857", active: true, quantity: null, weight: 0.4, order: 0 },
  { id: "prev_2", title: "$50 Gift Card", description: "Digital gift card", icon: "gift", color: "#36E0B5", active: true, quantity: null, weight: 0.35, order: 1 },
  { id: "prev_3", title: "Extra PTO Hour", description: "1 hour paid time off", icon: "sparkles", color: "#8B5CFF", active: true, quantity: null, weight: 0.25, order: 2 },
];

type PreviewStage = "notification" | "spinning" | "reveal";

/**
 * Isolated Admin Spin Preview: simulates the allocation notification, wheel animation,
 * selected prize, and prize reveal locally. Never writes to PostgreSQL, never consumes
 * credits, and never broadcasts to Live Arena displays.
 */
export function PreviewTab() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [selectedUserCode, setSelectedUserCode] = useState<string>("PREVIEW_AGENT");
  const [forcedPrizeId, setForcedPrizeId] = useState<string>("random");
  const [stage, setStage] = useState<PreviewStage>("notification");
  const [plan, setPlan] = useState<SpinPlan | null>(null);
  const [winnerIdx, setWinnerIdx] = useState<number | null>(null);
  const [wonReward, setWonReward] = useState<Reward | null>(null);
  const rotationRef = useRef(0);

  useEffect(() => {
    let alive = true;
    void adminApi<{ agents: AgentRow[] }>("/api/admin/spins/agents?limit=100").then((r) => {
      if (!alive || !r.ok || !r.data.agents.length) return;
      setAgents(r.data.agents);
      setSelectedUserCode((prev) => (prev === "PREVIEW_AGENT" ? r.data.agents[0].user_code : prev));
    });
    void adminApi<{ prizes: Prize[] }>("/api/admin/catalog").then((r) => {
      if (!alive || !r.ok) return;
      setPrizes(r.data.prizes);
    });
    return () => {
      alive = false;
    };
  }, []);

  const previewAgents = useMemo(
    () =>
      agents.length > 0
        ? agents.map((a) => ({ userCode: a.user_code, name: a.name }))
        : [{ userCode: "PREVIEW_AGENT", name: "Hamna Nasir (Preview)" }],
    [agents],
  );

  const activeAgent = previewAgents.find((a) => a.userCode === selectedUserCode) ?? previewAgents[0];

  const wheelPrizes: Reward[] = useMemo(() => {
    const eligible = prizes.filter((p) => p.active && Number(p.weight) > 0 && (p.quantity === null || p.quantity > 0));
    if (eligible.length >= 2) {
      return eligible.map((p, i) => ({
        id: p.id,
        title: p.title,
        description: p.description,
        icon: p.icon as RewardIcon,
        color: p.color,
        active: true,
        quantity: p.quantity,
        weight: Number(p.weight),
        order: i,
      }));
    }
    return FALLBACK_PRIZES;
  }, [prizes]);

  const totalWeight = useMemo(() => wheelPrizes.reduce((s, p) => s + p.weight, 0), [wheelPrizes]);

  const pickPreviewIndex = useCallback((): number => {
    if (forcedPrizeId !== "random") {
      const idx = wheelPrizes.findIndex((p) => p.id === forcedPrizeId);
      if (idx >= 0) return idx;
    }
    if (totalWeight <= 0) return 0;
    let roll = Math.random() * totalWeight;
    for (let i = 0; i < wheelPrizes.length; i++) {
      if (roll < wheelPrizes[i].weight) return i;
      roll -= wheelPrizes[i].weight;
    }
    return wheelPrizes.length - 1;
  }, [forcedPrizeId, wheelPrizes, totalWeight]);

  const startPreviewSpin = () => {
    const idx = pickPreviewIndex();
    setWinnerIdx(null);
    setWonReward(null);
    setStage("spinning");
    setPlan(planSpin(rotationRef.current, idx, wheelPrizes.length, 0, DEFAULT_PROFILE));
  };

  const handleComplete = useCallback(
    (landed: number) => {
      setPlan(null);
      setWinnerIdx(landed);
      setWonReward(wheelPrizes[landed] ?? wheelPrizes[0]);
      setStage("reveal");
    },
    [wheelPrizes],
  );

  const resetPreview = () => {
    setPlan(null);
    setWinnerIdx(null);
    setWonReward(null);
    setStage("notification");
  };

  const phase: WheelPhase = stage === "spinning" && plan ? "spinning" : stage === "reveal" ? "result" : "idle";

  return (
    <div className="space-y-6" data-testid="spin-preview-tab">
      <Notice kind="info">
        <strong>Local Preview Only</strong> — Simulates the Spin &amp; Win journey locally. Nothing is written to the database, no spin credits are consumed, and nothing is broadcast to Live Arena TVs.
      </Notice>

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Section title="Preview Controls" description="Choose an agent and prize outcome to test.">
          <SelectField
            label="Preview Agent"
            value={activeAgent.userCode}
            options={previewAgents.map((a) => ({ value: a.userCode, label: `${a.name} (${a.userCode})` }))}
            onChange={(v) => {
              setSelectedUserCode(v);
              resetPreview();
            }}
          />
          <SelectField
            label="Target Prize"
            value={forcedPrizeId}
            options={[
              { value: "random", label: "Weighted Random (Normal Odds)" },
              ...wheelPrizes.map((p) => ({
                value: p.id,
                label: `${p.title} (${totalWeight > 0 ? ((p.weight / totalWeight) * 100).toFixed(1) : "0"}%)`,
              })),
            ]}
            onChange={setForcedPrizeId}
          />
          <Field label="Preview Actions">
            <div className="flex flex-wrap gap-2">
              <PrimaryButton onClick={startPreviewSpin} disabled={stage === "spinning"} data-testid="preview-spin-start">
                <Disc3 className="h-4 w-4" /> {stage === "spinning" ? "Spinning…" : "Run Preview Spin"}
              </PrimaryButton>
              <GhostButton onClick={resetPreview} disabled={stage === "spinning"} data-testid="preview-spin-reset">
                <RotateCcw className="h-4 w-4" /> Reset
              </GhostButton>
            </div>
          </Field>
        </Section>

        <Section title="Interactive Stage Preview" description="Notification → Wheel Animation → Selected Prize → Prize Reveal">
          <div className="space-y-5">
            {/* 1. Allocation Notification Preview */}
            <div
              data-testid="preview-allocation-card"
              className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gold/35 bg-[#0C1226]/90 p-4"
            >
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-xl bg-white/10">
                  <AgentEmoji
                    agentId={`agt_${activeAgent.userCode}`}
                    name={activeAgent.name}
                    className="h-12 w-12 object-contain"
                    fallback={<Trophy className="h-6 w-6 text-gold" />}
                  />
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[0.2em] text-gold">
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>SPIN AVAILABLE (LOCAL PREVIEW)</span>
                  </div>
                  <div className="text-base font-bold text-white">{activeAgent.name}</div>
                  <div className="text-xs text-text-secondary">1 Preview Spin Credit · Zero DB impact</div>
                </div>
              </div>
              <button
                type="button"
                onClick={startPreviewSpin}
                disabled={stage === "spinning"}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#FFC857] to-[#FF8A47] px-4 py-2 text-xs font-extrabold text-[#1A1206] shadow disabled:opacity-50"
              >
                <Eye className="h-3.5 w-3.5" /> SPIN NOW
              </button>
            </div>

            {/* 2. Wheel Animation */}
            <div className="relative h-[360px] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#070B16]" data-testid="preview-wheel-box">
              <WheelCanvas
                rewards={wheelPrizes}
                activeSpinPlan={plan}
                currentRotationRef={rotationRef}
                onSpinComplete={handleComplete}
                phase={phase}
                winnerIndex={winnerIdx}
                canvasId="admin-spin-preview"
              />
            </div>

            {/* 3 & 4. Selected Prize & Prize Reveal */}
            {stage === "reveal" && wonReward && (
              <div
                data-testid="preview-prize-reveal"
                className="rounded-2xl border border-gold/45 bg-gradient-to-b from-[#1A1338] via-[#0E1430] to-[#0A0F22] p-6 text-center shadow-[0_0_50px_-15px_rgba(255,200,87,0.4)]"
              >
                <p className="text-xs font-bold uppercase tracking-[0.3em] text-secondary">
                  PRIZE UNLOCKED · LOCAL PREVIEW ONLY
                </p>
                <div
                  className="mx-auto my-4 grid h-16 w-16 place-items-center rounded-full border-2 border-gold/60"
                  style={{ background: `${wonReward.color}33`, color: wonReward.color }}
                >
                  <RewardIconView icon={wonReward.icon} className="h-8 w-8" />
                </div>
                <h3 className="font-heading text-2xl font-extrabold text-white">
                  CONGRATULATIONS, {activeAgent.name.split(" ")[0].toUpperCase()}!
                </h3>
                <p className="mt-1 font-heading text-xl font-extrabold text-gold">
                  YOU WON {wonReward.title.toUpperCase()}!
                </p>
                {wonReward.description && (
                  <p className="mt-1 text-sm text-text-secondary">{wonReward.description}</p>
                )}
              </div>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}
