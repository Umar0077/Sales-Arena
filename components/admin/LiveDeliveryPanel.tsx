"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi } from "@/components/admin/admin-api";
import { Section, GhostButton } from "@/components/admin/ui";
import { fmtDate, Notice, Table, td } from "@/components/admin/spins/shared";
import { cn } from "@/lib/utils";

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
  upstream: { status: string; lastEventAt: string | null; lastConnectedAt: string | null; lastError: string | null; salesPersisted: number; persistFailures: number };
  reconcileMinutes: number;
  connectedDisplays: number;
}

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
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const live = data?.upstream.status === "connected";
  return (
    <Section
      title="Live delivery"
      description={`How each recent sale reached FE Sales Arena. “Live stream” = Safe Quote's real-time events (seconds). “Reconciliation poll” = found by the every-${data?.reconcileMinutes ?? 5}-minute recent-sales check, i.e. the live stream did not deliver it. Award = time from storing the sale to its bonus record.`}
      actions={<GhostButton className="px-3 py-2 text-xs" onClick={() => void load()}>Refresh</GhostButton>}
    >
      {error && <Notice kind="error">{error}</Notice>}
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
        </>
      )}
    </Section>
  );
}
