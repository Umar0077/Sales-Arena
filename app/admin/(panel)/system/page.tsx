"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Database, Wifi, Radio, History } from "lucide-react";
import { adminApi } from "@/components/admin/admin-api";
import { Section, Field, GhostButton, PrimaryButton, inputClass } from "@/components/admin/ui";
import { fmtDate, Notice, Table, td } from "@/components/admin/spins/shared";
import { cn } from "@/lib/utils";

interface Checkpoint {
  id: string;
  endpoint: string;
  last_sync_at: string;
  last_event_id: string | null;
  status: string;
  error: string | null;
  details: Record<string, unknown> | null;
}
interface SystemInfo {
  ok: boolean;
  database: { connected: boolean; name?: string; version?: string; latencyMs?: number; error?: string };
  migrations: { ok: boolean; pending?: string[]; error?: string; versions?: Array<{ version: string; applied: boolean; checksumMatches: boolean | null }> };
  safeQuote: { ok: boolean; latencyMs?: number; error?: string };
  sse: { status: string; lastConnectedAt: string | null; lastEventAt: string | null; lastError: string | null; eventsProcessed: number; salesPersisted: number; lastPersistedAt: string | null; persistFailures: number; lastPersistError: string | null };
  syncEnabled: boolean;
  recentSalesLimit: number;
  counts?: Record<string, number>;
  sales?: { backfill: number; sse: number; reconciliation: number; reward_eligible: number; latest_validated_at: string | null; latest_stored_at: string | null };
  checkpoints?: Checkpoint[];
  audit?: Array<{ id: number; actor: string; action: string; target_type: string; target_id: string | null; ip_address: string | null; created_at: string; admin_email: string | null; details: Record<string, unknown> }>;
}

function Dot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  return <span className={cn("inline-block h-2.5 w-2.5 rounded-full", ok ? (warn ? "bg-gold" : "bg-emerald-400") : "bg-rose-400")} />;
}

