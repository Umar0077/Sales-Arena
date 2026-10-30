"use client";

import { useSettingsStore, fillTemplate } from "@/store/settings-store";
import { Section, Toggle, Range, Choice, TextField } from "@/components/admin/ui";

export default function CelebrationSettingsPage() {
  const s = useSettingsStore();
  const update = s.update;
  const sample = { agent: "ALI", sales: 2, spins: "1 Spin", prize: "GIFT VOUCHER" };

  return (
    <div className="space-y-6">
      <Section title="Spin rewards" description="Controls the target-completed popup and the spin journey on the Live Arena.">
        <Toggle label="Spin rewards enabled" hint="Master switch. Off hides SPIN NOW popups and launches." checked={s.spinFeatureEnabled} onChange={(v) => update({ spinFeatureEnabled: v })} />
        <Toggle label="Show SPIN NOW popup when a spin is earned" checked={s.spinFlowEnabled} onChange={(v) => update({ spinFlowEnabled: v })} />
        <Range
          label="Close unanswered popup after"
          hint="For unattended TVs. The spin stays available. 0 keeps it open."
          value={s.spinPopupTimeoutSec}
          min={0}
          max={120}
          step={5}
          onChange={(v) => update({ spinPopupTimeoutSec: v })}
          format={(v) => (v === 0 ? "Never" : `${v}s`)}
        />
        <p className="text-sm text-text-muted">After the prize reveal is fully shown, the Live Arena returns automatically after 4 seconds.</p>
      </Section>

      <Section title="Messages" description="Use {agent}, {sales}, {spins} and {prize} as placeholders.">
        <TextField label="Achievement headline" value={s.achievementHeadline} maxLength={60} onChange={(v) => update({ achievementHeadline: v })} />
        <TextField label="Achievement message" value={s.achievementMessage} maxLength={80} onChange={(v) => update({ achievementMessage: v })} />
        <TextField label="Reward line" value={s.achievementReward} maxLength={60} onChange={(v) => update({ achievementReward: v })} />
        <TextField label="Prize reveal headline" value={s.revealHeadline} maxLength={60} onChange={(v) => update({ revealHeadline: v })} />
        <TextField label="Prize reveal message" value={s.revealMessage} maxLength={60} onChange={(v) => update({ revealMessage: v })} />
        <div className="rounded-xl border border-gold/25 bg-gold/[0.06] p-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-text-muted">Preview</p>
          <p className="mt-2 font-heading text-xl font-extrabold text-white">{fillTemplate(s.achievementHeadline, sample)}</p>
          <p className="text-text-secondary">{fillTemplate(s.achievementMessage, sample)}</p>
          <p className="font-semibold text-gold">{fillTemplate(s.achievementReward, sample)}</p>
          <p className="mt-3 font-heading text-lg font-bold text-white">{fillTemplate(s.revealHeadline, sample)} <span className="text-gold">{fillTemplate(s.revealMessage, sample)}</span></p>
        </div>
        <Choice
          label="Prize reveal style"
          value={s.revealStyle}
          options={[{ value: "cinematic", label: "Cinematic" }, { value: "minimal", label: "Minimal" }]}
          onChange={(v) => update({ revealStyle: v })}
        />
      </Section>

      <Section title="Sale celebrations">
        <Choice
          label="Approved sale style"
          value={s.saleCelebrationStyle}
          options={[{ value: "toast", label: "Corner card" }, { value: "banner", label: "Top banner" }, { value: "off", label: "Off" }]}
          onChange={(v) => update({ saleCelebrationStyle: v })}
        />
        <Range label="Popup duration" value={s.celebrationDuration} min={2} max={12} onChange={(v) => update({ celebrationDuration: v })} format={(v) => `${v}s`} />
        <Toggle label="Announce floor milestones" hint="25%, 50%, 75% and 100% of today's target." checked={s.announceMilestones} onChange={(v) => update({ announceMilestones: v })} />
        <Toggle label="Announce team targets" checked={s.announceTeamTargets} onChange={(v) => update({ announceTeamTargets: v })} />
        <Choice
          label="Effects intensity"
          value={s.intensity}
          options={[{ value: "calm", label: "Calm" }, { value: "standard", label: "Standard" }, { value: "epic", label: "Epic" }]}
          onChange={(v) => update({ intensity: v })}
        />
        <Toggle label="Confetti & particles" checked={s.particles} onChange={(v) => update({ particles: v })} />
      </Section>
    </div>
  );
}
