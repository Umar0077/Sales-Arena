"use client";

import { useEffect, useState } from "react";
import { saveSettings } from "@/frontend/admin/global-settings";
import { useSettingsStore } from "@/frontend/stores/settings-store";
import { Section, Toggle, Choice, GhostButton } from "@/frontend/components/admin/ui";
import { CelebrationPortal, TeamSaleCelebrationView, previewItem, playPreviewSound, useMotionLevel } from "@/frontend/components/arena/teams/TeamSaleCelebration";
import { celebrationMs } from "@/shared/teams/celebration";
import type { TeamCelebrationItem } from "@/frontend/stores/team-celebration-store";

/**
 * Admin → Celebrations → Teams Arena sale celebrations. Settings save through the existing global settings
 * (PostgreSQL arena.config → every display). Previews run ONLY in this Admin tab: no request, no stream event,
 * no sale, no award, no total change, nothing sent to the office displays.
 */
export function TeamCelebrationSettings() {
  const s = useSettingsStore();
  const [preview, setPreview] = useState<TeamCelebrationItem | null>(null);
  const motionLevel = useMotionLevel();

  useEffect(() => {
    if (!preview) return;
    const t = setTimeout(() => setPreview(null), celebrationMs(motionLevel === "lite" ? "lite" : "full", motionLevel === "static"));
    return () => clearTimeout(t);
  }, [preview, motionLevel]);

  const show = (kind: "lion" | "panther" | "crest") => {
    setPreview(previewItem(kind));
    playPreviewSound(kind);
  };

  return (
    <Section
      title="Teams Arena sale celebrations"
      description="Teams Arena only. A validated sale of a competing team plays that team's celebration instead of the sale card (Sigma: lion emblem, Panthers: panther emblem, any other team: its own crest). Daily, Weekly, Monthly and Spin & Win keep their existing popups. Bonuses are unchanged and always shown."
    >
      <Toggle label="Team sale celebrations" hint="Off: Teams Arena shows the standard sale card, like the other screens." checked={s.teamSaleCelebrations} onChange={(v) => saveSettings({ teamSaleCelebrations: v })} />
      <Toggle label="Team celebration sounds" hint="Also follows the master sound switch, the volume and the Sale sound category." checked={s.teamSaleSound} onChange={(v) => saveSettings({ teamSaleSound: v })} />
      <Choice
        label="Mascot animation"
        hint="Lite: a short fade-in without the 3D entrance, parallax or light pass (displays in Performance mode and with reduced motion use the lighter versions automatically)."
        value={s.teamSaleMotion}
        options={[{ value: "full", label: "Full" }, { value: "lite", label: "Lite" }]}
        onChange={(v) => saveSettings({ teamSaleMotion: v })}
      />
      <div className="space-y-2" data-testid="team-celebration-previews">
        <p className="text-sm text-text-secondary">Preview on this screen only (no real sale, no award, nothing sent to the displays):</p>
        <div className="flex flex-wrap gap-2">
          <GhostButton onClick={() => show("lion")} data-testid="preview-sigma">Preview Sigma (lion emblem)</GhostButton>
          <GhostButton onClick={() => show("panther")} data-testid="preview-panthers">Preview Panthers (panther emblem)</GhostButton>
          <GhostButton onClick={() => show("crest")} data-testid="preview-generic">Preview other team (crest)</GhostButton>
        </div>
      </div>
      <CelebrationPortal>
        {preview && (
          <TeamSaleCelebrationView
            key={preview.event.id}
            item={preview}
            name={preview.team.name}
            logoUrl={preview.team.logoUrl}
            color={preview.team.color}
            accent={preview.team.accentSecondary}
            total={null}
            motionLevel={motionLevel}
          />
        )}
      </CelebrationPortal>
    </Section>
  );
}
