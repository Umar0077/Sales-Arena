"use client";

import { useId, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Play, RotateCcw } from "lucide-react";
import { useRewardsStore, DEFAULT_PROGRAMS, type BonusProgram, type BonusAward } from "@/store/rewards-store";
import { useSettingsStore } from "@/store/settings-store";
import { useArenaStore } from "@/store/arena-store";
import { formatReward } from "@/lib/rewards/engine";
import { BonusCelebration } from "@/components/rewards/BonusCelebration";
import { Section, Field, Toggle, Range, TextField, SelectField, GhostButton, PrimaryButton, inputClass } from "./ui";
import type { SoundCategory } from "@/types";

const SOUNDS: Array<{ value: SoundCategory; label: string }> = [
  { value: "target", label: "Target fanfare" },
  { value: "special", label: "Grand celebration" },
  { value: "reveal", label: "Prize reveal" },
  { value: "sale", label: "Sale chime" },
  { value: "spinUnlocked", label: "Unlock sparkle" },
];

const PERIOD_WORD = { daily: "per day", weekly: "per week", monthly: "per month" } as const;

/** Full editor for one Daily / Weekly / Monthly bonus program, with a popup preview. */
export function ProgramEditor({ program }: { program: BonusProgram }) {
  const update = useRewardsStore((s) => s.updateProgram);
  const currency = useSettingsStore((s) => s.currencyLabel);
  const agents = useArenaStore((s) => s.agents);
  const teams = useArenaStore((s) => s.teams);
  const [preview, setPreview] = useState<BonusAward[] | null>(null);
  const idNum = useId();
  const set = (patch: Partial<BonusProgram>) => update(program.id, patch);
  const reward = formatReward(program.amount, program.prizeLabel, currency);
  const sample = agents.find((a) => a.active) ?? agents[0];

  const num = (label: string, value: number, key: keyof BonusProgram, hint?: string, min = 0, max = 1_000_000) => (
    <Field label={label} hint={hint} htmlFor={`${idNum}-${String(key)}`}>
      <input
        id={`${idNum}-${String(key)}`}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<BonusProgram>)}
        className={`${inputClass} max-w-[200px]`}
        data-testid={`prog-${program.kind}-${String(key)}`}
      />
    </Field>
  );

  const restoreDefaults = () => {
    const d = DEFAULT_PROGRAMS.find((p) => p.id === program.id);
    if (d && confirm(`Restore default settings for "${program.name}"? Awards already given are kept.`)) update(program.id, { ...d, activeSince: program.activeSince });
  };

  const showPreview = () => {
    if (!sample) return;
    setPreview([
      {
        id: "preview",
        programId: program.id,
        kind: program.kind,
        agentId: sample.id,
        agentName: sample.name,
        periodKey: "preview",
        n: 1,
        validatedAtAward: program.salesRequired,
        amount: program.amount,
        prizeLabel: program.prizeLabel,
        programName: program.name,
        salesRequired: program.salesRequired,
        createdAt: new Date().toISOString(),
      },
    ]);
  };

  return (
    <div className="space-y-6">
      <Section
        title={program.name}
        description={`Rule: ${program.salesRequired} validated sale${program.salesRequired > 1 ? "s" : ""} = ${reward}, up to ${program.maxAwards}× ${PERIOD_WORD[program.kind]} per agent. Only validated sales count; pending, rejected and duplicate leads never do.`}
        actions={
          <div className="flex gap-2">
            <GhostButton onClick={showPreview} data-testid={`preview-${program.kind}`}>
              <Play className="h-4 w-4" /> Preview popup
            </GhostButton>
            <GhostButton onClick={restoreDefaults}>
              <RotateCcw className="h-4 w-4" /> Defaults
            </GhostButton>
          </div>
        }
      >
        <Toggle label="Campaign enabled" checked={program.enabled} onChange={(v) => set({ enabled: v })} />
        <TextField label="Campaign name" value={program.name} maxLength={40} onChange={(v) => set({ name: v })} />
        {num("Validated sales required", program.salesRequired, "salesRequired", "For one award.", 1, 500)}
        {num(`Bonus amount (${currency})`, program.amount, "amount", "Use 0 for a non-cash prize.", 0)}
        <TextField label="Prize instead of cash" hint="Shown when the amount is 0, e.g. Movie tickets." value={program.prizeLabel} maxLength={40} onChange={(v) => set({ prizeLabel: v })} />
        {num(`Reward limit ${PERIOD_WORD[program.kind]}`, program.maxAwards, "maxAwards", "Most awards one agent can earn in the period.", 1, 100)}
        <Field label="Active dates" hint="Optional. Leave empty to run every period.">
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" aria-label="Start date" value={program.startDate ?? ""} onChange={(e) => set({ startDate: e.target.value || null })} className={`${inputClass} max-w-[180px]`} />
            <span className="text-text-muted">to</span>
            <input type="date" aria-label="End date" value={program.endDate ?? ""} onChange={(e) => set({ endDate: e.target.value || null })} className={`${inputClass} max-w-[180px]`} />
          </div>
        </Field>
      </Section>

      <Section title="Popup & celebration" description="Placeholders: {agent}, {amount}, {sales}, {program}, {count}.">
        <TextField label="Headline" value={program.headline} maxLength={60} onChange={(v) => set({ headline: v })} />
        <TextField label="Message" value={program.message} maxLength={70} onChange={(v) => set({ message: v })} />
        <TextField label="Reward line" value={program.rewardLine} maxLength={70} onChange={(v) => set({ rewardLine: v })} />
        <SelectField label="Celebration sound" value={program.sound} options={SOUNDS} onChange={(v) => set({ sound: v })} />
        <Field label="Accent colour" hint="Popup glow, campaign card and feed.">
          <div className="flex items-center gap-3">
            <input type="color" aria-label="Accent colour" value={program.accent} onChange={(e) => set({ accent: e.target.value })} className="h-10 w-14 cursor-pointer rounded-lg border border-white/10 bg-transparent" />
            <span className="text-sm text-text-secondary tabular">{program.accent.toUpperCase()}</span>
          </div>
        </Field>
        <Range label="Popup duration" value={program.popupSeconds} min={3} max={20} onChange={(v) => set({ popupSeconds: v })} format={(v) => `${v}s`} />
        {program.kind !== "daily" && (
          <Range label={`${program.kind === "weekly" ? "Weekly" : "Monthly"} leaderboard rows`} value={program.leaderboardCount} min={3} max={15} onChange={(v) => set({ leaderboardCount: v })} />
        )}
        <div className="flex justify-end">
          <PrimaryButton onClick={showPreview}>
            <Play className="h-4 w-4" /> Preview popup
          </PrimaryButton>
        </div>
      </Section>

      <AnimatePresence>
        {preview && (
          <BonusCelebration
            awards={preview}
            program={program}
            agent={sample}
            team={teams.find((t) => t.id === sample?.teamId)}
            currency={currency}
            reducedMotion={false}
            onDone={() => setPreview(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
