"use client";

import { useArenaStore } from "@/store/arena-store";
import { useSettingsStore } from "@/store/settings-store";
import { Section, Toggle, Range, Choice, SelectField } from "@/components/admin/ui";
import { LiveLeaderboard } from "@/components/arena/LiveLeaderboard";
import type { LeaderboardPeriod } from "@/types";

export default function LeaderboardSettingsPage() {
  const s = useSettingsStore();
  const update = s.update;
  const teams = useArenaStore((st) => st.teams);
  const campaigns = useArenaStore((st) => st.campaigns);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_520px]">
      <div className="space-y-6">
        <Section title="Leaderboard on the Live Arena" description="The leaderboard sits on the right of the Live Arena display.">
          <Toggle label="Show leaderboard" checked={s.leaderboardVisible} onChange={(v) => update({ leaderboardVisible: v })} />
          <Range label="Closers shown" value={s.leaderboardCount} min={3} max={15} onChange={(v) => update({ leaderboardCount: v })} />
          <Choice
            label="Size"
            value={s.leaderboardSize}
            options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]}
            onChange={(v) => update({ leaderboardSize: v })}
          />
        </Section>

        <Section
          title="Ranking"
          description="Today's closers, ranked by validated sales first, then submitted leads. Policy closed rate = validated ÷ submitted × 100."
        >
          <SelectField
            label="Team filter"
            value={s.leaderboardTeamId ?? "all"}
            options={[{ value: "all", label: "All teams" }, ...teams.map((t) => ({ value: t.id, label: t.name }))]}
            onChange={(v) => update({ leaderboardTeamId: v === "all" ? null : v })}
          />
          <SelectField
            label="Campaign filter"
            value={s.leaderboardCampaignId ?? "all"}
            options={[{ value: "all", label: "All campaigns" }, ...campaigns.map((c) => ({ value: c.id, label: c.name }))]}
            onChange={(v) => update({ leaderboardCampaignId: v === "all" ? null : v })}
          />
        </Section>

        <Section title="Style">
          <Choice
            label="Top 3 highlight"
            value={s.topPerformerStyle === "minimal" ? "minimal" : "podium"}
            options={[{ value: "podium", label: "Gold, silver & bronze" }, { value: "minimal", label: "Minimal" }]}
            onChange={(v) => update({ topPerformerStyle: v })}
          />
          <Toggle label="Animate ranking changes" checked={s.leaderboardAnimations} onChange={(v) => update({ leaderboardAnimations: v })} />
        </Section>
      </div>

      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-text-muted">Live preview</p>
        <div className="h-[720px]">
          <LiveLeaderboard />
        </div>
      </div>
    </div>
  );
}
