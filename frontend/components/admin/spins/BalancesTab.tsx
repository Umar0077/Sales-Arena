"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { adminApi } from "@/frontend/components/admin/admin-api";
import { Section, Choice, inputClass } from "@/frontend/components/admin/ui";
import { AgentEmoji } from "@/frontend/components/celebrations/AgentEmoji";
import { useAgentSearch } from "./AllocateTab";
import { fmtDate, Notice, Table, td } from "./shared";

export function BalancesTab({ onHistory }: { onHistory: (userCode: string) => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "available" | "eligible" | "excluded">("all");
  const { rows, error, reload } = useAgentSearch(q);
  const [msg, setMsg] = useState<string | null>(null);

  const toggle = async (userCode: string, eligible: boolean) => {
    const r = await adminApi("/api/admin/spins/agents", { method: "PATCH", body: { userCode, eligible } });
    setMsg(r.ok ? null : r.error);
    reload();
  };

  const filtered = useMemo(() => {
    if (filter === "available") return rows.filter((a) => a.available > 0);
    if (filter === "eligible") return rows.filter((a) => a.spin_eligible);
    if (filter === "excluded") return rows.filter((a) => !a.spin_eligible);
    return rows;
  }, [rows, filter]);

  return (
    <Section title="Agent spin balances" description="Authoritative PostgreSQL ledger balances, agent emojis, allocation timestamps, and spin eligibility.">
      <div className="flex flex-wrap items-end gap-3">
        <label className="relative block min-w-[240px] flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or userCode" className={`${inputClass} pl-9`} aria-label="Search agents" />
        </label>
        <Choice
          label="Filter"
          value={filter}
          options={[
            { value: "all", label: "All" },
            { value: "available", label: "Has Available" },
            { value: "eligible", label: "Eligible" },
            { value: "excluded", label: "Excluded" },
          ]}
          onChange={setFilter}
        />
      </div>
      {(error || msg) && <Notice kind="error">{error ?? msg}</Notice>}
      <Table head={["Agent", "userCode", "Auto", "Manual", "Used", "Available", "Last allocation", "Last spin", "Auto spins", ""]} empty={!filtered.length} testId="balances">
        {filtered.map((a) => (
          <tr key={a.user_code}>
            <td className={td}>
              <div className="flex items-center gap-2.5">
                <div className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/10">
                  <AgentEmoji
                    agentId={a.agent_id ?? `agt_${a.user_code}`}
                    name={a.name}
                    className="h-8 w-8 object-contain"
                    fallback={<span className="text-[10px] font-bold text-white">{a.name.slice(0, 2).toUpperCase()}</span>}
                  />
                </div>
                <span className="font-medium text-white">{a.name}</span>
              </div>
            </td>
            <td className={`${td} text-text-muted tabular`}>{a.user_code}</td>
            <td className={`${td} tabular`}>{a.auto_earned}</td>
            <td className={`${td} tabular`}>{a.manual_earned}</td>
            <td className={`${td} tabular`}>{a.consumed}</td>
            <td className={`${td} font-heading font-bold text-gold tabular`}>{a.available}</td>
            <td className={td}>{fmtDate(a.last_allocated_at)}</td>
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
