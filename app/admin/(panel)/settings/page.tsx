"use client";

import { saveSettings } from "@/frontend/admin/global-settings";
import { GlobalPerformanceCard } from "@/frontend/components/admin/GlobalPerformanceCard";
import { Play, RotateCcw } from "lucide-react";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/frontend/stores/settings-store";
import { GLOBAL_SETTING_KEYS } from "@/shared/settings/global-keys";
import type { DisplaySettings } from "@/shared/types";
import { audioEngine } from "@/frontend/audio/engine";
import { playCelebrationSound } from "@/frontend/audio/celebration-sounds";
import { playTeamStinger } from "@/frontend/audio/team-stingers";
import { WHEEL_THEMES } from "@/frontend/features/spins/wheel-theme";
import { Section, Toggle, Range, Choice, GhostButton } from "@/frontend/components/admin/ui";
import { SpinnerPreview } from "@/frontend/components/admin/SpinnerPreview";
import type { SoundCategory, SpinnerTheme } from "@/shared/types";
import { cn } from "@/shared/utils";

/** Admin previews: exactly the sounds the Live Arena plays for each notification. */
type CelebrationPreview = "sale" | "sigma" | "panthers" | "bonus";
const CELEBRATION_PREVIEWS: Array<[CelebrationPreview, string, string]> = [
  ["sale", "Preview Normal Sale Sound", "The validated-sale sound (Sale approved)"],
  ["sigma", "Preview Sigma Lion Sound", "Team Sigma celebration sound"],
  ["panthers", "Preview Panthers Sound", "Team Panthers celebration sound"],
  ["bonus", "Preview Cash Bonus Sound", "Cash bonus: trumpet celebration"],
];

const SOUND_LABELS: Record<SoundCategory, string> = {
  sale: "Sale approved",
  target: "Target achieved",
  spinUnlocked: "Spin unlocked",
  wheelActivate: "Wheel activation",
  wheelMove: "Wheel spinning hum",
  tick: "Wheel ticks",
  reveal: "Prize reveal",
  special: "Winning celebration",
  ui: "Interface clicks",
};

