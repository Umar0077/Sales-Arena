"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Howler } from "howler";
import { Activity, Monitor, RefreshCw, Volume2 } from "lucide-react";
import { audioEngine } from "@/frontend/audio/engine";
import { CELEBRATION_SOUNDS, celebrationSoundDiagnostics, prepareCelebrationSound } from "@/frontend/audio/celebration-sounds";
import { TIERS } from "@/frontend/features/celebrations/tiers";
import { useSettingsStore } from "@/frontend/stores/settings-store";
import { useRewardsStore } from "@/frontend/stores/rewards-store";
import { adminApi } from "@/frontend/components/admin/admin-api";
import { GhostButton, PrimaryButton } from "@/frontend/components/admin/ui";
import type { SoundCategory } from "@/shared/types";
import { cn } from "@/shared/utils";

type Status = "PASS" | "WARNING" | "FAIL";
type Check = { name: string; status: Status; detail: string; fix?: string };
type Device = { id: string; label: string; paired_at: string | null; revoked_at: string | null; last_seen_at: string | null };
type Ack = {
  display: string;
  device: { id: string; label: string } | null;
  at: string;
  result: { played: boolean; reason: string; readiness: string; contextState: string; soundEnabled: boolean; volume: number; saleCategory: boolean; engineLoaded: boolean; trumpetDecoded: boolean; screen: string; browser: string };
};

const CAT_LABEL: Partial<Record<SoundCategory, string>> = { sale: "Sale approved", target: "Target achieved", special: "Winning celebration", reveal: "Prize reveal", spinUnlocked: "Spin unlocked" };
const catName = (c: SoundCategory) => CAT_LABEL[c] ?? c;

async function checkAsset(src: string): Promise<{ status: number; decoded: boolean; seconds: number; error?: string }> {
  try {
    const r = await fetch(src, { cache: "no-store" });
    if (!r.ok) return { status: r.status, decoded: false, seconds: 0 };
    const ab = await r.arrayBuffer();
    const Off = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!Off) return { status: r.status, decoded: false, seconds: 0, error: "no Web Audio in this browser" };
    const b = await new Off(2, 1, 44100).decodeAudioData(ab);
    return { status: r.status, decoded: true, seconds: b.duration };
  } catch (e) {
    return { status: 0, decoded: false, seconds: 0, error: String(e) };
  }
}

