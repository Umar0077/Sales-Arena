"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, CheckCircle2 } from "lucide-react";
import { adminApi } from "@/frontend/components/admin/admin-api";
import { Section, Field, PrimaryButton, GhostButton, inputClass } from "@/frontend/components/admin/ui";
import { fmtDate, Notice, Table, td } from "./shared";

export interface MissingSpinReportRow {
  userCode: string;
  name: string;
  periodKey: string;
  businessDate: string;
  rawValidatedSales: number;
  weightedCredits: number;
  salesPerSpin: number;
  spinsPerThreshold: number;
  expectedAutoSpins: number;
  grantedAutoSpins: number;
  manualEarned: number;
  consumed: number;
  available: number;
  expired: number;
  missingSpins: number;
  spinEligible: boolean;
  status: "missing" | "granted" | "below_threshold" | "ineligible" | "disabled";
  reason: string;
  ruleId: string;
}

const STATUS_BADGE: Record<MissingSpinReportRow["status"], string> = {
  missing: "bg-amber-500/20 text-amber-200 border-amber-400/40",
  granted: "bg-emerald-500/15 text-emerald-200 border-emerald-400/30",
  below_threshold: "bg-white/10 text-text-secondary border-white/10",
  ineligible: "bg-rose-500/15 text-rose-200 border-rose-400/30",
  disabled: "bg-rose-500/15 text-rose-200 border-rose-400/30",
};

/**
 * Shared Find Missing Spins & Reconcile panel (used in Spin History → Find Missing Spins
 * and the Reconcile tab). Queries authoritative validated_sales from America/New_York
 * business dates and allows single-agent or batch missing spin approval.
 */
export function FindMissingSpinsPanel({ onAllocated }: { onAllocated?: () => void }) {
  const [fromDate, setFromDate] = useState("2026-11-27");
  const [toDate, setToDate] = useState("");
  const [q, setQ] = useState("");
  const [report, setReport] = useState<MissingSpinReportRow[] | null>(null);
  const [meta, setMeta] = useState<{ campaignStartAt: string; timezone: string; autoEnabled: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [approvingKey, setApprovingKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    if (q.trim()) params.set("q", q.trim());
    const r = await adminApi<{
      campaignStartAt: string;
      timezone: string;
      autoEnabled: boolean;
      report: MissingSpinReportRow[];
    }>(`/api/admin/spins/reconcile?${params.toString()}`);
    setBusy(false);
    if (r.ok) {
      setReport(r.data.report);
      setMeta({
        campaignStartAt: r.data.campaignStartAt,
        timezone: r.data.timezone,
        autoEnabled: r.data.autoEnabled,
      });
      setMsg(null);
    } else {
      setMsg({ kind: "error", text: r.error });
    }
  }, [fromDate, toDate, q]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 150);
    return () => clearTimeout(t);
  }, [load]);

  const allocateSingle = async (row: MissingSpinReportRow) => {
    const rowKey = `${row.userCode}:${row.periodKey}`;
    setApprovingKey(rowKey);
    const r = await adminApi<{ granted: Array<{ userCode: string; name: string; grantsAdded: number; balanceAfter: number }> }>(
      "/api/admin/spins/reconcile",
      { method: "POST", body: { dryRun: false, agentIds: [row.userCode], periodKey: row.periodKey } },
    );
    setApprovingKey(null);
    if (r.ok) {
      const g = r.data.granted[0];
      setMsg({
        kind: "ok",
        text:
          g && g.grantsAdded > 0
            ? `Allocated missing spin(s) for ${row.name} (${row.periodKey}). Available balance: ${g.balanceAfter}.`
            : `No new spins granted for ${row.name} (already granted or ineligible).`,
      });
      onAllocated?.();
      void load();
    } else {
      setMsg({ kind: "error", text: r.error });
    }
  };

  const withMissing = (report ?? []).filter((r) => r.missingSpins > 0);

  return (
    <Section
      title="Find Missing Spins"
      description="Compares authoritative validated sales (America/New_York business dates) against granted automatic spins. Includes agents who have qualifying sales without any prior spin ledger row."
    >
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {meta && (
        <p className="text-xs text-text-muted">
          Campaign start: <span className="text-white">{fmtDate(meta.campaignStartAt)}</span> · Timezone: <span className="text-white">{meta.timezone}</span> · Auto spins: <span className={meta.autoEnabled ? "text-emerald-300" : "text-rose-300"}>{meta.autoEnabled ? "Enabled" : "Disabled"}</span>
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From business date (NY)">
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={`${inputClass} w-44`} aria-label="From business date" />
        </Field>
        <Field label="To business date (optional)">
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={`${inputClass} w-44`} aria-label="To business date" />
        </Field>
        <Field label="Search agent">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or userCode" className={`${inputClass} w-52 pl-9`} aria-label="Search missing spins" />
          </div>
        </Field>
        <GhostButton disabled={busy} onClick={load} data-testid="reconcile-refresh">
          {busy ? "Scanning…" : "Scan Sales"}
        </GhostButton>
      </div>

      {withMissing.length > 0 && (
        <Notice kind="info">
          Found <b>{withMissing.length}</b> agent period{withMissing.length === 1 ? "" : "s"} with missing spin entitlements. Approve individually below.
        </Notice>
      )}

      {report !== null && (
        <Table
          head={["Agent", "Date / Period", "Raw Sales", "Weighted", "Expected", "Auto Granted", "Manual", "Used", "Available", "Missing", "Status / Reason", "Action"]}
          empty={report.length === 0}
          testId="reconcile-table"
        >
          {report.map((r) => {
            const rowKey = `${r.userCode}:${r.periodKey}`;
            return (
              <tr key={rowKey} className={r.missingSpins > 0 ? "bg-amber-500/[0.06]" : ""}>
                <td className={td}>
                  <span className="font-medium text-white">{r.name}</span>
                  <span className="block text-xs text-text-muted tabular">{r.userCode}</span>
                </td>
                <td className={`${td} tabular whitespace-nowrap`}>
                  <span className="text-white">{r.businessDate}</span>
                  <span className="block text-xs text-text-muted">{r.periodKey}</span>
                </td>
                <td className={`${td} tabular font-semibold text-white`}>{r.rawValidatedSales}</td>
                <td className={`${td} tabular text-text-secondary`}>{r.weightedCredits}</td>
                <td className={`${td} tabular`}>{r.expectedAutoSpins}</td>
                <td className={`${td} tabular`}>{r.grantedAutoSpins}</td>
                <td className={`${td} tabular`}>{r.manualEarned}</td>
                <td className={`${td} tabular`}>{r.consumed}</td>
                <td className={`${td} tabular font-bold text-gold`}>{r.available}</td>
                <td className={`${td} tabular font-bold ${r.missingSpins > 0 ? "text-amber-300" : "text-emerald-300"}`}>
                  {r.missingSpins > 0 ? `+${r.missingSpins}` : "0"}
                </td>
                <td className={td}>
                  <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[r.status]}`}>
                    {r.reason}
                  </span>
                </td>
                <td className={td}>
                  {r.missingSpins > 0 ? (
                    <PrimaryButton
                      disabled={approvingKey === rowKey}
                      onClick={() => allocateSingle(r)}
                      data-testid={`allocate-missing-${r.userCode}`}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {approvingKey === rowKey ? "Allocating…" : "Allocate Missing Spin"}
                    </PrimaryButton>
                  ) : (
                    <span className="text-xs text-text-muted">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </Section>
  );
}

export function ReconcileTab() {
  return <FindMissingSpinsPanel />;
}