export default function AppearanceSoundPage() {
  const s = useSettingsStore();
  const update = saveSettings; // global settings → PostgreSQL → every display

  const test = (cat: SoundCategory) => {
    audioEngine.unlock();
    if (cat === "wheelMove") {
      audioEngine.startLoop();
      audioEngine.setLoopIntensity(0.8);
      setTimeout(() => audioEngine.stopLoop(), 1200);
    } else audioEngine.play(cat);
  };
  /** Plays on this Admin screen only: no request, no sale, no bonus, no spin, nothing sent to the displays. */
  const previewCelebration = (id: CelebrationPreview) => {
    audioEngine.unlock();
    // a tick later: the click has just resumed audio
    setTimeout(() => {
      const st = useSettingsStore.getState();
      if (id === "sale") audioEngine.play("sale");
      else if (id === "bonus") playCelebrationSound("bonus", { allowed: st.soundEnabled !== false });
      else playTeamStinger(id === "sigma" ? "lion" : "panther", { soundEnabled: st.soundEnabled, saleCategory: true, teamSaleSound: true });
    }, 60);
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_480px]">
        <Section title="Spinner appearance" description="Changes apply instantly to the Live Arena spinner and the preview.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(Object.keys(WHEEL_THEMES) as SpinnerTheme[]).map((key) => {
              const t = WHEEL_THEMES[key];
              const active = s.spinnerTheme === key;
              return (
                <button
                  key={key}
                  onClick={() => update({ spinnerTheme: key })}
                  aria-pressed={active}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-colors",
                    active ? "border-primary/70 bg-primary/10 ring-1 ring-primary/40" : "border-white/10 bg-white/[0.03] hover:border-white/20",
                  )}
                >
                  <div className="mb-2 flex gap-1">
                    {t.palette.map((c) => (
                      <span key={c} className="h-5 flex-1 rounded" style={{ background: c, boxShadow: `0 0 10px ${c}88` }} />
                    ))}
                  </div>
                  <span className="text-sm font-semibold text-white">{t.label}</span>
                </button>
              );
            })}
          </div>
          <Choice
            label="Segment colours"
            hint="Theme palette, or each prize's own colour (set in Spin & Rewards)."
            value={s.segmentColorMode}
            options={[{ value: "theme", label: "Theme palette" }, { value: "prize", label: "Prize colours" }]}
            onChange={(v) => update({ segmentColorMode: v })}
          />
          <Range label="Glow intensity" value={s.glowIntensity} min={0} max={1.5} step={0.05} onChange={(v) => update({ glowIntensity: v })} format={(v) => `${Math.round(v * 100)}%`} />
          <Toggle label="Idle light animation" hint="Gentle light chase around the wheel while waiting." checked={s.spinnerLights} onChange={(v) => update({ spinnerLights: v })} />
          <Range label="Light speed" value={s.lightSpeed} min={0.5} max={2} step={0.1} onChange={(v) => update({ lightSpeed: v })} format={(v) => `${v.toFixed(1)}×`} />
          <Range
            label="Spin duration"
            hint="About 7 seconds at 1.0×."
            value={s.spinDurationScale}
            min={0.6}
            max={1.6}
            step={0.05}
            onChange={(v) => update({ spinDurationScale: v })}
            format={(v) => `${(7 * v).toFixed(1)}s`}
          />
        </Section>

        <Section title="Preview">
          <SpinnerPreview />
        </Section>
      </div>

      <Section title="Sound" description="Browsers only play sound after someone clicks or presses a key on the page.">
        <Toggle label="Sound effects" checked={s.soundEnabled} onChange={(v) => update({ soundEnabled: v })} />
        <Range label="Master volume" value={s.volume} min={0} max={1} step={0.05} onChange={(v) => update({ volume: v })} format={(v) => `${Math.round(v * 100)}%`} />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(SOUND_LABELS) as SoundCategory[]).map((cat) => (
            <div key={cat} className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2">
              <label className="flex items-center gap-2 text-sm text-white">
                <input
                  type="checkbox"
                  checked={s.soundCategories[cat]}
                  onChange={(e) => update({ soundCategories: { ...s.soundCategories, [cat]: e.target.checked } })}
                  className="h-4 w-4 accent-[#7568FF]"
                />
                {SOUND_LABELS[cat]}
              </label>
              <button onClick={() => test(cat)} className="rounded-lg p-1.5 text-text-muted hover:bg-white/5 hover:text-white" aria-label={`Play ${SOUND_LABELS[cat]}`}>
                <Play className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="space-y-2 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3" data-testid="celebration-sound-previews">
          <p className="text-sm font-semibold text-white">Celebration sounds</p>
          <p className="text-xs text-text-muted">
            The exact sounds the Live Arena plays (validated sale, Team Sigma, Team Panthers, cash bonus trumpet). Preview plays on this screen only
            and creates no sale, bonus or spin. They follow Sound effects, Master volume and the categories above (Sale approved for sales and team
            sounds; the bonus program&apos;s category for bonuses). Spin &amp; Win sounds are separate and unchanged.
          </p>
          <div className="flex flex-wrap gap-2">
            {CELEBRATION_PREVIEWS.map(([id, label, title]) => (
              <GhostButton key={id} onClick={() => previewCelebration(id)} title={title} data-testid={`preview-sound-${id}`} className="px-3 py-2 text-xs">
                <Play className="h-3.5 w-3.5" /> {label}
              </GhostButton>
            ))}
          </div>
          {!s.soundEnabled && <p className="text-xs text-amber-300">Sound effects are off: previews are silent until you switch them on.</p>}
        </div>
      </Section>

      <div id="global-performance">
        <GlobalPerformanceCard />
      </div>

      <Section title="Rendering & performance">
        <p className="text-sm text-text-secondary">Performance Mode is a global setting for every screen. Set it under <a href="#global-performance" className="text-secondary hover:underline">Global Display Performance</a> above.</p>
        <Toggle
          label="2D spinner fallback"
          hint="Use lightweight 2D canvas wheel instead of 3D WebGL on low-end systems."
          checked={s.spinnerFallback2D ?? false}
          onChange={(v) => update({ spinnerFallback2D: v })}
        />
        <Toggle label="Performance diagnostics" hint="This browser only: shows a frame-rate panel on screen." checked={s.diagnostics} onChange={(v) => update({ diagnostics: v })} />
        <Toggle label="Seeded test spins" hint="Demo mode, this browser only. Live spins are always decided by the server." checked={s.seededSpins} onChange={(v) => update({ seededSpins: v })} />
      </Section>

      <Section title="Reset">
        <GhostButton
          onClick={() => {
            if (confirm("Restore default appearance, sound, leaderboard and celebration settings on EVERY screen? Arena on/off, screens, rewards and branding are kept.")) void update(resettableDefaults(), { immediate: true });
          }}
        >
          <RotateCcw className="h-4 w-4" /> Restore default settings
        </GhostButton>
      </Section>
    </div>
  );
}

/** Appearance / sound / leaderboard / celebration defaults. Arena availability, screens, rewards and branding are kept. */
const KEEP = new Set(["arenaEnabled", "arenaOfflineMessage", "arenaModes", "defaultArenaMode", "showModeSelector", "businessTimezone", "weekStartDay", "currencyLabel", "rewardCategories", "announceCash", "announcePrizes", "announceAutoSpins", "announceManualSpins", "customLogo", "brandName", "brandTagline"]);
function resettableDefaults(): Partial<DisplaySettings> {
  const d = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
  return Object.fromEntries(GLOBAL_SETTING_KEYS.filter((k) => !KEEP.has(k)).map((k) => [k, d[k]])) as Partial<DisplaySettings>;
}
