"use client";

import { useEffect, useState } from "react";
import { Volume2, VolumeX, Maximize, Minimize, Tv, Radio } from "lucide-react";
import { useSettingsStore } from "@/store/settings-store";
import { audioEngine } from "@/lib/audio/engine";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { cn } from "@/lib/utils";
import { DemoSpinButton } from "@/components/arena/DemoSpinButton";

/** Public Live Arena header: branding plus display utilities only — no admin links. */
export function ArenaHeader() {
  const soundEnabled = useSettingsStore((s) => s.soundEnabled);
  const tvMode = useSettingsStore((s) => s.tvMode);
  const online = useSettingsStore((s) => s.arenaEnabled);
  const update = useSettingsStore((s) => s.update);
  const [time, setTime] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    const tick = () => setTime(fmt.format(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      clearInterval(id);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, []);

  const toggleSound = () => {
    const next = !soundEnabled;
    update({ soundEnabled: next });
    if (next) {
      audioEngine.unlock();
      audioEngine.play("ui");
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  };

  const util =
    "grid place-items-center h-10 w-10 rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary";

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/[0.06] bg-[#070B16]/70 backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between gap-4 px-4 lg:px-8">
        <BrandLogo size={42} />

        <div className="hidden sm:flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 shadow-[0_0_24px_-6px_rgba(117,104,255,0.6)]">
          <Radio className="h-4 w-4 text-secondary" />
          <span className="font-heading text-sm font-bold tracking-[0.2em] text-white">LIVE ARENA</span>
          {online ? (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
            </span>
          ) : (
            <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-text-muted">OFF AIR</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden lg:flex items-center gap-2 rounded-xl border border-white/[0.06] bg-surface/60 px-3 py-2 text-sm font-semibold text-text-secondary tabular">
            <span className="h-1.5 w-1.5 rounded-full bg-secondary animate-pulse" />
            <span suppressHydrationWarning>{time || "--:--:--"}</span>
          </div>
          <DemoSpinButton />
          <button
            onClick={toggleSound}
            aria-pressed={soundEnabled}
            title={soundEnabled ? "Mute sound" : "Unmute sound"}
            className={cn(util, soundEnabled ? "border-primary/30 bg-surface text-secondary" : "border-white/5 bg-surface/50 text-text-muted hover:text-white")}
          >
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
          <button
            onClick={() => update({ tvMode: !tvMode })}
            aria-pressed={tvMode}
            title={tvMode ? "Exit TV mode" : "TV display mode (larger text)"}
            className={cn(util, "hidden sm:grid", tvMode ? "border-gold/40 bg-gold/15 text-gold" : "border-white/5 bg-surface/50 text-text-muted hover:text-white")}
          >
            <Tv className="h-4 w-4" />
          </button>
          <button onClick={toggleFullscreen} title="Toggle fullscreen" className={cn(util, "border-white/5 bg-surface/50 text-text-muted hover:text-white")}>
            {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </header>
  );
}
