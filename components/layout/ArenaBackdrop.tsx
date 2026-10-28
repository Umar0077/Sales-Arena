"use client";

import { useSettingsStore } from "@/store/settings-store";

/**
 * Fixed, decorative stadium backdrop: deep violet/navy base, slow-drifting colour glows,
 * a twinkling star field, a perspective grid floor and a vignette. Pure CSS (globals.css).
 * `variant="console"` is the calmer version used by the Admin Panel.
 */
export function ArenaBackdrop({ variant = "arena" }: { variant?: "arena" | "console" }) {
  const effects = useSettingsStore((s) => s.backgroundEffects);
  const level = variant === "console" ? "subtle" : effects;

  return (
    <div aria-hidden className="arena-backdrop" data-effects={level} data-variant={variant}>
      {level !== "off" && (
        <>
          <div className="arena-backdrop__aurora arena-backdrop__aurora--violet" />
          <div className="arena-backdrop__aurora arena-backdrop__aurora--cyan" />
          <div className="arena-backdrop__aurora arena-backdrop__aurora--gold" />
          <div className="arena-backdrop__stars" />
          {level === "full" && <div className="arena-backdrop__stars arena-backdrop__stars--far" />}
          {variant === "arena" && <div className="arena-backdrop__floor" />}
        </>
      )}
      <div className="arena-backdrop__vignette" />
    </div>
  );
}
