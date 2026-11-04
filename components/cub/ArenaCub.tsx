"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type CubMotion } from "./CubStage";
import { CubPlayer, type CubPlayerHandle } from "./CubPlayer";
import { CubDirector, type CubView } from "@/lib/cub/director";
import { ambient, activeWindow, cubVisibleOn, isFreshSale, RecentIds, shouldPlayIntro, type CubAward } from "@/lib/cub/machine";
import { isCubAction, isCubCommand, type CubCommand } from "@/lib/cub/actions";
import { playCubSound, stopCubSound } from "@/lib/cub/sounds";
import { useLiveStore } from "@/store/live-store";
import { arenaBus } from "@/lib/events/bus";
import { useSettingsStore } from "@/store/settings-store";
import { useArenaMode } from "@/store/arena-mode-store";
import { useSpinFlowStore } from "@/store/spin-flow-store";
import { useBonusFlowStore } from "@/store/bonus-flow-store";
import { useReducedMotion } from "@/lib/performance/reduced-motion";

/**
 * Arena Cub on the public Live Arena. A read-only consumer of business data:
 *  - shown only when the SERVER says allowOnLiveArena === true (three states: unknown until this page has a
 *    server answer, then on / off; a cached browser value or a failed request never shows it);
 *  - active hours never hide it: outside them it sleeps on screen;
 *  - mood: latest validated sale + server clock from GET /api/arena/cub (same on every display);
 *  - feeding: the existing SSE `sale.validated` event (via LiveApiSync, no extra connection), live sources only;
 *  - bonus: the real award shown by the existing bonus popup queue, celebrated once that popup closes;
 *  - admin actions: the trusted `arena.cub.action` event (deduped by id, ignored once expired).
 */

const ACTIVITY_MS = 5 * 60_000;
const TICK_MS = 15_000;
const INTRO_KEY = "sales-arena:cub-intro-at";
const REMINDERS_KEY = "sales-arena:cub-reminders";
const SALES_KEY = "sales-arena:cub-fed";
const COMMANDS_KEY = "sales-arena:cub-commands";

