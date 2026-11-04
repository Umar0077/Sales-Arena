"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { saveSettings } from "@/lib/admin/global-settings";
import { appliedConfigRevision } from "@/lib/live/config-sync";
import { adminApi } from "@/components/admin/admin-api";
import { useSettingsStore } from "@/store/settings-store";
import { Section, Toggle, Range, Choice, Field, inputClass, GhostButton, PrimaryButton } from "@/components/admin/ui";
import { CubPlayer, type CubPlayerHandle } from "@/components/cub/CubPlayer";
import type { CubMotion } from "@/components/cub/CubStage";
import { CubDirector, type CubView } from "@/lib/cub/director";
import type { ArenaCubConfig, CubDialogue, CubScreen } from "@/lib/cub/config";
import { CUB_ACTION_LABEL, CUB_COMMAND_TTL_MS, CUB_EMOTIONS, CUB_MOVES, CUB_TRICKS, type CubAction, type CubCommandName, type CubTarget } from "@/lib/cub/actions";
import { charHeight } from "@/lib/cub/motion";
import { cn } from "@/lib/utils";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SCREENS: Array<{ k: CubScreen; label: string }> = [
  { k: "daily", label: "Daily Arena" },
  { k: "weekly", label: "Weekly Arena" },
  { k: "monthly", label: "Monthly Arena" },
  { k: "spin", label: "Spin & Win" },
];
const DIALOGUE: Array<{ k: CubDialogue; label: string }> = [
  { k: "intro", label: "Introduction" },
  { k: "hungry", label: "Hungry" },
  { k: "angry", label: "Playfully angry" },
  { k: "sad", label: "Sad" },
  { k: "feeding", label: "Validated sale" },
  { k: "bonus", label: "Bonus milestone" },
];
const PREVIEW_VISIBLE_KEY = "sales-arena:cub-preview-visible";
const GREET_COOLDOWN_S = 15;
/** Wall clock, read only from event handlers and timers. */
const clock = () => Date.now();

/** Saves part of arenaCub, but only once this page holds the server's settings (never a stale browser copy). */
function useCubSave() {
  const [warn, setWarn] = useState<string | null>(null);
  const save = async (patch: Partial<ArenaCubConfig>, immediate = false): Promise<boolean> => {
    if (appliedConfigRevision() < 0) {
      setWarn("Settings are still loading from the server. Try again in a moment.");
      return false;
    }
    setWarn(null);
    return saveSettings({ arenaCub: { ...useSettingsStore.getState().arenaCub, ...patch } }, { immediate });
  };
  return { save, warn };
}

/**
 * Admin → Celebrations → Arena Cub.
 *  1. Public Live Arena permission (OFF by default) and status;
 *  2. Private Preview Studio: local only, nothing is broadcast or stored;
 *  3. Live Mascot Controls: audited commands sent to connected displays over the existing SSE stream;
 *  4. Behaviour and timing (global settings in PostgreSQL arena.config → arenaCub).
 */