export default function SystemHealthPage() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [range, setRange] = useState({ from: "", to: "" });

  const load = useCallback(async () => {
    const r = await adminApi<SystemInfo>("/api/admin/system");
    if (r.ok) {
      setInfo(r.data);
      setError(null);
    } else setError(r.error);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    const id = setInterval(load, 15_000);
    return () => {
      clearTimeout(t);
      clearInterval(id);
    };
  }, [load]);

  const reconcile = async () => {
    setBusy(true);
    const r = await adminApi<{ result: { fetched: number; inserted: number; duplicates: number; errors: string[] } }>("/api/admin/reconcile", { method: "POST" });
    setBusy(false);
    setMsg(r.ok ? { kind: "ok", text: `Checked ${r.data.result.fetched} recent sales: ${r.data.result.inserted} newly stored, ${r.data.result.duplicates} already stored.` } : { kind: "error", text: r.error });
    void load();
  };
  const backfill = async () => {
    setBusy(true);
    setMsg({ kind: "info", text: "Importing… this can take a while for long ranges." });
    const r = await adminApi<{ report: { fetched: number; inserted: number; duplicates: number; upstreamValidated: number | null; possiblyIncompleteDays: string[]; errors: string[] } }>(
      "/api/admin/sync/backfill",
      { method: "POST", body: range },
    );
    setBusy(false);
    if (!r.ok) setMsg({ kind: "error", text: r.error });
    else {
      const x = r.data.report;
      setMsg({
        kind: x.errors.length ? "error" : "ok",
        text: `Received ${x.fetched} sales, stored ${x.inserted} new (${x.duplicates} already stored). Safe Quote reports ${x.upstreamValidated ?? "?"} validated in this range.${
          x.possiblyIncompleteDays.length ? ` Possibly incomplete days (full page of ${info?.recentSalesLimit}): ${x.possiblyIncompleteDays.join(", ")}.` : ""
        } No spins or bonuses were granted.${x.errors.length ? ` Errors: ${x.errors.slice(0, 2).join("; ")}` : ""}`,
      });
    }
    void load();
  };

  if (!info) return error ? <Notice kind="error">{error}</Notice> : <p className="text-sm text-text-muted">Loading…</p>;
  const pending = info.migrations.pending ?? [];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-xl font-bold text-white">System Health</h2>
        <GhostButton onClick={load}><RefreshCw className="h-4 w-4" /> Refresh</GhostButton>
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="health-cards">
        <div className="rounded-2xl border border-white/[0.07] bg-[#0B1122]/80 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white"><Database className="h-4 w-4 text-secondary" /> Database <Dot ok={info.database.connected} /></div>
          <p className="mt-2 text-xs text-text-muted">{info.database.connected ? `${info.database.name} · ${info.database.version} · ${info.database.latencyMs} ms` : info.database.error}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.07] bg-[#0B1122]/80 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white"><History className="h-4 w-4 text-secondary" /> Migrations <Dot ok={info.migrations.ok && pending.length === 0} warn={pending.length > 0} /></div>
          <p className="mt-2 text-xs text-text-muted">{!info.migrations.ok ? info.migrations.error : pending.length ? `Pending: ${pending.join(", ")}` : `All ${info.migrations.versions?.length ?? 0} applied`}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.07] bg-[#0B1122]/80 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white"><Wifi className="h-4 w-4 text-secondary" /> Safe Quote API <Dot ok={info.safeQuote.ok} /></div>
          <p className="mt-2 text-xs text-text-muted">{info.safeQuote.ok ? `Reachable · ${info.safeQuote.latencyMs ?? "?"} ms` : info.safeQuote.error ?? "Unreachable"}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.07] bg-[#0B1122]/80 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white"><Radio className="h-4 w-4 text-secondary" /> Live sync (SSE) <Dot ok={info.sse.status === "connected"} warn={!info.syncEnabled} /></div>
          <p className="mt-2 text-xs text-text-muted">
            {info.syncEnabled ? `${info.sse.status} · ${info.sse.salesPersisted} stored since start · last stored ${fmtDate(info.sse.lastPersistedAt)}` : "Background sync disabled on this server"}
          </p>
          {info.sse.persistFailures > 0 && <p className="mt-1 text-xs text-rose-300">Storage failures: {info.sse.persistFailures} — {info.sse.lastPersistError}</p>}
        </div>
      </div>

      {info.counts && (
        <Section title="Stored records" description="Counts read from PostgreSQL right now.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Object.entries(info.counts).map(([k, v]) => (
              <div key={k} className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2">
                <div className="truncate text-[11px] text-text-muted">{k.replace(/_/g, " ")}</div>
                <div className="font-heading text-xl font-bold text-white tabular" data-testid={`count-${k}`}>{v}</div>
              </div>
            ))}
          </div>
          {info.sales && (
            <p className="text-sm text-text-secondary">
              Sales by source — live SSE: <b className="text-white">{info.sales.sse}</b>, reconciliation: <b className="text-white">{info.sales.reconciliation}</b>, historical
              import: <b className="text-white">{info.sales.backfill}</b>. Reward-eligible: <b className="text-white">{info.sales.reward_eligible}</b>. Latest stored {fmtDate(info.sales.latest_stored_at)}.
            </p>
          )}
        </Section>
      )}

      <Section title="Synchronisation" description={`Reconciliation re-checks yesterday and today every few minutes. /recent-sales returns at most ${info.recentSalesLimit} sales per request; full pages are flagged as possibly incomplete.`}>
        <Table head={["Checkpoint", "Last run", "Status", "Details"]} empty={!info.checkpoints?.length}>
          {info.checkpoints?.map((c) => (
            <tr key={c.id}>
              <td className={`${td} font-medium text-white`}>{c.id}</td>
              <td className={td}>{fmtDate(c.last_sync_at)}</td>
              <td className={td}><Dot ok={c.status !== "error"} warn={c.status === "partial"} /> <span className="ml-1">{c.status}</span></td>
              <td className={`${td} text-xs text-text-muted`}>
                {c.error ? <span className="text-rose-300">{c.error}</span> : null}
                {c.details && "fetched" in c.details ? `fetched ${c.details.fetched}, stored ${c.details.inserted}, upstream validated ${c.details.upstreamValidated ?? "?"}` : null}
                {c.last_event_id ? `last event ${c.last_event_id}` : null}
              </td>
            </tr>
          ))}
        </Table>
        <div className="flex flex-wrap gap-2">
          <PrimaryButton disabled={busy} onClick={reconcile}><RefreshCw className="h-4 w-4" /> Check for missed sales now</PrimaryButton>
        </div>
        <Field label="Historical import" hint="Stores past sales for reporting. Never grants spins or bonuses. Up to 93 days per run.">
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className={`${inputClass} max-w-[170px]`} aria-label="From" />
            <span className="text-text-muted">to</span>
            <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className={`${inputClass} max-w-[170px]`} aria-label="To" />
            <GhostButton disabled={busy || !range.from || !range.to} onClick={backfill}>Import</GhostButton>
          </div>
        </Field>
      </Section>

      <Section title="Recent privileged activity" description="Last 50 audit entries.">
        <Table head={["When", "Who", "Action", "Target", "IP"]} empty={!info.audit?.length} testId="audit">
          {info.audit?.map((a) => (
            <tr key={a.id}>
              <td className={td}>{fmtDate(a.created_at)}</td>
              <td className={td}>{a.admin_email ?? a.actor}</td>
              <td className={`${td} font-medium text-white`}>{a.action}</td>
              <td className={`${td} text-text-muted`}>{a.target_type}{a.target_id ? ` · ${a.target_id}` : ""}</td>
              <td className={`${td} text-text-muted tabular`}>{a.ip_address ?? "—"}</td>
            </tr>
          ))}
        </Table>
      </Section>
    </div>
  );
}
