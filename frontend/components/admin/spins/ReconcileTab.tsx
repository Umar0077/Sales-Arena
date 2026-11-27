"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi } from "@/frontend/components/admin/admin-api";
import { Section, PrimaryButton, GhostButton } from "@/frontend/components/admin/ui";
import { Notice, Table, td } from "./shared";

interface ReportRow {
  userCode: string;
  name: string;
  rawValidatedSales: number;
  actualCredits: number;
  expectedCredits: number;
  missingCredits: number;
  rule: string | null;
}

/**
 * Read-only reconciliation: compares expected spin credits (raw validated sales ÷ threshold)
 * against what has actually been granted. Admins can then write missing credits with one click.
 */
export function ReconcileTab() {
  const [report, setReport] = useState<ReportRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    const r = await adminApi<{ report: ReportRow[] }>("/api/admin/spins/reconcile");
    setBusy(false);
    if (r.ok) {
      setReport(r.data.report);
      setSelected(new Set());
      if (r.data.report.length === 0) setMsg({ kind: "info", text: "Automatic spins are disabled or no activation cutoff is set. Enable them in Rules & Settings first." });
      else setMsg(null);
    } else setMsg({ kind: "error", text: r.error });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const withDeficit = (report ?? []).filter((r) => r.missingCredits > 0);
  const toggleAll = () =>
    setSelected((prev) =>
      prev.size === withDeficit.length ? new Set() : new Set(withDeficit.map((r) => r.userCode)),
    );
  const toggle = (uc: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(uc) ? next.delete(uc) : next.add(uc);
      return next;
    });

  const grantMissing = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Grant missing spin credits to ${selected.size} agent${selected.size > 1 ? "s" : ""}? This writes to the ledger and cannot be undone.`)) return;
    setBusy(true);
    const r = await adminApi<{ granted: Array<{ userCode: string; name: string; grantsAdded: number }> }>(
      "/api/admin/spins/reconcile",
      { method: "POST", body: { dryRun: false, agentIds: Array.from(selected) } },
    );
    setBusy(false);
    if (r.ok) {
      const count = r.data.granted.reduce((n, g) => n + g.grantsAdded, 0);
      setMsg({ kind: "ok", text: `Reconciliation complete. ${count} credit batch${count !== 1 ? "es" : ""} granted to ${r.data.granted.length} agent${r.data.granted.length !== 1 ? "s" : ""}.` });
      void load();
    } else setMsg({ kind: "error", text: r.error });
  };

  return (
    <div className="space-y-6">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      <Section
        title="Spin credit reconciliation"
        description="Read-only audit: compares expected credits (raw validated sales ÷ rule threshold) against what the ledger has actually granted. Use this to fix missing credits without duplicating existing ones."
      >
        <div className="flex flex-wrap items-center gap-3">
          <GhostButton disabled={busy} onClick={load}>
            {busy ? "Loading…" : "Refresh report"}
          </GhostButton>
          {withDeficit.length > 0 && (
            <>
              <GhostButton disabled={busy} onClick={toggleAll}>
                {selected.size === withDeficit.length ? "Deselect all" : `Select all with deficit (${withDeficit.length})`}
              </GhostButton>
              <PrimaryButton disabled={busy || selected.size === 0} onClick={grantMissing}>
                Grant missing credits ({selected.size} selected)
              </PrimaryButton>
            </>
          )}
        </div>

        {report !== null && (
          <Table
            head={["", "Agent", "userCode", "Raw sales", "Expected credits", "Actual credits", "Missing", "Rule"]}
            empty={report.length === 0}
            testId="reconcile-table"
          >
            {report.map((r) => (
              <tr key={r.userCode} className={r.missingCredits > 0 ? "bg-rose-500/5" : ""}>
                <td className={td}>
                  {r.missingCredits > 0 && (
                    <input
                      type="checkbox"
                      checked={selected.has(r.userCode)}
                      onChange={() => toggle(r.userCode)}
                      className="h-4 w-4 accent-[#7568FF]"
                      aria-label={`Select ${r.name}`}
                    />
                  )}
                </td>
                <td className={`${td} font-medium text-white`}>{r.name}</td>
                <td className={`${td} text-text-muted tabular`}>{r.userCode}</td>
                <td className={`${td} tabular`}>{r.rawValidatedSales}</td>
                <td className={`${td} tabular`}>{r.expectedCredits}</td>
                <td className={`${td} tabular`}>{r.actualCredits}</td>
                <td className={`${td} tabular font-bold ${r.missingCredits > 0 ? "text-rose-300" : "text-emerald-300"}`}>
                  {r.missingCredits > 0 ? `−${r.missingCredits}` : "✓"}
                </td>
                <td className={`${td} text-text-muted`}>{r.rule ?? "global"}</td>
              </tr>
            ))}
          </Table>
        )}
        {report === null && !msg && <p className="text-sm text-text-muted">Loading reconciliation report…</p>}
      </Section>
    </div>
  );
}
