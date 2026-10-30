"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, MonitorPlay, Trash2 } from "lucide-react";
import { useSettingsStore } from "@/store/settings-store";
import { useRewardsStore, programFor } from "@/store/rewards-store";
import { useArenaStore } from "@/store/arena-store";
import { ARENA_MODE_LABEL, ARENA_MODE_ORDER } from "@/store/arena-mode-store";
import { arenaBus } from "@/lib/events/bus";
import { browserTimezone, isValidTimezone } from "@/lib/time/business";
import { formatReward } from "@/lib/rewards/engine";
import { ProgramEditor } from "@/components/admin/ProgramEditor";
import { Section, Field, Toggle, Choice, SelectField, TextField, GhostButton, PrimaryButton, inputClass } from "@/components/admin/ui";
import { TimeAgo } from "@/components/common/TimeAgo";
import { cn } from "@/lib/utils";
import type { ArenaMode } from "@/types";

const TABS = ["Arena Display", "Daily Rewards", "Weekly Rewards", "Monthly Rewards", "Spin & Win", "Award History"] as const;
type Tab = (typeof TABS)[number];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const COMMON_TZ = ["Asia/Karachi", "Asia/Dubai", "Asia/Kolkata", "Europe/London", "America/New_York", "UTC"];

export default function RewardProgramsPage() {
  const [tab, setTab] = useState<Tab>("Arena Display");
  const programs = useRewardsStore((s) => s.programs);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl font-bold text-white">Reward Programs & Arena Management</h2>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">
          Daily, weekly and monthly bonuses and Spin &amp; Win are tracked separately, and only validated sales count. Demo mode:
          awards are calculated in this browser. In production, bonus eligibility and payouts must be confirmed by the backend.
        </p>
      </div>

      <div role="tablist" aria-label="Reward programs" className="flex flex-wrap gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn("rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors", tab === t ? "bg-primary text-white shadow" : "text-text-secondary hover:text-white")}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Arena Display" && <ArenaDisplayTab />}
      {tab === "Daily Rewards" && programFor(programs, "daily") && <ProgramEditor program={programFor(programs, "daily")!} />}
      {tab === "Weekly Rewards" && programFor(programs, "weekly") && <ProgramEditor program={programFor(programs, "weekly")!} />}
      {tab === "Monthly Rewards" && programFor(programs, "monthly") && <ProgramEditor program={programFor(programs, "monthly")!} />}
      {tab === "Spin & Win" && <SpinTab />}
      {tab === "Award History" && <HistoryTab />}
    </div>
  );
}

