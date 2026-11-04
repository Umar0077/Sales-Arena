"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi } from "@/components/admin/admin-api";
import { Section, GhostButton, Range } from "@/components/admin/ui";
import { saveSettings } from "@/lib/admin/global-settings";
import { useSettingsStore } from "@/store/settings-store";
import { fmtDate, Notice, Table, td } from "@/components/admin/spins/shared";
import { cn } from "@/lib/utils";
import { useAdminSync } from "@/components/admin/AdminLiveSync";

interface Row {
  caseId: string;
  agentName: string | null;
  source: string;
  validatedAt: string;
  storedAt: string;
  discoverySec: number;
  awardCreatedAt: string | null;
  awardSec: number | null;
}
interface Data {
  recent: Row[];
  bySource: Array<{ source: string; sales: number; medianSec: number | null; p95Sec: number | null; maxSec: number | null }>;
  upstream: { status: string; lastEventAt: string | null; lastConnectedAt: string | null; lastError: string | null; salesPersisted: number; persistFailures: number; unrecognizedEvents?: Record<string, { count: number; lastAt: string; fields: string[] }> };
  reconcileMinutes: number;
  discoverySeconds: number;
  connectedDisplays: number;
  trace: TraceRow[];
  traceStats: Array<{ stage: string; samples: number; medianSec: number | null; p95Sec: number | null; maxSec: number | null }>;
}
interface TraceRow {
  kind: "sale" | "award";
  key: string;
  source: string;
  validatedAt: string | null;
  displays: number;
  viaSync: number;
  stages: { discoverySec: number | null; backendSec: number | null; sseSec: number | null; frontendSec: number | null; totalSec: number | null };
}
const STAGE: Record<string, string> = {
  discovery: "Discovery (Safe Quote → this server)",
  backend: "Backend (stored → broadcast)",
  sse: "Live delivery (broadcast → first display)",
  frontend: "Display queue (received → popup on screen)",
  total: "Total (validated → first popup)",
};

const secs = (v: number | null) => (v === null ? "—" : v < 90 ? `${v.toFixed(1)}s` : `${(v / 60).toFixed(1)} min`);
const SOURCE: Record<string, string> = { sse: "Live stream", reconciliation: "Reconciliation poll" };

/**
 * System Health → Live delivery: where time goes between a Safe Quote validation and the Live Arena.
 * Read-only. Browser-side stages (SSE → popup) are in each display's console as window.__arenaLatency.
 */
