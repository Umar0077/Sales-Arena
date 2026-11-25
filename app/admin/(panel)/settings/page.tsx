"use client";

import { useEffect, useState } from "react";
import { saveSettings } from "@/frontend/admin/global-settings";
import { GlobalPerformanceCard } from "@/frontend/components/admin/GlobalPerformanceCard";
import { Play, RotateCcw, Eye, CheckCircle2, Sparkles, Monitor, Volume2 } from "lucide-react";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/frontend/stores/settings-store";
import { GLOBAL_SETTING_KEYS } from "@/shared/settings/global-keys";
import type {
  ArenaThemeId,
  DisplaySettings,
  SnowfallIntensity,
  SoundCategory,
  SpinnerTheme,
  VisualIntensity,
} from "@/shared/types";
import { audioEngine } from "@/frontend/audio/engine";
import { playCelebrationSound } from "@/frontend/audio/celebration-sounds";
import { playTeamStinger } from "@/frontend/audio/team-stingers";
import {
  formatSaleAnnouncement,
  listAvailableVoices,
  selectPreferredFemaleVoice,
  subscribeVoicesChanged,
  testVoiceAnnouncement,
  type VoiceInfo,
} from "@/frontend/audio/voice-announcer";
import { adminApi } from "@/frontend/components/admin/admin-api";
import { WHEEL_THEMES } from "@/frontend/features/spins/wheel-theme";
import { ARENA_THEMES, normalizeArenaTheme } from "@/frontend/theme/arena-theme";
import { Section, Toggle, Range, Choice, GhostButton, PrimaryButton, TextField, SelectField, Field } from "@/frontend/components/admin/ui";
import { SpinnerPreview } from "@/frontend/components/admin/SpinnerPreview";
import { ThemeTvPreview } from "@/frontend/components/admin/ThemeTvPreview";
import { SoundDiagnostics } from "@/frontend/components/admin/SoundDiagnostics";
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

  const activeTheme = normalizeArenaTheme(s.arenaTheme);
  const [selectedTheme, setSelectedTheme] = useState<ArenaThemeId | null>(null);
  const [previewTheme, setPreviewTheme] = useState<ArenaThemeId | null>(null);
  const [draftSnowfall, setDraftSnowfall] = useState<SnowfallIntensity | null>(null);
  const [draftSounds, setDraftSounds] = useState<boolean | null>(null);
  const [draftSantaCub, setDraftSantaCub] = useState<boolean | null>(null);
  const [draftEffects, setDraftEffects] = useState<VisualIntensity | null>(null);
  const [applyingTheme, setApplyingTheme] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [testAgentName, setTestAgentName] = useState("Arsam Idrees");
  const [voiceTestAgents, setVoiceTestAgents] = useState<string[]>([
    "Arsam Idrees",
    "Ali Sikandar",
    "Mansoor Arshad",
    "Hamna Nasir",
    "Roger Robinson",
  ]);
  const [voiceTesting, setVoiceTesting] = useState(false);

  useEffect(() => {
    const syncVoices = () => setVoices(listAvailableVoices());
    syncVoices();
    return subscribeVoicesChanged(syncVoices);
  }, []);

  useEffect(() => {
    let active = true;
    void adminApi<{ agents: Array<{ name: string }> }>("/api/admin/agent-emojis").then((res) => {
      if (!active || !res.ok || !res.data.agents?.length) return;
      const names = Array.from(new Set(res.data.agents.map((a) => a.name.trim()).filter(Boolean)));
      if (names.length > 0) {
        setVoiceTestAgents(names);
        setTestAgentName((prev) => (names.includes(prev) ? prev : names[0]));
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const recommendedAutoVoice = selectPreferredFemaleVoice(voices);

  const currentSelectedTheme = selectedTheme ?? activeTheme;
  const currentPreviewTheme = previewTheme ?? currentSelectedTheme;
  const currentSnowfall = draftSnowfall ?? s.christmasSnowfall ?? "light";
  const currentChristmasSounds = draftSounds ?? (s.christmasSounds !== false);
  const currentSantaCub = draftSantaCub ?? (s.christmasSantaCub !== false);
  const currentEffects = draftEffects ?? s.christmasEffectsIntensity ?? "standard";

  const handleSelectThemeCard = (themeId: ArenaThemeId) => {
    setSelectedTheme(themeId);
    setStatusNote(`Selected "${ARENA_THEMES[themeId].name}" in draft. Click "Preview Theme" to inspect or "Apply Theme" to broadcast to all Arena displays.`);
  };

  const handlePreviewTheme = () => {
    setPreviewTheme(currentSelectedTheme);
    setStatusNote(`Previewing "${ARENA_THEMES[currentSelectedTheme].name}" locally inside the 16:9 TV Preview below. Live Arena displays are unchanged.`);
  };

  const handleApplyTheme = async () => {
    const targetName = ARENA_THEMES[currentSelectedTheme].name;
    if (!confirm(`Apply "${targetName}" to all live Sales Arena displays right now?`)) return;
    setApplyingTheme(true);
    try {
      await update(
        {
          arenaTheme: currentSelectedTheme,
          christmasSnowfall: currentSnowfall,
          christmasSounds: currentChristmasSounds,
          christmasSantaCub: currentSantaCub,
          christmasEffectsIntensity: currentEffects,
        },
        { immediate: true },
      );
      setSelectedTheme(currentSelectedTheme);
      setPreviewTheme(currentSelectedTheme);
      setStatusNote(`Applied "${targetName}" to all live Sales Arena displays.`);
    } finally {
      setApplyingTheme(false);
    }
  };

  const handleResetToNormal = async () => {
    setSelectedTheme("normal");
    setPreviewTheme("normal");
    setApplyingTheme(true);
    try {
      await update({ arenaTheme: "normal" }, { immediate: true });
      setStatusNote("Reset live Sales Arena displays to Normal Arena.");
    } finally {
      setApplyingTheme(false);
    }
  };

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
      <Section
        title="Arena Theme"
        description="Switch the public Sales Arena broadcast experience between Normal Arena and the seasonal Christmas Edition. Selecting or previewing a theme here never affects live displays until you click Apply Theme."
        actions={
          <div
            data-testid="active-arena-theme"
            data-active-theme={activeTheme}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-bold tracking-wide",
              activeTheme === "christmas"
                ? "border-[#D8AF58]/60 bg-[#A61F32]/20 text-[#F5D68E]"
                : "border-primary/50 bg-primary/15 text-white",
            )}
          >
            <span className={cn("h-2 w-2 rounded-full", activeTheme === "christmas" ? "bg-[#F5D68E]" : "bg-emerald-400")} />
            Active Theme: {ARENA_THEMES[activeTheme].name}
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          {(["normal", "christmas"] as ArenaThemeId[]).map((themeId) => {
            const meta = ARENA_THEMES[themeId];
            const isSelected = currentSelectedTheme === themeId;
            const isLive = activeTheme === themeId;
            return (
              <button
                key={themeId}
                type="button"
                data-testid={`theme-card-${themeId}`}
                aria-pressed={isSelected}
                onClick={() => handleSelectThemeCard(themeId)}
                className={cn(
                  "group relative flex flex-col justify-between rounded-2xl border p-4 text-left transition-all",
                  isSelected
                    ? "border-primary/80 bg-primary/10 ring-2 ring-primary/40"
                    : "border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.05]",
                )}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-heading text-base font-extrabold text-white">
                          {themeId === "christmas" ? "🎄 " : ""}
                          {meta.name}
                        </span>
                        {isLive && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                            <CheckCircle2 className="h-3 w-3" /> Live Now
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs font-semibold text-secondary">{meta.subtitle}</p>
                    </div>
                    <div className="flex gap-1">
                      {meta.palette.map((hex) => (
                        <span
                          key={hex}
                          className="h-5 w-5 rounded-md border border-white/20 shadow-sm"
                          style={{ background: hex }}
                        />
                      ))}
                    </div>
                  </div>
                  <p className="mt-2.5 text-xs leading-relaxed text-text-secondary">{meta.description}</p>
                </div>

                <div className="mt-4 flex flex-wrap gap-1.5 border-t border-white/10 pt-3">
                  {meta.highlights.map((h) => (
                    <span
                      key={h}
                      className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium text-text-secondary"
                    >
                      {h}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        {/* Theme Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#070B16]/70 p-3.5">
          <div className="text-xs text-text-secondary">
            <span className="font-semibold text-white">Draft Selection:</span>{" "}
            <span data-testid="selected-draft-theme">{ARENA_THEMES[currentSelectedTheme].name}</span>
            {statusNote && <p className="mt-0.5 text-xs text-secondary">{statusNote}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <GhostButton
              type="button"
              data-testid="preview-theme-btn"
              onClick={handlePreviewTheme}
              disabled={applyingTheme}
            >
              <Eye className="h-4 w-4" /> Preview Theme
            </GhostButton>
            <PrimaryButton
              type="button"
              data-testid="apply-theme-btn"
              onClick={() => void handleApplyTheme()}
              disabled={applyingTheme}
            >
              <Sparkles className="h-4 w-4" /> {applyingTheme ? "Applying…" : "Apply Theme"}
            </PrimaryButton>
            <GhostButton
              type="button"
              data-testid="reset-normal-theme-btn"
              onClick={() => void handleResetToNormal()}
              disabled={applyingTheme || (activeTheme === "normal" && currentSelectedTheme === "normal")}
            >
              <RotateCcw className="h-4 w-4" /> Reset to Normal
            </GhostButton>
          </div>
        </div>

        {/* Christmas Edition Configuration Controls */}
        <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-4" data-testid="christmas-theme-controls">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-heading text-sm font-bold text-white">Christmas Edition Options</h3>
              <p className="text-xs text-text-muted">
                Fine-tune snowfall, seasonal sound effects, Santa Arena Cub outfit, and holiday visual polish.
              </p>
            </div>
          </div>

          <Choice
            label="Snowfall intensity"
            hint="Calm snow particles on public Arena screens (automatically reduced in Lite Mode)."
            value={currentSnowfall}
            options={[
              { value: "light", label: "Light (Recommended)" },
              { value: "medium", label: "Medium" },
              { value: "off", label: "Off" },
            ]}
            onChange={(v) => {
              setDraftSnowfall(v);
              if (activeTheme === "christmas") void update({ christmasSnowfall: v });
            }}
          />

          <Toggle
            label="Christmas seasonal sounds"
            hint="Use festive sleigh bells, holiday carol chimes, and Santa Arena Cub 'Ho Ho Ho' when Christmas Edition is active."
            checked={currentChristmasSounds}
            onChange={(v) => {
              setDraftSounds(v);
              if (activeTheme === "christmas") void update({ christmasSounds: v });
            }}
          />

          <Toggle
            label="Santa Arena Cub mascot"
            hint="Dress Arena Cub in a fitted Santa hat, red velvet coat, white plush fur trim, and gold buckle during Christmas Edition."
            checked={currentSantaCub}
            onChange={(v) => {
              setDraftSantaCub(v);
              if (activeTheme === "christmas") void update({ christmasSantaCub: v });
            }}
          />

          <Choice
            label="Holiday visual effects intensity"
            hint="Controls festive gold glow and celebratory ornament accents."
            value={currentEffects}
            options={[
              { value: "calm", label: "Calm" },
              { value: "standard", label: "Standard" },
              { value: "epic", label: "Epic" },
            ]}
            onChange={(v) => {
              setDraftEffects(v);
              if (activeTheme === "christmas") void update({ christmasEffectsIntensity: v });
            }}
          />
        </div>

        {/* 16:9 Office TV Preview */}
        <div className="space-y-2 pt-2">
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4 text-secondary" />
            <h3 className="font-heading text-sm font-bold text-white">
              16:9 Office TV Theme & Mascot Preview ({ARENA_THEMES[currentPreviewTheme].name})
            </h3>
          </div>
          <ThemeTvPreview
            theme={currentPreviewTheme}
            snowfall={currentSnowfall}
            christmasSounds={currentChristmasSounds}
            christmasSantaCub={currentSantaCub}
            effectsIntensity={currentEffects}
          />
        </div>
      </Section>

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
        <SoundDiagnostics />
      </Section>

      <Section
        title="Sale Voice Announcer"
        description="Friendly English female voice announcement that plays automatically right after the validated sale sound effect (Normal and Christmas Editions)."
      >
        <Toggle
          label="Enable Voice Announcements"
          hint="Announces '{Agent Name} got a sale!' after the sale sound completes on Daily, Weekly, Monthly, and Teams Arena."
          checked={s.voiceAnnouncerEnabled !== false}
          onChange={(v) => update({ voiceAnnouncerEnabled: v })}
        />

        <SelectField
          label="Select Available Voice"
          hint={
            recommendedAutoVoice
              ? `Auto-selected on this browser: ${recommendedAutoVoice.name} (${recommendedAutoVoice.lang})`
              : "Voices depend on the TV browser and OS. Auto mode picks the best available English female voice."
          }
          value={s.voiceAnnouncerVoice ?? ""}
          options={[
            { value: "", label: "Auto (Best Available English Female Voice)" },
            ...voices.map((v) => ({
              value: v.name,
              label: `${v.name} (${v.lang})`,
            })),
          ]}
          onChange={(v) => update({ voiceAnnouncerVoice: v })}
        />

        <Range
          label="Voice Volume"
          hint="Relative to master sound volume."
          value={s.voiceAnnouncerVolume ?? 0.85}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => update({ voiceAnnouncerVolume: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />

        <Range
          label="Speech Rate"
          hint="1.00× is natural conversational pace."
          value={s.voiceAnnouncerRate ?? 1.0}
          min={0.75}
          max={1.35}
          step={0.05}
          onChange={(v) => update({ voiceAnnouncerRate: v })}
          format={(v) => `${v.toFixed(2)}×`}
        />

        <TextField
          label="Announcement Text"
          hint="Use {Agent Name} as placeholder. Never includes internal IDs, carriers, or financial amounts."
          value={s.voiceAnnouncerTemplate ?? "{Agent Name} got a sale!"}
          maxLength={100}
          onChange={(v) => update({ voiceAnnouncerTemplate: v })}
        />

        <Field
          label="Announcement Text Preview"
          hint="Spoken locally in this Admin browser only — creates no sale and never broadcasts to office TVs."
        >
          <div className="space-y-3 rounded-xl border border-white/10 bg-[#070B16]/70 p-3.5" data-testid="voice-announcer-preview-box">
            <p className="font-heading text-sm font-bold text-white" data-testid="voice-announcement-preview-text">
              &ldquo;{formatSaleAnnouncement(testAgentName, s.voiceAnnouncerTemplate)}&rdquo;
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Test voice agent"
                data-testid="voice-test-agent-select"
                value={testAgentName}
                onChange={(e) => setTestAgentName(e.target.value)}
                className="rounded-xl border border-white/10 bg-[#0D1426] px-3 py-2 text-xs text-white focus:border-primary/60 focus:outline-none"
              >
                {voiceTestAgents.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <PrimaryButton
                type="button"
                data-testid="test-voice-btn"
                disabled={voiceTesting}
                onClick={() => {
                  setVoiceTesting(true);
                  void testVoiceAnnouncement({
                    agentName: testAgentName,
                    voiceName: s.voiceAnnouncerVoice,
                    volume: s.voiceAnnouncerVolume,
                    rate: s.voiceAnnouncerRate,
                    template: s.voiceAnnouncerTemplate,
                  }).finally(() => setVoiceTesting(false));
                }}
                className="px-3.5 py-2 text-xs"
              >
                <Volume2 className="h-3.5 w-3.5" />
                {voiceTesting ? "Speaking…" : "Test Voice Announcement"}
              </PrimaryButton>
            </div>
          </div>
        </Field>
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