export function ArenaCubSettings() {
  const cub = useSettingsStore((s) => s.arenaCub);
  const tz = useSettingsStore((s) => s.businessTimezone);
  const { save, warn } = useCubSave();
  const set = (patch: Partial<ArenaCubConfig>) => void save(patch);

  return (
    <div className="space-y-6" data-testid="arena-cub-settings">
      <LivePermission cub={cub} save={save} warn={warn} />
      <PreviewStudio cfg={cub} set={set} />
      <LiveControls cub={cub} save={save} />

      <Section
        title="Arena Cub behaviour"
        description="Automatic behaviour on permitted Live Arena screens: fed by genuine validated sales, celebrates real bonus awards, gets playfully hungry when sales go quiet. It only reads sales and awards; it never creates or changes them."
      >
        <Toggle label="Arena Cub features" hint="Feature switch. Public screens also need “Allow on Live Arena”." checked={cub.enabled} onChange={(v) => set({ enabled: v })} />
        <Field label="Show on" hint="Spin & Win is off by default.">
          <div className="flex flex-wrap gap-2">
            {SCREENS.map(({ k, label }) => (
              <Chip key={k} on={cub.screens[k]} onClick={() => set({ screens: { ...cub.screens, [k]: !cub.screens[k] } })} testId={`cub-screen-${k}`}>
                {label}
              </Chip>
            ))}
          </div>
        </Field>
        <Toggle label="Introduction animation" checked={cub.intro} onChange={(v) => set({ intro: v })} />
        <Choice
          label="Play the introduction"
          hint="Per screen. A browser refresh does not replay it unless set to every load."
          value={cub.introFrequency}
          options={[
            { value: "daily", label: "Once a day" },
            { value: "hourly", label: "Once an hour" },
            { value: "every_load", label: "Every load" },
            { value: "off", label: "Never" },
          ]}
          onChange={(v) => set({ introFrequency: v })}
        />
        <Toggle label="Feeding celebration (validated sale)" checked={cub.feeding} onChange={(v) => set({ feeding: v })} />
        <Toggle label="Bonus milestone celebration" hint="Plays after the real bonus popup, with the award's own amount." checked={cub.bonus} onChange={(v) => set({ bonus: v })} />
        <Toggle label="Hunger reminders" hint="Off: the cub stays content however quiet it gets." checked={cub.hunger} onChange={(v) => set({ hunger: v })} />
        <Toggle label="Playfully angry state" checked={cub.angry} onChange={(v) => set({ angry: v })} />
        <Toggle label="Brief sad state" checked={cub.sad} onChange={(v) => set({ sad: v })} />
        <Toggle label="Speech bubbles" checked={cub.speech} onChange={(v) => set({ speech: v })} />
        <Field label="Dialogue" hint="Which automatic moments may speak.">
          <div className="flex flex-wrap gap-2">
            {DIALOGUE.map(({ k, label }) => (
              <Chip key={k} on={cub.dialogue[k]} onClick={() => set({ dialogue: { ...cub.dialogue, [k]: !cub.dialogue[k] } })}>
                {label}
              </Chip>
            ))}
          </div>
        </Field>
        <Toggle label="Mascot sounds" hint="Off by default. Also follows the global sound switch, and stays silent outside active hours." checked={cub.sounds} onChange={(v) => set({ sounds: v })} />
        <Range label="Mascot volume" value={Math.round(cub.volume * 100)} min={0} max={100} step={5} onChange={(v) => set({ volume: v / 100 })} format={(v) => `${v}%`} />
        <Toggle label="Confetti & golden particles" checked={cub.particles} onChange={(v) => set({ particles: v })} />
        <Choice
          label="Animation intensity"
          value={cub.intensity}
          options={[
            { value: "calm", label: "Calm" },
            { value: "standard", label: "Standard" },
            { value: "lively", label: "Lively" },
          ]}
          onChange={(v) => set({ intensity: v })}
        />
        <Choice
          label="Performance"
          hint="Automatic follows the global performance mode. Lite keeps blinking, celebrations and runs; drops idle extras and particles."
          value={cub.performance}
          options={[
            { value: "auto", label: "Automatic" },
            { value: "full", label: "Full" },
            { value: "lite", label: "Lite" },
          ]}
          onChange={(v) => set({ performance: v })}
        />
        <Choice
          label="Reduced motion"
          value={cub.reducedMotion}
          options={[
            { value: "system", label: "Follow the display" },
            { value: "always", label: "Always reduce" },
          ]}
          onChange={(v) => set({ reducedMotion: v })}
        />
      </Section>

      <Section title="Arena Cub timing" description={`Counted from the latest genuine validated sale in PostgreSQL, inside active hours (business timezone ${tz}). Every screen shows the same mood.`}>
        <Range label="Hungry after" value={cub.hungerMin} min={5} max={120} step={5} onChange={(v) => set({ hungerMin: Math.min(v, cub.angryMin - 1) })} format={(v) => `${v} min`} />
        <Range label="Playfully angry after" value={cub.angryMin} min={10} max={180} step={5} onChange={(v) => set({ angryMin: Math.min(Math.max(v, cub.hungerMin + 1), cub.sadMin - 1) })} format={(v) => `${v} min`} />
        <Range label="Brief sad moment after" hint="Then it rests quietly." value={cub.sadMin} min={15} max={240} step={5} onChange={(v) => set({ sadMin: Math.max(v, cub.angryMin + 1) })} format={(v) => `${v} min`} />
        <Range label="Remind every" value={cub.reminderEveryMin} min={5} max={60} step={5} onChange={(v) => set({ reminderEveryMin: v })} format={(v) => `${v} min`} />
        <Range label="Reminder cooldown" hint="No reminder this soon after any other cub moment." value={cub.reminderCooldownMin} min={0} max={30} onChange={(v) => set({ reminderCooldownMin: v })} format={(v) => `${v} min`} />
        <Range label="Speech bubble" value={cub.bubbleSec} min={3} max={12} onChange={(v) => set({ bubbleSec: v })} format={(v) => `${v}s`} />
        <Range label="Feeding celebration" value={cub.feedingSec} min={3} max={10} onChange={(v) => set({ feedingSec: v })} format={(v) => `${v}s`} />
        <Range label="Bonus celebration" value={cub.bonusSec} min={4} max={12} onChange={(v) => set({ bonusSec: v })} format={(v) => `${v}s`} />
        <Field label="Active sales hours" hint="Outside these hours the cub sleeps and never asks for sales.">
          <div className="flex flex-wrap items-center gap-2">
            <TimeInput label="Start" value={cub.activeStart} onChange={(v) => set({ activeStart: v })} />
            <span className="text-text-muted">to</span>
            <TimeInput label="End" value={cub.activeEnd} onChange={(v) => set({ activeEnd: v })} />
          </div>
        </Field>
        <Field label="Active days">
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d, i) => (
              <Chip
                key={d}
                on={cub.activeDays.includes(i)}
                onClick={() => set({ activeDays: cub.activeDays.includes(i) ? cub.activeDays.filter((x) => x !== i) : [...cub.activeDays, i].sort() })}
              >
                {d}
              </Chip>
            ))}
          </div>
        </Field>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- public permission