/** Admin → Settings → Sound: "Run Sound Diagnostics" (this browser) and "Test Live Arena Sounds" (real displays). */
export function SoundDiagnostics() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    audioEngine.unlock(); // this click is a user gesture: the Admin browser may start audio
    await audioEngine.whenRunning(800);
    const s = useSettingsStore.getState();
    const out: Check[] = [];
    const on = s.soundEnabled !== false;
    out.push(on ? { name: "Master Sound Effects", status: "PASS", detail: "On." } : { name: "Master Sound Effects", status: "FAIL", detail: "Off: every Live Arena display is silent.", fix: "Switch Sound effects on above." });
    const v = s.volume ?? 0;
    out.push(
      v <= 0
        ? { name: "Master Volume", status: "FAIL", detail: "0%: nothing is audible.", fix: "Raise Master volume." }
        : v < 0.25
          ? { name: "Master Volume", status: "WARNING", detail: `${Math.round(v * 100)}%: very quiet on office TVs.`, fix: "Raise Master volume to 60–80%." }
          : { name: "Master Volume", status: "PASS", detail: `${Math.round(v * 100)}%.` },
    );
    const sale = s.soundCategories?.sale !== false;
    out.push(sale ? { name: "Sale Approved sound", status: "PASS", detail: "Enabled." } : { name: "Sale Approved sound", status: "FAIL", detail: "Disabled: validated sales and team celebrations are silent.", fix: "Tick Sale approved above." });
    const team = s.teamSaleSound !== false;
    out.push(
      !team
        ? { name: "Team Celebration Sounds", status: "FAIL", detail: "Teams Arena stinger switch is off.", fix: "Turn the team sale sound on (Admin → Teams Arena celebration settings)." }
        : !sale
          ? { name: "Team Celebration Sounds", status: "FAIL", detail: "On, but they also need Sale approved, which is off.", fix: "Tick Sale approved above." }
          : { name: "Team Celebration Sounds", status: "PASS", detail: "Sigma and Panthers sounds enabled." },
    );
    // Cash bonus: each program's own sound category gates the trumpet.
    const programs = useRewardsStore.getState().programs.filter((p) => (p as { active?: boolean }).active !== false);
    const offPrograms = programs.filter((p) => s.soundCategories?.[(p.sound ?? "target") as SoundCategory] === false);
    out.push(
      offPrograms.length
        ? { name: "Cash Bonus trumpet", status: "WARNING", detail: `Configured (${CELEBRATION_SOUNDS.bonus.src}), but silent for: ${offPrograms.map((p) => `${p.name} (${catName((p.sound ?? "target") as SoundCategory)} off)`).join(", ")}.`, fix: "Tick those categories above." }
        : { name: "Cash Bonus trumpet", status: "PASS", detail: `Configured: ${CELEBRATION_SOUNDS.bonus.label}${programs.length ? ` for ${programs.length} program(s)` : ""}.` },
    );
    const wCat = TIERS["weekly-top"].sound;
    out.push(
      s.soundCategories?.[wCat] === false
        ? { name: "Weekly Top Performer trumpet", status: "FAIL", detail: `Configured, but its category (${catName(wCat)}) is off.`, fix: `Tick ${catName(wCat)} above.` }
        : { name: "Weekly Top Performer trumpet", status: "PASS", detail: `Configured (category ${catName(wCat)}).` },
    );
    // Assets: the trumpet file (HTTP + decode) and the engine's in-browser sounds (sale, Sigma, Panthers).
    const a = await checkAsset(CELEBRATION_SOUNDS.bonus.src);
    out.push(
      a.decoded
        ? { name: "Sound assets", status: "PASS", detail: `Trumpet HTTP ${a.status}, decoded (${a.seconds.toFixed(1)} s). Sale, Sigma and Panthers sounds are generated in the browser (no download).` }
        : { name: "Sound assets", status: "FAIL", detail: `Trumpet ${a.status ? `HTTP ${a.status}` : "could not be fetched"}${a.error ? `: ${a.error}` : ""}; not decoded.`, fix: "Check the deployment contains public/audio/celebrations/cash-bonus-trumpet.wav." },
    );
    const ctx = Howler.ctx as AudioContext | undefined;
    const st = ctx?.state ?? "not created";
    out.push(
      st === "running"
        ? { name: "AudioContext (this Admin browser)", status: "PASS", detail: "running." }
        : st === "closed"
          ? { name: "AudioContext (this Admin browser)", status: "FAIL", detail: "closed.", fix: "Reload this page." }
          : { name: "AudioContext (this Admin browser)", status: "WARNING", detail: `${st}.`, fix: "Click anywhere on the page, then run the diagnostics again." },
    );
    const rd = audioEngine.readiness();
    out.push(
      rd === "running"
        ? { name: "Autoplay / audio unlock (this browser)", status: "PASS", detail: "Audio allowed." }
        : { name: "Autoplay / audio unlock (this browser)", status: rd === "unavailable" ? "FAIL" : "WARNING", detail: rd === "locked" ? "Blocked until someone clicks or presses a key." : rd, fix: "Click the page once. On office TVs: click once after each reload, or allow sound for this site in the browser's site settings." },
    );
    // Can each sound be scheduled through the real engine? (Checked without making a sound: use the previews to listen.)
    const loaded = audioEngine.loadedCategories();
    const trumpetReady = rd === "running" ? await prepareCelebrationSound("bonus") : false;
    const engineOk = loaded.loaded.includes("sale") && !loaded.failed.length;
    const sched = [
      ["Normal sale", engineOk && rd === "running"],
      ["Sigma", rd === "running"],
      ["Panthers", rd === "running"],
      ["Cash bonus / Weekly Top trumpet", trumpetReady],
    ] as const;
    const bad = sched.filter(([, ok]) => !ok).map(([n]) => n);
    out.push(
      bad.length
        ? { name: "Scheduling through the Live Arena engine", status: rd === "running" ? "FAIL" : "WARNING", detail: `Not schedulable now: ${bad.join(", ")}.`, fix: rd === "running" ? "Reload the page; if it persists, the browser cannot decode the sound." : "Audio is not allowed yet in this browser (see above)." }
        : { name: "Scheduling through the Live Arena engine", status: "PASS", detail: "All four sounds are loaded and can be scheduled (use the previews to listen)." },
    );
    const d = audioEngine.diag;
    const c = celebrationSoundDiagnostics();
    const errs = d.loadErrors + c.unavailable + (d.initError ? 1 : 0);
    const cancels = c.interrupted + c.late + c.suspended;
    out.push(
      errs
        ? { name: "Audio engine errors", status: "FAIL", detail: `${errs} failure(s)${d.lastError ? ` — ${d.lastError}` : ""}${d.initError ? ` — init: ${d.initError}` : ""}.`, fix: "Reload the page; report the message if it repeats." }
        : cancels
          ? { name: "Audio engine errors", status: "WARNING", detail: `No load errors; ${c.interrupted} interrupted, ${c.late} too late, ${c.suspended} skipped while suspended (this browser).`, fix: "Usually the device paused audio (sleep, Bluetooth/HDMI change). Click the page." }
          : { name: "Audio engine errors", status: "PASS", detail: `No failed loads or cancellations (this browser; ${d.plays} engine sound(s) played).` },
    );
    setChecks(out);
    setRunning(false);
  }, []);

  return (
    <div className="space-y-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3" data-testid="sound-diagnostics">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white">Sound diagnostics</p>
          <p className="text-xs text-text-muted">Settings checks apply to every display. Browser checks are for this Admin browser only — they do not prove an office TV can play sound.</p>
        </div>
        <PrimaryButton onClick={() => void run()} disabled={running} data-testid="run-sound-diagnostics" className="px-3 py-2 text-xs">
          <Activity className="h-3.5 w-3.5" /> {running ? "Checking…" : "Run Sound Diagnostics"}
        </PrimaryButton>
      </div>
      {checks && (
        <ul className="divide-y divide-white/[0.06] rounded-lg border border-white/[0.06]" data-testid="sound-diagnostics-results">
          {checks.map((c) => (
            <li key={c.name} className="flex gap-3 px-3 py-2 text-xs" data-testid="sound-check" data-status={c.status}>
              <StatusBadge status={c.status} />
              <div className="min-w-0">
                <p className="font-semibold text-white">{c.name}</p>
                <p className="text-text-secondary">{c.detail}</p>
                {c.fix && <p className="text-amber-200">Fix: {c.fix}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <LiveDisplayTest />
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={cn(
        "h-fit shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wider",
        status === "PASS" ? "bg-emerald-500/15 text-emerald-300" : status === "WARNING" ? "bg-amber-500/15 text-amber-300" : "bg-rose-500/15 text-rose-300",
      )}
    >
      {status}
    </span>
  );
}

function LiveDisplayTest() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [connected, setConnected] = useState<number | null>(null);
  const [testId, setTestId] = useState<string | null>(null);
  const [acks, setAcks] = useState<Ack[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const [d, t] = await Promise.all([adminApi<{ devices: Device[] }>("/api/admin/devices"), adminApi<{ connectedDisplays: number }>("/api/admin/sound-test")]);
    if (d.ok) setDevices(d.data.devices.filter((x) => x.paired_at && !x.revoked_at));
    if (t.ok) setConnected(t.data.connectedDisplays);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(t);
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  const send = async () => {
    const target = chosen.length ? `${chosen.length} chosen display(s)` : "every open Live Arena display";
    if (!window.confirm(`Play a short test sound on ${target}? No popup, sale, bonus or spin is created.`)) return;
    setError(null);
    setAcks([]);
    const r = await adminApi<{ id: string; connectedDisplays: number }>("/api/admin/sound-test", { method: "POST", body: chosen.length ? { devices: chosen } : {} });
    if (!r.ok) return setError(r.error);
    setTestId(r.data.id);
    setConnected(r.data.connectedDisplays);
    setWaiting(true);
    if (timer.current) clearInterval(timer.current);
    let n = 0;
    // A short wait for the acknowledgements (about 12 s), then it stops on its own.
    timer.current = setInterval(async () => {
      n++;
      const g = await adminApi<{ test: { acks: Ack[] } | null; connectedDisplays: number }>(`/api/admin/sound-test?id=${encodeURIComponent(r.data.id)}`);
      if (g.ok && g.data.test) setAcks(g.data.test.acks);
      if (n >= 8) {
        if (timer.current) clearInterval(timer.current);
        setWaiting(false);
      }
    }, 1500);
  };

  return (
    <div className="space-y-2 border-t border-white/[0.06] pt-3" data-testid="live-sound-test">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
            <Monitor className="h-3.5 w-3.5" /> Live Arena display checks
          </p>
          <p className="text-xs text-text-muted">
            Open live connections: {connected ?? "…"} (Live Arena screens and other open live pages). Each display reports its own audio state when tested.
          </p>
        </div>
        <div className="flex gap-2">
          <GhostButton onClick={() => void load()} className="px-2 py-2 text-xs" aria-label="Refresh displays">
            <RefreshCw className="h-3.5 w-3.5" />
          </GhostButton>
          <PrimaryButton onClick={() => void send()} disabled={waiting} data-testid="test-live-arena-sounds" className="px-3 py-2 text-xs">
            <Volume2 className="h-3.5 w-3.5" /> {waiting ? "Waiting for displays…" : "Test Live Arena Sounds"}
          </PrimaryButton>
        </div>
      </div>
      {devices.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="text-text-muted">Paired displays (none ticked = all open displays):</span>
          {devices.map((d) => (
            <label key={d.id} className="flex items-center gap-1 text-white">
              <input type="checkbox" className="accent-[#7568FF]" checked={chosen.includes(d.id)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, d.id] : c.filter((x) => x !== d.id)))} />
              {d.label}
            </label>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-rose-300">{error}</p>}
      {testId && (
        <div className="space-y-1" data-testid="live-sound-test-results">
          <p className="text-[11px] text-amber-200">Playback confirmation only: a display reports that its browser scheduled the sound. It cannot prove the TV speakers are on or audible.</p>
          {acks.length === 0 ? (
            <p className="text-xs text-text-muted">{waiting ? "Waiting for acknowledgements…" : "No display answered. Open displays may be offline, or on an older version of the app (reload them)."}</p>
          ) : (
            <ul className="divide-y divide-white/[0.06] rounded-lg border border-white/[0.06]">
              {acks.map((a) => {
                const status: Status = a.result.played ? "PASS" : a.result.reason.startsWith("Skipped") ? "WARNING" : a.result.reason.startsWith("Muted") ? "WARNING" : "FAIL";
                return (
                  <li key={a.display} className="flex gap-3 px-3 py-2 text-xs" data-testid="live-sound-ack" data-status={status}>
                    <StatusBadge status={status} />
                    <div className="min-w-0">
                      <p className="font-semibold text-white">
                        {a.device?.label ?? "Unpaired display"} <span className="font-normal text-text-muted">({a.display}, {a.result.screen})</span>
                      </p>
                      <p className="text-text-secondary">{a.result.reason}</p>
                      <p className="text-text-muted">
                        Audio: {a.result.readiness} (context {a.result.contextState}) · sound {a.result.soundEnabled ? "on" : "off"} · volume {Math.round(a.result.volume * 100)}% · sale sound {a.result.engineLoaded ? "loaded" : "not loaded"} · trumpet {a.result.trumpetDecoded ? "decoded" : "not decoded"}
                      </p>
                      {a.result.readiness === "locked" && <p className="text-amber-200">Fix: click once on that display (browsers block sound until then), or allow sound for this site in its browser settings.</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