export function LiveDeliveryPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await adminApi<Data>("/api/admin/live-delivery?limit=30");
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else setError(r.error);
  }, []);
  // Reloads (silently) when a sale or award is stored: live event or background sync.
  const salesRev = useAdminSync((s) => s.salesRev);
  const awardsRev = useAdminSync((s) => s.awardsRev);
  useEffect(() => {
    const t = setTimeout(() => void load(), salesRev || awardsRev ? 4000 : 0); // let displays report first
    return () => clearTimeout(t);
  }, [load, salesRev, awardsRev]);

  const live = data?.upstream.status === "connected";
  const syncSec = useSettingsStore((s) => s.liveSyncSeconds) || 15;
  const lastCheckAt = useAdminSync((s) => s.lastCheckAt);
  const checkFailures = useAdminSync((s) => s.checkFailures);
  return (
    <Section
      title="Live delivery"
      description={`How each recent sale reached FE Sales Arena. “Live stream” = Safe Quote's real-time events (seconds). “Reconciliation poll” = found by polling Safe Quote (today every ${data?.discoverySeconds || "—"} s, full check every ${data?.reconcileMinutes ?? 5} min), i.e. the live stream did not deliver it. Award = time from storing the sale to its bonus record.`}
      actions={<GhostButton className="px-3 py-2 text-xs" onClick={() => void load()}>Refresh</GhostButton>}
    >
      {error && <Notice kind="error">{error}</Notice>}
      <Range
        label="Background sync"
        hint="How often every Live Arena display and Admin tab checks for anything the live stream did not deliver (no page reload). Sale and bonus popups never wait for this: they appear as soon as the live event arrives."
        value={syncSec}
        min={10}
        max={120}
        step={5}
        onChange={(v) => saveSettings({ liveSyncSeconds: v })}
        format={(v) => `every ${v}s`}
      />
      <p className="text-xs text-text-muted" data-testid="admin-sync-status">
        This tab: {lastCheckAt ? `last background check ${fmtDate(new Date(lastCheckAt).toISOString())}` : "first background check pending"}
        {checkFailures ? ` · ${checkFailures} failed check(s), retrying with backoff` : ""}
      </p>
      {data && (
        <>
          <div className="flex flex-wrap gap-3 text-sm" data-testid="delivery-status">
            <span className={cn("rounded-lg border px-3 py-1.5", live ? "border-emerald-400/40 text-emerald-300" : "border-rose-400/40 text-rose-300")}>
              Safe Quote live stream: <b>{data.upstream.status}</b>
              {data.upstream.lastEventAt ? ` · last event ${fmtDate(data.upstream.lastEventAt)}` : ""}
            </span>
            <span className="rounded-lg border border-white/10 px-3 py-1.5 text-text-secondary">Connected displays: <b className="text-white">{data.connectedDisplays}</b></span>
            {data.upstream.persistFailures > 0 && <span className="rounded-lg border border-amber-300/40 px-3 py-1.5 text-amber-200">Store failures: {data.upstream.persistFailures}</span>}
            {data.upstream.lastError && <span className="rounded-lg border border-rose-400/40 px-3 py-1.5 text-rose-300">Last error: {data.upstream.lastError}</span>}
          </div>
          {Object.keys(data.upstream.unrecognizedEvents ?? {}).length > 0 && (
            <Notice kind="info">
              <span data-testid="delivery-unrecognized">
                Safe Quote sent live events this app does not store directly:{" "}
                {Object.entries(data.upstream.unrecognizedEvents ?? {})
                  .map(([name, e]) => `“${name}” ×${e.count} (fields: ${e.fields.join(", ") || "none"}; last ${fmtDate(e.lastAt)})`)
                  .join(" · ")}
                . Each one triggers an immediate check of Safe Quote&apos;s validated sales, so a validation is stored within seconds.
              </span>
            </Notice>
          )}
          <Table head={["Discovered by (last 7 days)", "Sales", "Median delay", "95th percentile", "Slowest"]} empty={!data.bySource.length} testId="delivery-summary">
            {data.bySource.map((s) => (
              <tr key={s.source}>
                <td className={`${td} font-medium text-white`}>{SOURCE[s.source] ?? s.source}</td>
                <td className={`${td} tabular`}>{s.sales}</td>
                <td className={`${td} tabular`}>{secs(s.medianSec)}</td>
                <td className={`${td} tabular`}>{secs(s.p95Sec)}</td>
                <td className={`${td} tabular`}>{secs(s.maxSec)}</td>
              </tr>
            ))}
          </Table>
          <Table head={["Sale", "Discovered by", "Validated", "Stored", "Delay", "Award"]} empty={!data.recent.length} testId="delivery-recent">
            {data.recent.map((r) => (
              <tr key={r.caseId}>
                <td className={td}>
                  <span className="font-medium text-white">{r.agentName ?? "—"}</span>
                  <div className="font-mono text-[10px] text-text-muted">{r.caseId}</div>
                </td>
                <td className={cn(td, r.source === "sse" ? "text-emerald-300" : "text-amber-200")}>{SOURCE[r.source] ?? r.source}</td>
                <td className={`${td} text-text-muted`}>{fmtDate(r.validatedAt)}</td>
                <td className={`${td} text-text-muted`}>{fmtDate(r.storedAt)}</td>
                <td className={cn(td, "tabular", r.discoverySec > 120 ? "text-amber-200" : "text-text-secondary")}>{secs(r.discoverySec)}</td>
                <td className={`${td} tabular text-text-muted`}>{r.awardCreatedAt ? `+${secs(r.awardSec)}` : "—"}</td>
              </tr>
            ))}
          </Table>
          <Table head={["End-to-end stage (since the app started)", "Samples", "Median", "95th percentile", "Slowest"]} empty={false} testId="delivery-stages">
            {data.traceStats.map((s) => (
              <tr key={s.stage} data-stage={s.stage}>
                <td className={`${td} font-medium text-white`}>{STAGE[s.stage] ?? s.stage}</td>
                <td className={`${td} tabular`}>{s.samples}</td>
                {s.medianSec === null ? (
                  <td className={`${td} text-text-muted`} colSpan={3}>
                    {s.samples ? `Needs at least 5 measured samples (${s.samples} so far)` : "Not measured yet"}
                  </td>
                ) : (
                  <>
                    <td className={`${td} tabular`}>{secs(s.medianSec)}</td>
                    <td className={`${td} tabular`}>{secs(s.p95Sec)}</td>
                    <td className={`${td} tabular`}>{secs(s.maxSec)}</td>
                  </>
                )}
              </tr>
            ))}
          </Table>
          <Table head={["Sale / award", "Discovered by", "Discovery", "Backend", "Live delivery", "Display queue", "Total", "Displays"]} empty={!data.trace.length} testId="delivery-trace">
            {data.trace.map((r) => (
              <tr key={`${r.kind}:${r.key}`} data-key={r.key}>
                <td className={td}>
                  <span className="font-medium text-white">{r.kind === "sale" ? "Sale" : "Bonus award"}</span>
                  <div className="max-w-[16rem] truncate font-mono text-[10px] text-text-muted" title={r.key}>{r.key}</div>
                </td>
                <td className={cn(td, r.source === "sse" ? "text-emerald-300" : "text-amber-200")}>{SOURCE[r.source] ?? r.source}</td>
                <td className={cn(td, "tabular", (r.stages.discoverySec ?? 0) > 120 ? "text-amber-200" : "text-text-secondary")}>{secs(r.stages.discoverySec)}</td>
                <td className={`${td} tabular`}>{secs(r.stages.backendSec)}</td>
                <td className={`${td} tabular`}>{secs(r.stages.sseSec)}</td>
                <td className={`${td} tabular`}>{secs(r.stages.frontendSec)}</td>
                <td className={`${td} tabular font-semibold text-white`}>{secs(r.stages.totalSec)}</td>
                <td className={`${td} tabular text-text-muted`} title="Displays that reported; via background sync = their live stream missed it">
                  {r.displays}
                  {r.viaSync ? ` (${r.viaSync} via sync)` : ""}
                </td>
              </tr>
            ))}
          </Table>
          <p className="text-xs text-text-muted">
            Discovery is upstream / polling time; Backend, Live delivery and Display queue happen in FE Sales Arena and the browsers. Display times are
            corrected to the server clock (accurate to about half a network round trip). The end-to-end trace is kept in memory and restarts with the app.
          </p>
        </>
      )}
    </Section>
  );
}
