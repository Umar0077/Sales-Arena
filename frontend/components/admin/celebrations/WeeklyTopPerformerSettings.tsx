"use client";

import { useCallback, useEffect, useState } from "react";
import { Crown, RefreshCw, Sparkles } from "lucide-react";
import { adminApi } from "@/frontend/components/admin/admin-api";
import { Section, PrimaryButton, GhostButton } from "@/frontend/components/admin/ui";
import { Notice } from "@/frontend/components/admin/spins/shared";

interface State {
  week: { from: string; to: string; label: string };
  top: { userCode: string; name: string; validated: number; submitted: number } | null;
  tiedWith: string | null;
  celebrated: { name: string; validated: number; at: string; by: string | null } | null;
}

/**
 * Admin → Celebrations → Weekly Top Performer Celebration. Shows this business week's #1 (the Weekly leaderboard's
 * first row, read on the server) and lets an Admin play the "CONGRATULATIONS!" ceremony on every Live Arena
 * display, once per week. Recognition only: no bonus, prize, spin credit or sales change.
 */
export function WeeklyTopPerformerSettings() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await adminApi<State>("/api/admin/celebrations/weekly-top-performer");
    if (r.ok) {
      setState(r.data);
      setError(null);
    } else setError(r.error);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

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

  const done = !!state?.celebrated;
  return (
    <Section
      title="Weekly Top Performer Celebration"
      description="A full-screen “CONGRATULATIONS!” ceremony for this week's #1 agent (the first place on the Weekly leaderboard), with the trumpet celebration sound and golden confetti, on every Live Arena screen. Once per week. Recognition only: it creates no bonus, prize or spin and changes no sales."
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
            <div className="grid h-14 w-14 place-items-center rounded-2xl border border-[#FFC857]/50 bg-[#FFC857]/10">
              <Crown className="h-7 w-7 text-[#FFC857]" />
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
          <PrimaryButton onClick={() => void celebrate()} disabled={busy || done || !state.top} data-testid="weekly-top-celebrate">
            <Sparkles className="h-4 w-4" /> {busy ? "Sending…" : done ? "Celebrated this week" : "Celebrate Top Performer"}
          </PrimaryButton>
        </div>
      )}
    </Section>
  );
}
