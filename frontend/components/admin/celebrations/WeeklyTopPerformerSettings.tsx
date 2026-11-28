"use client";

import { useCallback, useEffect, useState } from "react";
import { Crown, Eye, RefreshCw, Sparkles, Square, Volume2, VolumeX } from "lucide-react";
import { adminApi } from "@/frontend/components/admin/admin-api";
import { useAdminSync } from "@/frontend/components/admin/AdminLiveSync";
import { Section, PrimaryButton, GhostButton } from "@/frontend/components/admin/ui";
import { Notice } from "@/frontend/components/admin/spins/shared";
import { AgentEmoji } from "@/frontend/components/celebrations/AgentEmoji";
import { WeeklyTopCelebration, useWeeklyTopMotion } from "@/frontend/components/celebrations/WeeklyTopCelebration";
import { audioEngine } from "@/frontend/audio/engine";
import { playCelebrationSound } from "@/frontend/audio/celebration-sounds";
import type { CelebrationEvent } from "@/shared/types";

interface State {
  week: { from: string; to: string; label: string };
  top: {
    userCode: string;
    name: string;
    validated: number;
    submitted: number;
    teamName?: string | null;
    teamColor?: string | null;
  } | null;
  tiedWith: string | null;
  celebrated: { name: string; validated: number; at: string; by: string | null } | null;
}

/**
 * Admin → Celebrations → Weekly Top Performer Celebration. Shows this business week's #1 (the Weekly leaderboard's
 * first row, read on the server) with their emoji preview, lets Admins preview locally in 16:9, or broadcast
 * the "CONGRATULATIONS!" ceremony to every Live Arena display once per week.
 */
export function WeeklyTopPerformerSettings() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [previewEvent, setPreviewEvent] = useState<CelebrationEvent | null>(null);
  const [previewSound, setPreviewSound] = useState(false);
  const salesRev = useAdminSync((s) => s.salesRev);
  const teamsRev = useAdminSync((s) => s.teamsRev);
  const motion = useWeeklyTopMotion();

  const load = useCallback(async () => {
    const r = await adminApi<State>(`/api/admin/celebrations/weekly-top-performer?t=${Date.now()}`);
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
    if (!state?.top) return;
    if (!confirm(`Celebrate ${state.top.name} (${state.top.validated} approved sales) as this week's top performer on every Live Arena screen?\n\nThis can be done once per week.`)) return;
    setBusy(true);
    setMsg(null);
    const r = await adminApi<{ top: { name: string } }>("/api/admin/celebrations/weekly-top-performer", { method: "POST" });
    setBusy(false);
    if (r.ok) setMsg({ kind: "ok", text: `Celebration sent: ${r.data.top.name} is on every Live Arena screen now (after any popup already showing).` });
    else setMsg({ kind: "error", text: r.error });
    void load();
  };

  const startPreview = () => {
    const top = state?.top;
    const evt: CelebrationEvent = {
      id: `preview_weekly_top_${Date.now()}`,
      tier: "weekly-top",
      headline: "CONGRATULATIONS!",
      subline: state?.week.label ?? "Current Business Week",
      agentId: top?.userCode ?? null,
      agentName: top?.name ?? "Mansoor Arshad",
      teamName: top?.teamName ?? "Team Sigma",
      teamColor: top?.teamColor ?? "#F5C451",
      value: top?.validated ?? 14,
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
  return (
    <Section
      title="Weekly Top Performer Celebration"
      description="A full-screen spotlight ceremony for this week's #1 agent (the first place on the Weekly leaderboard), featuring their uploaded emoji, trumpet celebration sound, and golden confetti on every Live Arena screen. Once per week. Recognition only."
      actions={
        <GhostButton onClick={() => void load()} className="px-3 py-1.5 text-xs" data-testid="weekly-top-refresh">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </GhostButton>
      }
    >
      {error && <Notice kind="error">{error}</Notice>}
      {!state && !error && <p className="text-sm text-text-muted">Loading this week&apos;s ranking…</p>}
      {state && (
        <div className="space-y-4" data-testid="weekly-top-admin">
          <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-[#FFC857]/30 bg-gradient-to-r from-[#FFC857]/[0.08] to-transparent p-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-[#FFC857]/50 bg-[#FFC857]/10 p-1">
              {state.top ? (
                <AgentEmoji
                  agentId={state.top.userCode}
                  name={state.top.name}
                  className="h-full w-full object-contain"
                  fallback={<Crown className="h-7 w-7 text-[#FFC857]" />}
                />
              ) : (
                <Crown className="h-7 w-7 text-[#FFC857]" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-text-muted" data-testid="weekly-top-admin-week">
                {state.week.label}
              </p>
              {state.top ? (
                <>
                  <p className="truncate font-heading text-2xl font-extrabold text-white" data-testid="weekly-top-admin-name">
                    {state.top.name}
                  </p>
                  <p className="text-sm text-text-secondary">
                    <span className="font-semibold text-[#FFC857]" data-testid="weekly-top-admin-sales">
                      {state.top.validated}
                    </span>{" "}
                    approved sale{state.top.validated === 1 ? "" : "s"} · {state.top.submitted} submitted
                    {state.top.teamName ? ` · ${state.top.teamName}` : ""}
                  </p>
                </>
              ) : (
                <p className="text-sm text-text-secondary" data-testid="weekly-top-admin-none">
                  No approved sales this week yet.
                </p>
              )}
            </div>
          </div>
          {state.tiedWith && !done && (
            <Notice kind="info">Tied on approved sales with {state.tiedWith}: the Weekly leaderboard&apos;s own order puts {state.top?.name} first.</Notice>
          )}
          {done && state.celebrated && (
            <Notice kind="info">
              Already celebrated this week: {state.celebrated.name} ({state.celebrated.validated} approved sales), {new Date(state.celebrated.at).toLocaleString("en-US")}
              {state.celebrated.by ? ` by ${state.celebrated.by}` : ""}. The next celebration is possible next week.
            </Notice>
          )}
          {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
          <div className="flex flex-wrap items-center gap-3">
            <PrimaryButton onClick={() => void celebrate()} disabled={busy || done || !state.top} data-testid="weekly-top-celebrate">
              <Sparkles className="h-4 w-4" /> {busy ? "Sending…" : done ? "Celebrated this week" : "Celebrate Weekly Top Performer"}
            </PrimaryButton>
            <GhostButton type="button" onClick={startPreview} data-testid="weekly-top-preview-btn">
              <Eye className="h-4 w-4" /> Preview Weekly Top Performer
            </GhostButton>
            {previewEvent && (
              <GhostButton type="button" onClick={() => setPreviewEvent(null)} data-testid="weekly-top-preview-stop">
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
              data-testid="weekly-top-preview-stage"
              style={{ transform: "translateZ(0)" }}
              className="relative aspect-video w-full overflow-hidden rounded-2xl border border-[#FFC857]/40 bg-[#050814] shadow-2xl [container-type:size]"
            >
              <WeeklyTopCelebration event={previewEvent} motion={motion} />
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