function ArenaDisplayTab() {
  const s = useSettingsStore();
  const update = s.update;
  const [sent, setSent] = useState<ArenaMode | null>(null);
  const [tzDraft, setTzDraft] = useState(s.businessTimezone);
  const tzOk = tzDraft === "" || isValidTimezone(tzDraft);
  const enabledCount = ARENA_MODE_ORDER.filter((m) => s.arenaModes[m]).length;

  return (
    <div className="space-y-6">
      <Section title="Live Arena screens" description="Choose which screens exist on the Live Arena and which one it opens on.">
        {ARENA_MODE_ORDER.map((m) => (
          <Toggle
            key={m}
            label={ARENA_MODE_LABEL[m]}
            checked={s.arenaModes[m]}
            onChange={(v) => {
              if (!v && enabledCount <= 1) return; // keep at least one screen
              update({ arenaModes: { ...s.arenaModes, [m]: v } });
            }}
          />
        ))}
        <SelectField<ArenaMode>
          label="Default screen"
          hint="Displays open on this screen. Changing it also switches open displays."
          value={s.defaultArenaMode}
          options={ARENA_MODE_ORDER.filter((m) => s.arenaModes[m]).map((m) => ({ value: m, label: ARENA_MODE_LABEL[m] }))}
          onChange={(v) => update({ defaultArenaMode: v })}
        />
        <Toggle
          label="Show screen selector on the Live Arena"
          hint="Off: only admins can switch screens, from here."
          checked={s.showModeSelector}
          onChange={(v) => update({ showModeSelector: v })}
        />
        <Field label="Switch the Live Arena now" hint="Sends the screen to Live Arena displays open in this browser.">
          <div className="flex flex-wrap gap-2">
            {ARENA_MODE_ORDER.filter((m) => s.arenaModes[m]).map((m) => (
              <GhostButton
                key={m}
                data-testid={`switch-${m}`}
                onClick={() => {
                  arenaBus.emit("arena:mode", { mode: m });
                  setSent(m);
                }}
              >
                <MonitorPlay className="h-4 w-4" /> {ARENA_MODE_LABEL[m]}
              </GhostButton>
            ))}
          </div>
          {sent && <p className="mt-2 text-sm text-emerald-300" role="status">Live Arena switched to {ARENA_MODE_LABEL[sent]}.</p>}
        </Field>
      </Section>

      <Section title="Program rules">
        <Toggle
          label="Programs run at the same time"
          hint="On: one validated sale can count for daily, weekly and monthly bonuses. Off: only the default screen's program awards. Spin & Win is controlled separately."
          checked={s.programsConcurrent}
          onChange={(v) => update({ programsConcurrent: v })}
        />
        <Field label="Business timezone" hint={`Day, week and month boundaries. Empty = this device (${browserTimezone()}).`}>
          <div className="flex flex-wrap items-center gap-2">
            <input
              list="tz-options"
              value={tzDraft}
              onChange={(e) => {
                setTzDraft(e.target.value);
                if (e.target.value === "" || isValidTimezone(e.target.value)) update({ businessTimezone: e.target.value });
              }}
              placeholder="e.g. Asia/Karachi"
              className={cn(inputClass, "max-w-[260px]", !tzOk && "border-rose-500/60")}
              aria-invalid={!tzOk}
            />
            <datalist id="tz-options">
              {COMMON_TZ.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
            {!tzOk && <span className="text-sm text-rose-400">Unknown timezone</span>}
          </div>
        </Field>
        <SelectField
          label="Week starts on"
          value={String(s.weekStartDay)}
          options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))}
          onChange={(v) => update({ weekStartDay: Number(v) })}
        />
        <Field label="Floor targets" hint="Validated sales for the whole floor, shown on the Weekly and Monthly screens.">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              Weekly
              <input type="number" min={1} value={s.weeklyFloorTarget} onChange={(e) => update({ weeklyFloorTarget: Math.max(1, Number(e.target.value) || 1) })} className={`${inputClass} w-28`} />
            </label>
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              Monthly
              <input type="number" min={1} value={s.monthlyFloorTarget} onChange={(e) => update({ monthlyFloorTarget: Math.max(1, Number(e.target.value) || 1) })} className={`${inputClass} w-28`} />
            </label>
          </div>
        </Field>
        <TextField label="Currency label" value={s.currencyLabel} maxLength={6} onChange={(v) => update({ currencyLabel: v })} />
      </Section>

      <Section title="Celebrations & sound" description="More options in Celebration Settings and Appearance & Sound.">
        <Choice
          label="Celebration intensity"
          value={s.intensity}
          options={[{ value: "calm", label: "Calm" }, { value: "standard", label: "Standard" }, { value: "epic", label: "Epic" }]}
          onChange={(v) => update({ intensity: v })}
        />
        <Toggle label="Sound effects" checked={s.soundEnabled} onChange={(v) => update({ soundEnabled: v })} />
        <Toggle label="Confetti & particles" checked={s.particles} onChange={(v) => update({ particles: v })} />
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/admin/leaderboard" className="font-semibold text-secondary hover:underline">Leaderboard appearance →</Link>
          <Link href="/admin/celebrations" className="font-semibold text-secondary hover:underline">Spin popups & messages →</Link>
          <Link href="/admin/settings" className="font-semibold text-secondary hover:underline">Sounds & spinner look →</Link>
        </div>
      </Section>
    </div>
  );
}

