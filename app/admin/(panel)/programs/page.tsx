"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, MonitorPlay } from "lucide-react";
import { useSettingsStore } from "@/frontend/stores/settings-store";
import { ARENA_MODE_LABEL, ARENA_MODE_ORDER } from "@/frontend/stores/arena-mode-store";
import { saveSettings } from "@/frontend/admin/global-settings";
import { adminApi } from "@/frontend/components/admin/admin-api";
import { browserTimezone, isValidTimezone } from "@/shared/time/business";
import { Section, Field, Toggle, Choice, SelectField, TextField, GhostButton, inputClass } from "@/frontend/components/admin/ui";
import { Notice } from "@/frontend/components/admin/spins/shared";
import { ProgramsTab } from "@/frontend/components/admin/rewards/ProgramsTab";
import { AwardHistoryTab } from "@/frontend/components/admin/rewards/AwardHistoryTab";
import { AudienceReview } from "@/frontend/components/admin/rewards/AudienceReview";
import { cn } from "@/shared/utils";
import type { ArenaMode } from "@/shared/types";

const TABS = ["Arena Display", "Daily Rewards", "Weekly Rewards", "Monthly Rewards", "Spin & Win", "Award History"] as const;
type Tab = (typeof TABS)[number];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const COMMON_TZ = ["Asia/Karachi", "Asia/Dubai", "Asia/Kolkata", "Europe/London", "America/New_York", "UTC"];

export default function RewardProgramsPage() {
  const [tab, setTab] = useState<Tab>("Arena Display");
  // Senior / Junior bonus audience for the Daily / Weekly / Monthly tabs (same reward engine, separate programmes).
  const [audience, setAudience] = useState<"senior" | "junior">("senior");
  const bonusTab = tab === "Daily Rewards" || tab === "Weekly Rewards" || tab === "Monthly Rewards";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl font-bold text-white">Reward Programs & Arena Management</h2>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">
          Everything here is saved in PostgreSQL and applied to every connected Live Arena screen within seconds. Awards are created by the server from
          genuine Safe Quote validated sales only. Arena screen visibility never decides reward eligibility.
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

      {bonusTab && (
        <div className="space-y-4">
          <div role="tablist" aria-label="Bonus audience" className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1" data-testid="audience-tabs">
            {(["senior", "junior"] as const).map((a) => (
              <button
                key={a}
                role="tab"
                aria-selected={audience === a}
                onClick={() => setAudience(a)}
                data-testid={`audience-${a}`}
                className={cn("rounded-lg px-4 py-2 text-sm font-semibold transition-colors", audience === a ? (a === "senior" ? "bg-secondary/20 text-secondary" : "bg-[#A855F7]/20 text-[#C9A3FF]") : "text-text-secondary hover:text-white")}
              >
                {a === "senior" ? "Senior Bonuses" : "Junior Bonuses"}
              </button>
            ))}
          </div>
          {audience === "senior" ? <AudienceReview /> : (
            <Notice kind="info">
              Junior bonus programmes use the same reward engine (highest-tier upgrades, Award History, popups, Missing Awards recovery) with their own
              reward groups, so they never replace a Senior tier. None exist yet: Juniors earn no cash bonus until the Owner creates and activates one.
            </Notice>
          )}
        </div>
      )}
      {tab === "Arena Display" && <ArenaDisplayTab />}
      {tab === "Daily Rewards" && <ProgramsTab key={`daily-${audience}`} kind="daily" audience={audience} />}
      {tab === "Weekly Rewards" && <ProgramsTab key={`weekly-${audience}`} kind="weekly" audience={audience} />}
      {tab === "Monthly Rewards" && <ProgramsTab key={`monthly-${audience}`} kind="monthly" audience={audience} />}
      {tab === "Spin & Win" && <SpinTab />}
      {tab === "Award History" && <AwardHistoryTab />}
    </div>
  );
}

