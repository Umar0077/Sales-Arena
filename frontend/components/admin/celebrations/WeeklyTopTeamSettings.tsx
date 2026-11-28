"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, RefreshCw, Scale, Sparkles, Square, Trophy, Volume2, VolumeX } from "lucide-react";
import { adminApi } from "@/frontend/components/admin/admin-api";
import { useAdminSync } from "@/frontend/components/admin/AdminLiveSync";
import { Section, PrimaryButton, GhostButton } from "@/frontend/components/admin/ui";
import { Notice } from "@/frontend/components/admin/spins/shared";
import { AgentEmoji } from "@/frontend/components/celebrations/AgentEmoji";
import { useWeeklyTopMotion } from "@/frontend/components/celebrations/WeeklyTopCelebration";
import { WeeklyTopTeamCelebration } from "@/frontend/components/celebrations/WeeklyTopTeamCelebration";
import { audioEngine } from "@/frontend/audio/engine";
import { playCelebrationSound } from "@/frontend/audio/celebration-sounds";
import { formatSalesCount } from "@/shared/sales/weighting";
import type { CelebrationEvent } from "@/shared/types";

interface TeamMember {
  userCode: string;
  name: string;
  designation: string | null;
  validated: number;
  creditedValidated?: number;
  submitted: number;
}

interface TeamInfo {
  id: string;
  slug: string | null;
  name: string;
  logoUrl: string | null;
  color: string;
  accentSecondary: string | null;
  validated: number;
  creditedValidated?: number;
  submitted: number;
  closeRate: number | null;
  memberCount?: number;
  members: TeamMember[];
}

interface TeamSummary {
  id: string;
  slug: string | null;
  name: string;
  logoUrl: string | null;
  color: string;
  validated: number;
  creditedValidated: number;
  submitted: number;
  closeRate: number | null;
  memberCount: number;
  rank: number;
  tied: boolean;
}

interface TopTeamState {
  week: { from: string; to: string; label: string };
  topTeam: TeamInfo | null;
  isTie?: boolean;
  tiedTeams?: TeamInfo[];
  teams?: TeamSummary[];
  tiedWith: string | null;
  celebrated: {
    teamId: string;
    teamName: string;
    validated: number;
    at: string;
    by: string | null;
  } | null;
}

/**
 * Admin → Celebrations → Weekly Top Team Performers Celebration.
 * Reuses existing weekly team standings to preview and celebrate the #1 weekly team
 * (team logo + all winning team members' emojis) across all Live Arena screens.
 */
