"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { adminApi } from "@/components/admin/admin-api";
import { Section, inputClass } from "@/components/admin/ui";
import { useAgentSearch } from "./AllocateTab";
import { fmtDate, Notice, Table, td } from "./shared";

export function BalancesTab({ onHistory }: { onHistory: (userCode: string) => void }) {
  const [q, setQ] = useState("");
  const { rows, error, reload } = useAgentSearch(q);
  const [msg, setMsg] = useState<string | null>(null);

  const toggle = async (userCode: string, eligible: boolean) => {
    const r = await adminApi("/api/admin/spins/agents", { method: "PATCH", body: { userCode, eligible } });
    setMsg(r.ok ? null : r.error);
    reload();
  };

  return (
    <Section title="Agent spin balances" description="From the PostgreSQL ledger (the source of truth). Eligible sales = validated after the activation cutoff, from live sync.">
      <label className="relative block max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or userCode" className={`${inputClass} pl-9`} aria-label="Search agents" />
      </label>
      {(error || msg) && <Notice kind="error">{error ?? msg}</Notice>}
      <Table head={["Agent", "userCode", "Validated sales", "Eligible", "Automatic", "Manual", "Used", "Available", "Last spin", "Auto spins", ""]} empty={!rows.length} testId="balances">
        {rows.map((a) => (
          <tr key={a.user_code}>
            <td className={`${td} font-medium text-white`}>{a.name}</td>
            <td className={`${td} text-text-muted tabular`}>{a.user_code}</td>
            <td className={`${td} tabular`}>{a.validated_sales}</td>
            <td className={`${td} tabular`}>{a.eligible_sales}</td>
            <td className={`${td} tabular`}>{a.auto_earned}</td>
            <td className={`${td} tabular`}>{a.manual_earned}</td>
            <td className={`${td} tabular`}>{a.consumed}</td>
            <td className={`${td} font-heading font-bold text-gold tabular`}>{a.available}</td>
            <td className={td}>{fmtDate(a.last_spin_at)}</td>
            <td className={td}>
              <label className="inline-flex items-center gap-2 text-xs">
                <input type="checkbox" checked={a.spin_eligible} onChange={(e) => toggle(a.user_code, e.target.checked)} className="h-4 w-4 accent-[#7568FF]" />
                {a.spin_eligible ? "Eligible" : "Excluded"}
              </label>
            </td>
            <td className={td}>
              <button onClick={() => onHistory(a.user_code)} className="text-xs font-semibold text-secondary hover:underline">History</button>
            </td>
          </tr>
        ))}
      </Table>
    </Section>
  );
}