function SpinTab() {
  const spinOn = useSettingsStore((s) => s.spinFeatureEnabled);
  const update = useSettingsStore((s) => s.update);
  const rules = useArenaStore((s) => s.targetRules);
  const spins = useArenaStore((s) => s.spins);
  const def = rules.find((r) => r.teamId === null);
  const [perSpin, setPerSpin] = useState(def?.salesPerSpin ?? 2);

  return (
    <div className="space-y-6">
      <Section title="Spin & Win" description="Spins are earned only from validated sales, by their own rule. Daily, weekly and monthly bonuses never add spins.">
        <Toggle label="Spin & Win enabled" checked={spinOn} onChange={(v) => update({ spinFeatureEnabled: v })} />
        <Field label="Validated sales per spin" hint="Default rule. Team-specific rules are in Target Management.">
          <div className="flex items-center gap-2">
            <input type="number" min={1} max={50} value={perSpin} onChange={(e) => setPerSpin(Math.max(1, Number(e.target.value) || 1))} className={`${inputClass} w-24`} />
            <PrimaryButton
              disabled={!def || def.salesPerSpin === perSpin}
              onClick={() => def && useArenaStore.getState().upsertTargetRule({ ...def, salesPerSpin: perSpin })}
            >
              Save
            </PrimaryButton>
          </div>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { href: "/admin/rewards", t: "Prizes", d: "Add, edit, remove wheel prizes" },
            { href: "/admin/targets", t: "Eligibility rules", d: "Per-team sales per spin" },
            { href: "/admin/settings", t: "Spin animation", d: "Theme, glow, duration" },
            { href: "/admin/spins", t: "Spin history", d: `${spins.length} spins recorded` },
          ].map((l) => (
            <Link key={l.href} href={l.href} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-primary/40">
              <div className="flex items-center justify-between font-semibold text-white">
                {l.t} <ExternalLink className="h-4 w-4 text-text-muted" />
              </div>
              <p className="mt-1 text-xs text-text-muted">{l.d}</p>
            </Link>
          ))}
        </div>
      </Section>
    </div>
  );
}

function HistoryTab() {
  const awards = useRewardsStore((s) => s.awards);
  const currency = useSettingsStore((s) => s.currencyLabel);
  const [kind, setKind] = useState<"all" | "daily" | "weekly" | "monthly">("all");
  const rows = useMemo(() => (kind === "all" ? awards : awards.filter((a) => a.kind === kind)), [awards, kind]);
  const total = rows.reduce((t, a) => t + a.amount, 0);

  return (
    <Section
      title="Award history"
      description="Every bonus awarded, with the rule as it was at the time. Editing a program never changes past awards."
      actions={
        <GhostButton
          className="border-rose-500/30 text-rose-300"
          onClick={() => confirm("Delete all demo award history?") && useRewardsStore.getState().clearAwards()}
        >
          <Trash2 className="h-4 w-4" /> Clear demo history
        </GhostButton>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Choice
          label="Program"
          value={kind}
          options={[{ value: "all", label: "All" }, { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }]}
          onChange={setKind}
        />
      </div>
      <p className="text-sm text-text-secondary">
        {rows.length} award{rows.length === 1 ? "" : "s"} · total <b className="text-white">{currency} {total.toLocaleString("en-US")}</b>
      </p>
      <div className="overflow-x-auto rounded-xl border border-white/[0.07]">
        <table className="w-full min-w-[640px] text-sm" data-testid="award-history">
          <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wider text-text-muted">
            <tr>
              <th className="px-4 py-2.5">Agent</th>
              <th className="px-4 py-2.5">Program</th>
              <th className="px-4 py-2.5">Period</th>
              <th className="px-4 py-2.5">Rule then</th>
              <th className="px-4 py-2.5 text-right">Reward</th>
              <th className="px-4 py-2.5 text-right">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-text-muted">No awards yet.</td>
              </tr>
            )}
            {rows.slice(0, 100).map((a) => (
              <tr key={a.id}>
                <td className="px-4 py-2.5 font-medium text-white">{a.agentName}</td>
                <td className="px-4 py-2.5 text-text-secondary">{a.programName}</td>
                <td className="px-4 py-2.5 text-text-muted tabular">{a.periodKey.slice(2)} · #{a.n}</td>
                <td className="px-4 py-2.5 text-text-muted">{a.salesRequired} validated</td>
                <td className="px-4 py-2.5 text-right font-semibold text-gold tabular">{formatReward(a.amount, a.prizeLabel, currency)}</td>
                <td className="px-4 py-2.5 text-right text-text-muted"><TimeAgo iso={a.createdAt} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