function readNum(key: string): number | null {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function ArenaCub() {
  const cfg = useSettingsStore((s) => s.arenaCub);
  const arenaEnabled = useSettingsStore((s) => s.arenaEnabled);
  const tz = useSettingsStore((s) => s.businessTimezone);
  const quality = useSettingsStore((s) => s.quality);
  const autoQuality = useSettingsStore((s) => s.autoQuality);
  const globalParticles = useSettingsStore((s) => s.particles);
  const logo = useSettingsStore((s) => s.customLogo) || "/brand/logo-mark.webp";
  const mode = useArenaMode();
  const spinStage = useSpinFlowStore((s) => s.stage);
  const popupBusy = useBonusFlowStore((s) => Boolean(s.active) || s.queue.length > 0);
  const reducedSystem = useReducedMotion();
  // Server-authoritative permission (unknown → hidden until the server answers; never from browser storage).
  const permission = useLiveStore((s) => s.cubPermission);

  const visible = permission === "on" && cubVisibleOn({ ...cfg, allowOnLiveArena: true }, mode, arenaEnabled) && spinStage === "idle";
  const [view, setView] = useState<CubView | null>(null);
  const [hidden, setHidden] = useState(false);
  const directorRef = useRef<CubDirector | null>(null);
  const playerRef = useRef<CubPlayerHandle | null>(null);
  const activity = useRef<{ lastSaleAt: number | null; offset: number; ok: boolean; at: number }>({ lastSaleAt: null, offset: 0, ok: false, at: 0 });
  const tickRef = useRef<() => void>(() => {});
  const cfgRef = useRef(cfg);
  const tzRef = useRef(tz);
  const modeRef = useRef(mode);
  const visibleRef = useRef(visible);
  useLayoutEffect(() => {
    cfgRef.current = cfg;
    tzRef.current = tz;
    modeRef.current = mode;
    visibleRef.current = visible;
  });

  const serverNow = () => Date.now() + activity.current.offset;

  // Director: created once, disposed on unmount (clears every timer).
  useEffect(() => {
    const d = new CubDirector(cfgRef.current, {
      now: () => Date.now(),
      render: (v) => setView(v),
      moveSec: (action, id) => playerRef.current?.moveSec(action, id) ?? 6,
      sound: (kind) => {
        const c = cfgRef.current;
        const s = useSettingsStore.getState();
        if (!c.sounds || !s.soundEnabled || !visibleRef.current) return;
        if (!activeWindow(new Date(serverNow()), c, tzRef.current).active) return; // quiet hours: silent
        playCubSound(kind, c.volume * s.volume);
      },
    });
    directorRef.current = d;
    setView(d.view());
    return () => {
      d.dispose();
      directorRef.current = null;
      stopCubSound();
    };
  }, []);

  useEffect(() => directorRef.current?.setConfig(cfg), [cfg]);
  useEffect(() => {
    directorRef.current?.setVisible(visible);
    if (!visible) stopCubSound(); // hidden: no animation, reminders or sound
  }, [visible]);
  useEffect(() => directorRef.current?.setBlocked(popupBusy), [popupBusy]);

  // Authoritative activity + mood ticker.
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const reminders = new RecentIds(60, REMINDERS_KEY);

    const tick = () => {
      const d = directorRef.current;
      if (!d) return;
      const a = activity.current;
      const fresh = a.ok && Date.now() - a.at < 3 * ACTIVITY_MS;
      const amb = ambient({ now: new Date(serverNow()), lastSaleAt: a.lastSaleAt ? new Date(a.lastSaleAt) : null, dataOk: fresh, cfg: cfgRef.current, tz: tzRef.current });
      d.setMood(amb.mood);
      if (amb.reminder && !reminders.has(amb.reminder.key) && d.canRemind()) {
        reminders.add(amb.reminder.key);
        d.push({ kind: "reminder", mood: amb.reminder.mood, key: amb.reminder.key });
      }
    };
    tickRef.current = tick;

    const load = async () => {
      try {
        const t0 = Date.now();
        const res = await fetch("/api/arena/cub", { cache: "no-store" });
        const j = await res.json();
        if (!alive) return;
        if (!res.ok || !j.ok) throw new Error("unavailable");
        const t1 = Date.now();
        const server = new Date(j.serverNow).getTime();
        const prev = activity.current.lastSaleAt;
        const fromServer = j.lastSaleAt ? new Date(j.lastSaleAt).getTime() : null;
        activity.current = {
          lastSaleAt: fromServer !== null && prev !== null ? Math.max(fromServer, prev) : (fromServer ?? prev),
          offset: Number.isFinite(server) ? server - (t0 + t1) / 2 : 0,
          ok: true,
          at: t1,
        };
      } catch {
        if (alive) activity.current = { ...activity.current, ok: false };
      }
      tick();
    };

    void load();
    let timer = setInterval(() => (document.visibilityState === "visible" ? void load() : undefined), ACTIVITY_MS);
    let ticker = setInterval(tick, TICK_MS);
    const onVis = () => {
      clearInterval(timer);
      clearInterval(ticker);
      if (document.visibilityState === "visible") {
        void load();
        timer = setInterval(() => void load(), ACTIVITY_MS);
        ticker = setInterval(tick, TICK_MS);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    const offResync = arenaBus.on("cub:resync", (_p, meta) => {
      if (!meta.remote) void load();
    });
    return () => {
      alive = false;
      clearInterval(timer);
      clearInterval(ticker);
      document.removeEventListener("visibilitychange", onVis);
      offResync();
    };
  }, [visible]);

  // Re-evaluate the mood immediately when the timing settings change.
  useEffect(() => tickRef.current(), [cfg, tz]);

  // Genuine validated sales from the server stream.
  useEffect(() => {
    const fed = new RecentIds(300, SALES_KEY);
    return arenaBus.on("cub:sale", (p, meta) => {
      if (meta.remote || !p.caseId) return;
      const t = new Date(p.validatedAt).getTime();
      if (Number.isFinite(t)) {
        const cur = activity.current.lastSaleAt;
        if (cur === null || t > cur) activity.current.lastSaleAt = Math.min(t, serverNow());
      }
      tickRef.current();
      if (!isFreshSale(p, serverNow()) || !fed.add(p.caseId)) return; // history, imports and repeats never feed
      directorRef.current?.push({ kind: "feeding", sales: [{ caseId: p.caseId, agentName: p.closerName, validatedAt: p.validatedAt }] });
    });
  }, []);

  // Trusted admin actions (validated, audited and broadcast by the server).
  useEffect(() => {
    const seen = new RecentIds(200, COMMANDS_KEY);
    return arenaBus.on("cub:command", (c, meta) => {
      if (meta.remote || !visibleRef.current) return;
      if (!c || typeof c.id !== "string" || !isCubCommand(c.action)) return;
      const expires = new Date(c.expiresAt).getTime();
      if (!Number.isFinite(expires) || expires < serverNow()) return; // late or replayed: ignored
      if (c.target?.scope === "screen" && c.target.screen !== modeRef.current) return; // another screen's command
      if (!seen.add(c.id)) return; // same command delivered twice
      const d = directorRef.current;
      if (!d) return;
      if (isCubAction(c.action)) d.push({ kind: "command", id: c.id, action: c.action, expiresAt: expires - activity.current.offset });
      else d.utility(c.action);
    });
  }, []);

  // Genuine new awards: celebrated after the real bonus popup has been shown (same dedupe, same admin switches).
  useEffect(() => {
    const seen = new RecentIds(300);
    return useBonusFlowStore.subscribe((s, prev) => {
      const closed = prev.active && prev.active !== s.active ? prev.active : null;
      if (!closed || closed.preview) return;
      const awards: CubAward[] = closed.awards
        .filter((a) => seen.add(a.id))
        .map((a) => ({
          id: a.id,
          agentName: a.agentName,
          kind: a.kind,
          rewardType: a.rewardType,
          amount: Number(a.amount) || 0,
          currency: a.currency || useSettingsStore.getState().currencyLabel,
          prizeLabel: a.prizeLabel,
          upgrade: a.upgrade,
          previousAmount: a.previousAmount,
          incrementAmount: a.incrementAmount,
        }));
      if (awards.length) directorRef.current?.push({ kind: "bonus", awards });
    });
  }, []);

  // Introduction (per display, by the configured frequency). Never forced on when the permission turns on.
  useEffect(() => {
    if (!visible) return;
    const c = cfgRef.current;
    if (!c.intro) return;
    const now = new Date(serverNow());
    if (!activeWindow(now, c, tzRef.current).active && c.introFrequency !== "every_load") return; // no wake-up show at night
    if (!shouldPlayIntro(c.introFrequency, readNum(INTRO_KEY), now, tzRef.current)) return;
    if (directorRef.current?.push({ kind: "intro" })) {
      try {
        localStorage.setItem(INTRO_KEY, String(now.getTime()));
      } catch {
        /* ignore */
      }
    }
  }, [visible]);

  // Hidden tab: animations pause.
  useEffect(() => {
    const on = () => setHidden(document.visibilityState !== "visible");
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  if (!visible || !view) return null;

  const lite = cfg.performance === "lite" || (cfg.performance === "auto" && (quality === "performance" || (quality === "auto" && (autoQuality === "performance" || autoQuality === "low"))));
  const motion: CubMotion = cfg.reducedMotion === "always" || reducedSystem ? "reduced" : lite ? "lite" : "full";

  return (
    <CubPlayer
      view={view}
      cfg={cfg}
      frame="viewport"
      motion={motion}
      paused={hidden}
      particles={cfg.particles && globalParticles && motion === "full"}
      logo={logo}
      handleRef={playerRef}
      onMoveAborted={() => directorRef.current?.utility("home")}
    />
  );
}

export type { CubCommand };