export function WeeklyTopTeamSettings() {
  const [state, setState] = useState<TopTeamState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [previewEvent, setPreviewEvent] = useState<CelebrationEvent | null>(null);
  const [previewSound, setPreviewSound] = useState(false);
  const salesRev = useAdminSync((s) => s.salesRev);
  const teamsRev = useAdminSync((s) => s.teamsRev);
  const motion = useWeeklyTopMotion();

  const load = useCallback(async () => {
    const r = await adminApi<TopTeamState>(`/api/admin/celebrations/weekly-top-team?t=${Date.now()}`);
    if (r.ok) {
      setState(r.data);
      setError(null);
    } else setError(r.error);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, salesRev, teamsRev]);

  useEffect(() => {
    if (!previewEvent) return;
    const t = setTimeout(() => setPreviewEvent(null), 9500);
    return () => clearTimeout(t);
  }, [previewEvent]);

  const celebrate = async () => {
    if (!state?.topTeam) return;
    if (
      !confirm(
        `Celebrate ${state.topTeam.name} (${state.topTeam.validated} approved sales, ${state.topTeam.members.length} members) as this week's top team on every Live Arena screen?\n\nThis can be done once per week.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setMsg(null);
    const r = await adminApi<{ topTeam: { name: string } }>("/api/admin/celebrations/weekly-top-team", {
      method: "POST",
    });
    setBusy(false);
    if (r.ok) {
      setMsg({
        kind: "ok",
        text: `Team celebration sent: ${r.data.topTeam.name} is celebrating on every Live Arena screen now.`,
      });
    } else {
      setMsg({ kind: "error", text: r.error });
    }
    void load();
  };

  const startPreview = () => {
    const tm = state?.topTeam ?? state?.tiedTeams?.[0] ?? null;
    const evt: CelebrationEvent = {
      id: `preview_weekly_top_team_${Date.now()}`,
      tier: "weekly-top-team",
      headline: `${(tm?.name ?? "Team Sigma").toUpperCase()} — THIS WEEK'S TOP PERFORMERS`,
      subline: state?.week.label ?? "Current Business Week",
      agentId: null,
      agentName: null,
      teamName: tm?.name ?? "Team Sigma",
      teamColor: tm?.color ?? "#F5C451",
      teamLogoUrl: tm?.logoUrl ?? "/teams/team-sigma.webp",
      teamMembers: tm?.members ?? [
        { userCode: "CLS-FDBC4C55", name: "Mansoor Arshad", validated: 14 },
        { userCode: "CLS-536D6AA1", name: "Hamna Nasir", validated: 11 },
        { userCode: "CLS-FF485B25", name: "Rohan Ali", validated: 9 },
        { userCode: "CLS-7A26EF64", name: "Arsam Idrees", validated: 8 },
      ],
      value: tm?.validated ?? 42,
      createdAt: new Date().toISOString(),
      preview: true,
    };
    setPreviewEvent(evt);
    if (previewSound) {
      audioEngine.unlock();
      playCelebrationSound("bonus", { allowed: true });
    }
  };

  const done = !!state?.celebrated;
  const isTie = Boolean(state?.isTie && (state?.tiedTeams?.length ?? 0) > 1);

  return (
    <Section
      title="Weekly Top Team Performers Celebration"
      description="A full-screen squad recognition ceremony for this week's #1 team, displaying the winning team's logo and every team member's emoji on all Live Arena screens. Once per week. Recognition only."
      actions={
        <GhostButton onClick={() => void load()} className="px-3 py-1.5 text-xs" data-testid="weekly-top-team-refresh">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </GhostButton>
      }
    >
      {error && <Notice kind="error">{error}</Notice>}
      {!state && !error && <p className="text-sm text-text-muted">Loading this week&apos;s team ranking…</p>}
      {state && (
        <div className="space-y-4" data-testid="weekly-top-team-admin">
          <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-[#FFC857]/30 bg-gradient-to-r from-[#FFC857]/[0.08] to-transparent p-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-[#FFC857]/50 bg-black/30 p-1.5">
              {isTie ? (
                <Scale className="h-7 w-7 text-[#FFC857]" />
              ) : state.topTeam?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- official team logo
                <img
                  src={state.topTeam.logoUrl}
                  alt={state.topTeam.name}
                  className="h-full w-full object-contain"
                />
              ) : (
                <Trophy className="h-7 w-7 text-[#FFC857]" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-text-muted">
                {state.week.label}
              </p>
              {isTie && state.tiedTeams ? (
                <>
                  <p
                    className="truncate font-heading text-2xl font-extrabold text-white"
                    data-testid="weekly-top-team-admin-tie"
                  >
                    Tied for #1: {state.tiedTeams.map((t) => t.name).join(" & ")}
                  </p>
                  <p className="text-sm text-text-secondary">
                    <span className="font-semibold text-[#FFC857]" data-testid="weekly-top-team-admin-sales">
                      {state.tiedTeams[0].validated}
                    </span>{" "}
                    approved sale{state.tiedTeams[0].validated === 1 ? "" : "s"} each · level on raw validated sales
                  </p>
                </>
              ) : state.topTeam ? (
                <>
                  <p
                    className="truncate font-heading text-2xl font-extrabold text-white"
                    data-testid="weekly-top-team-admin-name"
                  >
                    {state.topTeam.name}
                  </p>
                  <p className="text-sm text-text-secondary">
                    <span className="font-semibold text-[#FFC857]" data-testid="weekly-top-team-admin-sales">
                      {state.topTeam.validated}
                    </span>{" "}
                    approved sale{state.topTeam.validated === 1 ? "" : "s"}
                    {state.topTeam.creditedValidated !== undefined && state.topTeam.creditedValidated !== state.topTeam.validated
                      ? ` (${formatSalesCount(state.topTeam.creditedValidated)} weighted credits)`
                      : ""}{" "}
                    · {state.topTeam.members.length} team member{state.topTeam.members.length === 1 ? "" : "s"}
                  </p>
                </>
              ) : (
                <p className="text-sm text-text-secondary" data-testid="weekly-top-team-admin-none">
                  No competing team has approved sales this week yet.
                </p>
              )}
            </div>
          </div>

          {state.teams && state.teams.length > 0 && (
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3" data-testid="weekly-top-team-standings">
              {state.teams.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs"
                  data-testid="weekly-top-team-summary"
                  data-team={t.slug ?? t.id}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {t.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- official team logo
                      <img src={t.logoUrl} alt="" className="h-6 w-6 shrink-0 object-contain" />
                    ) : (
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} />
                    )}
                    <span className="truncate font-semibold text-white">{t.name}</span>
                    {t.tied && t.rank === 1 && t.validated > 0 && (
                      <span className="rounded bg-[#FFC857]/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#FFC857]">
                        Tied
                      </span>
                    )}
                  </div>
                  <div className="shrink-0 text-right font-mono">
                    <span className="font-bold text-[#FFC857]">{t.validated}</span>
                    <span className="text-text-muted"> sales</span>
                    {t.creditedValidated !== t.validated && (
                      <span className="ml-1.5 text-[10px] text-text-muted">
                        ({formatSalesCount(t.creditedValidated)} cr.)
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {state.topTeam && state.topTeam.members.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {state.topTeam.members.map((m) => (
                <div
                  key={m.userCode}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs text-white"
                >
                  <div className="h-6 w-6 shrink-0 overflow-hidden rounded-md bg-black/30">
                    <AgentEmoji
                      agentId={m.userCode}
                      name={m.name}
                      className="h-full w-full object-contain"
                      fallback={<span className="grid h-full w-full place-items-center text-[10px] font-bold text-text-muted">{m.name[0]}</span>}
                    />
                  </div>
                  <span className="font-medium">{m.name}</span>
                  <span className="font-mono text-[11px] text-[#FFC857]">{m.validated}</span>
                </div>
              ))}
            </div>
          )}

          {isTie && !done && (
            <Notice kind="info">
              Competing teams are tied on raw validated sales ({state.tiedTeams?.map((t) => `${t.name}: ${t.validated}`).join(", ")}). A sole winning team celebration unlocks as soon as the tie is broken.
            </Notice>
          )}
          {!isTie && state.tiedWith && !done && (
            <Notice kind="info">
              Tied on approved sales with {state.tiedWith}: weekly team standings order puts {state.topTeam?.name} first.
            </Notice>
          )}
          {done && state.celebrated && (
            <Notice kind="info">
              Already celebrated this week: {state.celebrated.teamName} ({state.celebrated.validated} approved sales),{" "}
              {new Date(state.celebrated.at).toLocaleString("en-US")}
              {state.celebrated.by ? ` by ${state.celebrated.by}` : ""}.
            </Notice>
          )}
          {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

          <div className="flex flex-wrap items-center gap-3">
            <PrimaryButton
              onClick={() => void celebrate()}
              disabled={busy || done || isTie || !state.topTeam}
              data-testid="weekly-top-team-celebrate"
            >
              <Sparkles className="h-4 w-4" />{" "}
              {busy ? "Sending…" : done ? "Team celebrated this week" : isTie ? "Tied — No Sole Winner Yet" : "Celebrate Weekly Top Team"}
            </PrimaryButton>
            <GhostButton type="button" onClick={startPreview} data-testid="weekly-top-team-preview-btn">
              <Eye className="h-4 w-4" /> Preview Weekly Top Team
            </GhostButton>
            {previewEvent && (
              <GhostButton type="button" onClick={() => setPreviewEvent(null)} data-testid="weekly-top-team-preview-stop">
                <Square className="h-3.5 w-3.5" /> Stop Preview
              </GhostButton>
            )}
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-text-secondary select-none">
              <input
                type="checkbox"
                checked={previewSound}
                onChange={(e) => setPreviewSound(e.target.checked)}
                className="rounded border-white/20 accent-[#7568FF]"
              />
              {previewSound ? <Volume2 className="h-3.5 w-3.5 text-secondary" /> : <VolumeX className="h-3.5 w-3.5 text-text-muted" />}
              Preview with sound
            </label>
          </div>

          {previewEvent && (
            <div
              data-preview-stage="true"
              data-testid="weekly-top-team-preview-stage"
              style={{ transform: "translateZ(0)" }}
              className="relative aspect-video w-full overflow-hidden rounded-2xl border border-[#FFC857]/40 bg-[#050814] shadow-2xl [container-type:size]"
            >
              <WeeklyTopTeamCelebration event={previewEvent} motion={motion} />
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
