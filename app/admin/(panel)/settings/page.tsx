"use client";

import { Play, RotateCcw } from "lucide-react";
import { useSettingsStore } from "@/store/settings-store";
import { audioEngine } from "@/lib/audio/engine";
import { WHEEL_THEMES } from "@/features/spins/wheel-theme";
import { QUALITY_PRESETS } from "@/lib/performance/quality";
import { Section, Toggle, Range, Choice, SelectField, GhostButton } from "@/components/admin/ui";
import { SpinnerPreview } from "@/components/admin/SpinnerPreview";
import type { QualitySetting, SoundCategory, SpinnerTheme } from "@/types";
import { cn } from "@/lib/utils";

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
  const update = s.update;

  const test = (cat: SoundCategory) => {
    audioEngine.unlock();
    if (cat === "wheelMove") {
      audioEngine.startLoop();
      audioEngine.setLoopIntensity(0.8);
      setTimeout(() => audioEngine.stopLoop(), 1200);
    } else audioEngine.play(cat);
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
                  onChange={(e) => s.setCategory(cat, e.target.checked)}
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
      </Section>

      <Section title="Rendering & performance">
        <SelectField<QualitySetting>
          label="Performance Mode"
          hint="Auto adapts rendering quality to device capabilities. Performance mode disables heavy GPU blurs and shadows for call center PCs."
          value={s.quality}
          options={[
            { value: "auto", label: `Auto (Detected: ${QUALITY_PRESETS[s.autoQuality]?.label ?? "High Quality"})` },
            { value: "high", label: "High Quality (Full 3D effects & smooth graphics)" },
            { value: "performance", label: "Performance (Fastest for low-end laptops & integrated GPUs)" },
          ]}
          onChange={(v) => update({ quality: v })}
        />
        <Toggle
          label="2D spinner fallback"
          hint="Use lightweight 2D canvas wheel instead of 3D WebGL on low-end systems."
          checked={s.spinnerFallback2D ?? false}
          onChange={(v) => update({ spinnerFallback2D: v })}
        />
        <Toggle label="Performance diagnostics" hint="Shows a frame-rate panel on screen." checked={s.diagnostics} onChange={(v) => update({ diagnostics: v })} />
        <Toggle label="Seeded test spins" hint="Same agent and spin number always gives the same prize (for QA)." checked={s.seededSpins} onChange={(v) => update({ seededSpins: v })} />
      </Section>

      <Section title="Reset">
        <GhostButton
          onClick={() => {
            if (confirm("Reset all appearance, sound, leaderboard and celebration settings to defaults?")) s.reset();
          }}
        >
          <RotateCcw className="h-4 w-4" /> Restore default settings
        </GhostButton>
      </Section>
    </div>
  );
}