function Status({ label, on, onText, offText, testId }: { label: string; on: boolean; onText: string; offText: string; testId: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm">
      <span className={cn("h-2.5 w-2.5 rounded-full", on ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" : "bg-white/25")} />
      <span className="text-text-secondary">{label}:</span>
      <b className={on ? "text-emerald-300" : "text-text-muted"} data-testid={testId}>
        {on ? onText : offText}
      </b>
    </div>
  );
}

function usePreviewVisible() {
  const [v, setV] = useState(true);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREVIEW_VISIBLE_KEY);
      if (raw !== null) {
        const t = setTimeout(() => setV(raw === "1"), 0);
        return () => clearTimeout(t);
      }
    } catch {
      /* ignore */
    }
  }, []);
  const set = (x: boolean) => {
    setV(x);
    try {
      localStorage.setItem(PREVIEW_VISIBLE_KEY, x ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
  return [v, set] as const;
}

function LivePermission({ cub, save, warn }: { cub: ArenaCubConfig; save: (p: Partial<ArenaCubConfig>, immediate?: boolean) => Promise<boolean>; warn: string | null }) {
  const [confirming, setConfirming] = useState(false);
  const live = cub.allowOnLiveArena;
  return (
    <Section
      title="Arena Cub on the public Live Arena"
      description="OFF by default. The Private Preview Studio below always works and never affects office displays. Only when you allow it here does the cub appear on permitted Live Arena screens."
    >
      <div className="flex flex-wrap gap-3" data-testid="cub-statuses">
        <Status label="Public Live Arena Mascot" on={live} onText="Enabled" offText="Disabled" testId="cub-live-status" />
        <PreviewStatusBadge />
      </div>
      {!live && !confirming && (
        <PrimaryButton data-testid="cub-allow-live" onClick={() => setConfirming(true)}>
          Allow Arena Cub on Live Arena
        </PrimaryButton>
      )}
      {!live && confirming && (
        <div role="alertdialog" aria-label="Confirm showing Arena Cub on Live Arena" className="rounded-xl border border-amber-300/40 bg-amber-300/[0.07] p-4 text-sm text-amber-100" data-testid="cub-allow-confirm">
          <p className="font-semibold">Show Arena Cub on connected office displays?</p>
          <p className="mt-1 text-amber-100/80">
            The mascot will appear on every connected Live Arena screen that has it enabled (Daily / Weekly / Monthly switches), react to genuine validated sales and bonus awards, and accept your live commands. You can hide it again at any time.
          </p>
          <div className="mt-3 flex gap-2">
            <PrimaryButton
              data-testid="cub-allow-confirm-yes"
              onClick={async () => {
                if (await save({ allowOnLiveArena: true }, true)) setConfirming(false);
              }}
            >
              Yes, show it on Live Arena
            </PrimaryButton>
            <GhostButton onClick={() => setConfirming(false)}>Cancel</GhostButton>
          </div>
        </div>
      )}
      {live && (
        <GhostButton data-testid="cub-hide-live" onClick={() => void save({ allowOnLiveArena: false }, true)}>
          Hide Arena Cub from All Live Screens
        </GhostButton>
      )}
      {warn && <p className="text-sm text-amber-200">{warn}</p>}
    </Section>
  );
}

// Private-preview visibility is shared between the status badge and the studio within this tab.
const previewVisibleListeners = new Set<(v: boolean) => void>();
let previewVisibleNow = true;
function setPreviewVisibleShared(v: boolean) {
  previewVisibleNow = v;
  previewVisibleListeners.forEach((f) => f(v));
}
function PreviewStatusBadge() {
  const [v, setV] = useState(previewVisibleNow);
  useEffect(() => {
    const f = (x: boolean) => setV(x);
    previewVisibleListeners.add(f);
    return () => {
      previewVisibleListeners.delete(f);
    };
  }, []);
  return <Status label="Private Admin Preview" on={v} onText="Visible" offText="Hidden" testId="cub-preview-status" />;
}

// ---------------------------------------------------------------- private preview studio

/**
 * Admin-only: plays everything locally in this browser. No request is sent, nothing is stored or
 * broadcast, and no sale, award or spin is created. Works even while the Live Arena permission is OFF.
 */
function PreviewStudio({ cfg, set }: { cfg: ArenaCubConfig; set: (p: Partial<ArenaCubConfig>) => void }) {
  const [visible, setVisible] = usePreviewVisible();
  const [view, setView] = useState<CubView | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<CubPlayerHandle | null>(null);
  const dRef = useRef<CubDirector | null>(null);
  const seq = useRef(0);
  // One object per saved-settings change (not per render): the director re-renders this component,
  // so a fresh object every render fed back into setConfig was an endless render loop that starved
  // Next.js navigation (sidebar clicks never completed).
  const previewCfg = useMemo(() => ({ ...cfg, enabled: true, intro: true, feeding: true, bonus: true, hunger: true, angry: true, sad: true }), [cfg]);
  const cfgRef = useRef(previewCfg);
  useEffect(() => {
    cfgRef.current = previewCfg;
    dRef.current?.setConfig(previewCfg);
  }, [previewCfg]);

  useEffect(() => setPreviewVisibleShared(visible), [visible]);

  useEffect(() => {
    const d = new CubDirector(cfgRef.current, { now: () => Date.now(), render: setView, moveSec: (a, id) => playerRef.current?.moveSec(a, id) ?? 6 });
    dRef.current = d;
    setView(d.view());
    return () => {
      d.dispose();
      dRef.current = null;
    };
  }, []);
  useEffect(() => dRef.current?.setVisible(visible), [visible]);

  const play = (action: CubAction) => dRef.current?.push({ kind: "command", id: `preview-${Date.now()}-${seq.current++}`, action });
  const motion: CubMotion = cfg.reducedMotion === "always" ? "reduced" : cfg.performance === "lite" ? "lite" : "full";
  const btn = "px-3 py-2 text-xs";
  const height1080 = charHeight(cfg, { w: 1920, h: 1080 });

  return (
    <Section
      title="Arena Cub — Private Preview Studio"
      description="Admin only. Everything here plays in this browser: nothing is broadcast to Live Arena screens, nothing is saved by these buttons, and no sale, award or spin is created."
      actions={
        visible ? (
          <GhostButton data-testid="cub-preview-hide" className={btn} onClick={() => setVisible(false)}>
            Hide Admin Preview
          </GhostButton>
        ) : (
          <PrimaryButton data-testid="cub-preview-show" className={btn} onClick={() => setVisible(true)}>
            Show in Admin Preview
          </PrimaryButton>
        )
      }
    >
      <div
        ref={boxRef}
        data-testid="cub-preview-stage"
        className="relative h-[440px] overflow-hidden rounded-2xl border border-white/[0.07] bg-[radial-gradient(ellipse_at_50%_95%,rgba(124,58,237,0.28),transparent_60%),linear-gradient(180deg,#0B1124,#070B16)]"
      >
        <span className="absolute left-3 top-3 rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary">Preview · scaled stage</span>
        {visible && view && (
          <CubPlayer
            view={view}
            cfg={cfg}
            frame="box"
            boxRef={boxRef}
            motion={motion}
            particles={cfg.particles && motion === "full"}
            testId="cub-preview"
            handleRef={playerRef}
            onMoveAborted={() => dRef.current?.utility("home")}
          />
        )}
        {!visible && <p className="absolute inset-0 grid place-items-center text-sm text-text-muted">Admin preview hidden.</p>}
      </div>
      <p className="text-xs text-text-muted" data-testid="cub-preview-state">
        Showing: {view?.pose ?? "—"}
        {view?.command ? ` (${CUB_ACTION_LABEL[view.command.action]})` : ""}
      </p>

      <div className="space-y-3">
        <ButtonRow title="Greeting & emotions">
          <GhostButton className={btn} onClick={() => play("greet")}>Preview Greeting</GhostButton>
          <GhostButton className={btn} onClick={() => dRef.current?.push({ kind: "intro" })}>Preview Intro</GhostButton>
          {CUB_EMOTIONS.map((a) => (
            <GhostButton key={a} className={btn} onClick={() => play(a)}>
              Preview {CUB_ACTION_LABEL[a]}
            </GhostButton>
          ))}
        </ButtonRow>
        <ButtonRow title="Movement">
          {CUB_MOVES.map((a) => (
            <GhostButton key={a} className={btn} onClick={() => play(a)}>
              Preview {CUB_ACTION_LABEL[a]}
            </GhostButton>
          ))}
        </ButtonRow>
        <ButtonRow title="Tricks & celebrations">
          {CUB_TRICKS.filter((a) => a !== "greet").map((a) => (
            <GhostButton key={a} className={btn} onClick={() => play(a)}>
              Preview {a === "eat_token" ? "Feeding (golden token)" : a === "celebrate" ? "Bonus Celebration" : CUB_ACTION_LABEL[a]}
            </GhostButton>
          ))}
        </ButtonRow>
        <ButtonRow title="Utility">
          <GhostButton className={btn} onClick={() => dRef.current?.utility("home")}>Preview Return Home</GhostButton>
          <GhostButton className={btn} onClick={() => dRef.current?.utility("stop")}>Preview Stop Animation</GhostButton>
          <GhostButton className={btn} onClick={() => dRef.current?.utility("reset")}>Reset Preview</GhostButton>
        </ButtonRow>
      </div>

      <div className="space-y-4 border-t border-white/[0.06] pt-4">
        <p className="text-xs text-text-muted">Size and home position are saved settings: they apply to the Live Arena too (when allowed).</p>
        <Choice
          label="Mascot size"
          hint={`About ${height1080}px tall on a 1920×1080 display; scales with each screen.`}
          value={cfg.sizePreset}
          options={[
            { value: "small", label: "Small" },
            { value: "medium", label: "Medium" },
            { value: "large", label: "Large" },
            { value: "xl", label: "Extra Large" },
            { value: "custom", label: "Custom" },
          ]}
          onChange={(v) => set({ sizePreset: v })}
        />
        {cfg.sizePreset === "custom" && (
          <Range label="Custom height (at 1080p)" value={Math.min(450, Math.max(100, cfg.size))} min={100} max={450} step={10} onChange={(v) => set({ size: v })} format={(v) => `${v}px`} />
        )}
        <Choice
          label="Home position"
          hint="Where the cub rests; every run starts and ends here."
          value={cfg.position === "auto" ? "bottom-right" : cfg.position}
          options={[
            { value: "bottom-right", label: "Bottom right" },
            { value: "bottom-left", label: "Bottom left" },
            { value: "bottom-center", label: "Bottom center" },
            { value: "custom", label: "Custom" },
          ]}
          onChange={(v) => set({ position: v })}
        />
        {cfg.position === "custom" && (
          <>
            <Range label="Custom home: across" value={cfg.homeX} min={0} max={100} onChange={(v) => set({ homeX: v })} format={(v) => `${v}%`} />
            <Range label="Custom home: floor line" value={cfg.homeY} min={20} max={100} onChange={(v) => set({ homeY: v })} format={(v) => `${v}%`} />
          </>
        )}
      </div>
    </Section>
  );
}

function ButtonRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">{title}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- live controls

interface Device {
  id: string;
  label: string;
  paired_at: string | null;
  revoked_at: string | null;
}

/** Sends audited, allowlisted actions to connected Live Arena displays over the existing SSE stream. */
function LiveControls({ cub, save }: { cub: ArenaCubConfig; save: (p: Partial<ArenaCubConfig>, immediate?: boolean) => Promise<boolean> }) {
  const [scope, setScope] = useState<"all" | "daily" | "weekly" | "monthly" | "devices">("all");
  const [devices, setDevices] = useState<Device[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [greetConfirm, setGreetConfirm] = useState(false);
  const [greetUntil, setGreetUntil] = useState(0);
  const [now, setNow] = useState(0);
  const live = cub.allowOnLiveArena;

  useEffect(() => {
    void adminApi<{ devices: Device[] }>("/api/admin/devices").then((r) => {
      if (r.ok) setDevices(r.data.devices.filter((d) => d.paired_at && !d.revoked_at));
    });
  }, []);
  // Greeting cooldown countdown (clock read in the timer, never during render).
  useEffect(() => {
    if (!greetUntil) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= greetUntil) clearInterval(t);
    }, 500);
    return () => clearInterval(t);
  }, [greetUntil]);

  const target = (): CubTarget => (scope === "all" ? { scope: "all" } : scope === "devices" ? { scope: "devices", devices: picked } : { scope: "screen", screen: scope });
  const where = scope === "all" ? "all live screens" : scope === "devices" ? `${picked.length} selected display${picked.length === 1 ? "" : "s"}` : `the ${scope[0].toUpperCase()}${scope.slice(1)} Arena`;

  const send = async (action: CubCommandName) => {
    if (scope === "devices" && !picked.length) return setMsg({ kind: "error", text: "Select at least one paired display." });
    setBusy(true);
    const r = await adminApi<{ command: { id: string } }>("/api/admin/arena-cub/command", { method: "POST", body: { action, target: target() } });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "error", text: r.error });
    if (action === "greet") {
      const n = clock();
      setNow(n);
      setGreetUntil(n + GREET_COOLDOWN_S * 1000);
    }
    setMsg({ kind: "ok", text: `${CUB_ACTION_LABEL[action]} sent to ${where} (ignored by screens that receive it more than ${CUB_COMMAND_TTL_MS / 1000}s late).` });
  };

  const greetLeft = greetUntil > now ? Math.ceil((greetUntil - now) / 1000) : 0;
  const btn = "px-3 py-2 text-xs";
  const liveBtn = (a: CubCommandName) => (
    <GhostButton key={a} className={btn} disabled={!live || busy} onClick={() => void send(a)} data-testid={`cub-live-${a}`}>
      {CUB_ACTION_LABEL[a]} on live screens
    </GhostButton>
  );

  return (
    <Section
      title="Live Mascot Controls"
      description="These buttons act on connected office displays. Each action is checked and recorded in the audit log on the server, then sent over the live stream. A genuine bonus or validated sale always takes priority; visual celebrations here never create or claim a sale or award."
    >
      {!live && <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-text-muted">Live controls are off while “Allow Arena Cub on Live Arena” is disabled.</p>}

      <div className="flex flex-wrap items-center gap-2">
        {!greetConfirm && (
          <PrimaryButton
            data-testid="cub-greet-live"
            disabled={busy || greetLeft > 0}
            onClick={() => (live ? void send("greet") : setGreetConfirm(true))}
          >
            👋 Greet on All Live Screens{greetLeft > 0 ? ` (${greetLeft}s)` : ""}
          </PrimaryButton>
        )}
        {greetConfirm && (
          <div role="alertdialog" aria-label="Show Arena Cub and greet" className="rounded-xl border border-amber-300/40 bg-amber-300/[0.07] p-3 text-sm text-amber-100" data-testid="cub-greet-confirm">
            <p>Arena Cub is hidden on Live Arena screens. Show it on connected office displays and greet everyone?</p>
            <div className="mt-2 flex gap-2">
              <PrimaryButton
                data-testid="cub-greet-confirm-yes"
                onClick={async () => {
                  setGreetConfirm(false);
                  if (!(await save({ allowOnLiveArena: true }, true))) return;
                  setTimeout(() => void send("greet"), 1500); // let displays show the cub first
                }}
              >
                Show and greet
              </PrimaryButton>
              <GhostButton onClick={() => setGreetConfirm(false)}>Cancel</GhostButton>
            </div>
          </div>
        )}
      </div>

      <Field label="Send to" hint="Paired displays are identified by the server from their pairing; unpaired screens only get All / screen commands.">
        <select aria-label="Send to" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} className={cn(inputClass, "max-w-xs")} data-testid="cub-live-target">
          <option value="all" className="bg-[#0D1426]">All Live Arena screens</option>
          <option value="daily" className="bg-[#0D1426]">Daily Arena only</option>
          <option value="weekly" className="bg-[#0D1426]">Weekly Arena only</option>
          <option value="monthly" className="bg-[#0D1426]">Monthly Arena only</option>
          {devices.length > 0 && <option value="devices" className="bg-[#0D1426]">Selected paired displays</option>}
        </select>
      </Field>
      {scope === "devices" && (
        <div className="flex flex-wrap gap-2">
          {devices.map((d) => (
            <Chip key={d.id} on={picked.includes(d.id)} onClick={() => setPicked((p) => (p.includes(d.id) ? p.filter((x) => x !== d.id) : [...p, d.id]))}>
              {d.label}
            </Chip>
          ))}
        </div>
      )}

      <ButtonRow title="Character emotions">
        {CUB_EMOTIONS.map(liveBtn)}
      </ButtonRow>
      <ButtonRow title="Character actions">
        {[...CUB_MOVES, ...CUB_TRICKS.filter((a) => a !== "greet")].map((a) => liveBtn(a))}
      </ButtonRow>
      <ButtonRow title="Utility">
        {liveBtn("home")}
        {liveBtn("reset")}
        {liveBtn("stop")}
        {live ? (
          <GhostButton className={btn} onClick={() => void save({ allowOnLiveArena: false }, true)} data-testid="cub-live-hide">
            Hide Mascot on All Live Screens
          </GhostButton>
        ) : (
          <span className="self-center text-xs text-text-muted">Show Mascot: use “Allow Arena Cub on Live Arena” above.</span>
        )}
      </ButtonRow>
      {msg && (
        <p className={cn("text-sm", msg.kind === "ok" ? "text-emerald-300" : "text-red-300")} data-testid="cub-live-msg">
          {msg.text}
        </p>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- small controls

function Chip({ on, onClick, children, testId }: { on: boolean; onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-testid={testId}
      onClick={onClick}
      className={cn("rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors", on ? "border-primary/60 bg-primary/90 text-white" : "border-white/10 bg-white/[0.03] text-text-secondary hover:text-white")}
    >
      {children}
    </button>
  );
}

function TimeInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="time"
      aria-label={label}
      value={value}
      onChange={(e) => /^\d{2}:\d{2}$/.test(e.target.value) && onChange(e.target.value)}
      className={cn(inputClass, "w-32")}
    />
  );
}