function ArenaDisplayTab() {
  const s = useSettingsStore();
  const [sent, setSent] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [tzDraft, setTzDraft] = useState(s.businessTimezone);
  const tzOk = tzDraft === "" || isValidTimezone(tzDraft);
  const enabled = ARENA_MODE_ORDER.filter((m) => s.arenaModes[m]);

  const switchNow = async (m: ArenaMode) => {
    setSent(null);
    const r = await adminApi("/api/admin/arena-config/screen", { method: "POST", body: { screen: m } });
    setSent(r.ok ? { kind: "ok", text: `Every connected Live Arena screen is switching to ${ARENA_MODE_LABEL[m]}.` } : { kind: "error", text: r.error });
  };

  return (
    <div className="space-y-6">
      <Section
        title="Live Arena screens"
        description="Which screens exist on every public display. A disabled screen is hidden everywhere and cannot be opened from the selector or a direct link. Its sales are still tracked, and its rewards follow the separate Program Active switch."
      >
        <div className="grid gap-x-6 sm:grid-cols-2" data-testid="screen-toggles">
          {ARENA_MODE_ORDER.map((m) => (
            <Toggle key={m} label={ARENA_MODE_LABEL[m]} checked={s.arenaModes[m] === true} onChange={(v) => void saveSettings({ arenaModes: { ...s.arenaModes, [m]: v } }, { immediate: true })} />
          ))}
        </div>
        {enabled.length === 0 && (
          <Notice kind="info">All public screens are disabled: every display shows the offline screen. The Admin Panel stays available.</Notice>
        )}
        {enabled.length > 0 && (
          <SelectField<ArenaMode>
            label="Default screen"
            hint="Newly opened displays start here. Displays already open stay on their screen; use “Switch the Live Arena now” to move them."
            value={s.arenaModes[s.defaultArenaMode] ? s.defaultArenaMode : enabled[0]}
            options={enabled.map((m) => ({ value: m, label: ARENA_MODE_LABEL[m] }))}
            onChange={(v) => void saveSettings({ defaultArenaMode: v }, { immediate: true })}
          />
        )}
        <Toggle
          label="Show screen selector on the Live Arena"
          hint="Off: the selector is hidden on every public display. Admins can still switch screens from here."
          checked={s.showModeSelector}
          onChange={(v) => void saveSettings({ showModeSelector: v }, { immediate: true })}
        />
        <Toggle
          label="Show the Teams Arena tab"
          hint="Off: Teams Arena stays reachable as the default screen, with “Switch the Live Arena now” or /?screen=teams, but its tab is hidden from the public selector."
          checked={s.teamsTabVisible !== false}
          onChange={(v) => void saveSettings({ teamsTabVisible: v }, { immediate: true })}
        />
        <Field label="Switch the Live Arena now" hint="Moves every connected display to this screen right away (also displays that reconnect later).">
          <div className="flex flex-wrap gap-2">
            {enabled.map((m) => (
              <GhostButton key={m} data-testid={`switch-${m}`} onClick={() => void switchNow(m)}>
                <MonitorPlay className="h-4 w-4" /> {ARENA_MODE_LABEL[m]}
              </GhostButton>
            ))}
          </div>
          {sent && <div className="mt-2"><Notice kind={sent.kind}>{sent.text}</Notice></div>}
        </Field>
      </Section>

      <Section
        title="Public announcements"
        description="Controls what appears publicly. Turning an announcement off never deletes earned awards or spin credits. Category switches are on each Daily / Weekly / Monthly tab."
      >
        <div className="grid gap-x-6 sm:grid-cols-2">
          <Toggle label="Celebration popups" hint="Master switch for reward and spin popups on every screen." checked={s.celebrationPopups} onChange={(v) => void saveSettings({ celebrationPopups: v }, { immediate: true })} />
          <Toggle label="Cash bonus announcements" checked={s.announceCash} onChange={(v) => void saveSettings({ announceCash: v }, { immediate: true })} />
          <Toggle label="Prize announcements" hint="Non-cash rewards: prizes, vouchers, badges, perks." checked={s.announcePrizes} onChange={(v) => void saveSettings({ announcePrizes: v }, { immediate: true })} />
          <Toggle label="Automatic spin announcements" checked={s.announceAutoSpins} onChange={(v) => void saveSettings({ announceAutoSpins: v }, { immediate: true })} />
          <Toggle label="Manual spin announcements" hint="When an admin allocates spins." checked={s.announceManualSpins} onChange={(v) => void saveSettings({ announceManualSpins: v }, { immediate: true })} />
          <Toggle label="Celebration sounds" checked={s.soundEnabled} onChange={(v) => void saveSettings({ soundEnabled: v }, { immediate: true })} />
        </div>
        <Choice
          label="Celebration intensity"
          value={s.intensity}
          options={[{ value: "calm", label: "Calm" }, { value: "standard", label: "Standard" }, { value: "epic", label: "Epic" }]}
          onChange={(v) => void saveSettings({ intensity: v })}
        />
        <Toggle label="Confetti & particles" checked={s.particles} onChange={(v) => void saveSettings({ particles: v })} />
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/admin/arena" className="font-semibold text-secondary hover:underline">Live Arena on / off →</Link>
          <Link href="/admin/celebrations" className="font-semibold text-secondary hover:underline">Popup durations & messages →</Link>
          <Link href="/admin/settings" className="font-semibold text-secondary hover:underline">Sounds & spinner look →</Link>
        </div>
      </Section>

      <Section
        title="Business calendar"
        description="Day, week and month boundaries for targets, leaderboards and rewards (server and displays). Daylight-saving changes follow the timezone. Several categories always count at the same time; use each category's Program Active switch to stop one."
      >
        <Field label="Business timezone" hint={`Empty = server default. This device: ${browserTimezone()}.`}>
          <div className="flex flex-wrap items-center gap-2">
            <input
              list="tz-options"
              value={tzDraft}
              onChange={(e) => setTzDraft(e.target.value)}
              onBlur={() => tzOk && tzDraft !== s.businessTimezone && void saveSettings({ businessTimezone: tzDraft }, { immediate: true })}
              placeholder="e.g. Asia/Karachi"
              className={cn(inputClass, "max-w-[260px]", !tzOk && "border-rose-500/60")}
              aria-invalid={!tzOk}
              data-testid="business-timezone"
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
          onChange={(v) => void saveSettings({ weekStartDay: Number(v) }, { immediate: true })}
        />
        <TextField label="Currency label (display)" value={s.currencyLabel} maxLength={6} onChange={(v) => v.trim() && void saveSettings({ currencyLabel: v })} />
        <p className="text-sm text-text-muted">
          Floor targets are managed in <Link href="/admin/targets" className="font-semibold text-secondary hover:underline">Target Management</Link>.
        </p>
      </Section>
    </div>
  );
}

function SpinTab() {
  const s = useSettingsStore();
  return (
    <div className="space-y-6">
      <Section title="Spin & Win" description="Spins are earned only from validated sales by their own server rules. Daily, weekly and monthly bonuses never add spins.">
        <Toggle
          label="Spin & Win screen"
          hint="Shows the Spin & Win screen on public displays."
          checked={s.arenaModes.spin}
          onChange={(v) => void saveSettings({ arenaModes: { ...s.arenaModes, spin: v } }, { immediate: true })}
        />
        <Toggle
          label="Spin rewards on the Live Arena"
          hint="Off hides SPIN NOW popups and launches on every screen. Earned credits are kept."
          checked={s.spinFeatureEnabled}
          onChange={(v) => void saveSettings({ spinFeatureEnabled: v }, { immediate: true })}
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { href: "/admin/spin-management", t: "Spin rules & automatic spins", d: "Sales per spin, activation cutoff, manual allocation" },
            { href: "/admin/rewards", t: "Prize wheel", d: "Add, edit, reorder and archive wheel prizes" },
            { href: "/admin/celebrations", t: "Spin popups", d: "SPIN NOW popup, messages, timeout" },
            { href: "/admin/spins", t: "Spin history", d: "Every spin from PostgreSQL" },
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
