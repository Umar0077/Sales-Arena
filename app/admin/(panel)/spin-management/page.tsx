"use client";

import { useState } from "react";
import { RulesTab } from "@/components/admin/spins/RulesTab";
import { AllocateTab } from "@/components/admin/spins/AllocateTab";
import { BalancesTab } from "@/components/admin/spins/BalancesTab";
import { HistoryTab } from "@/components/admin/spins/HistoryTab";
import { PrizesTab } from "@/components/admin/spins/PrizesTab";
import { DevicesTab } from "@/components/admin/spins/DevicesTab";
import { cn } from "@/lib/utils";

const TABS = ["Rules & Settings", "Manual Allocation", "Agent Balances", "Credit History", "Prizes", "Displays"] as const;
type Tab = (typeof TABS)[number];

/** Spin Management — everything here is stored in PostgreSQL and enforced on the server. */
export default function SpinManagementPage() {
  const [tab, setTab] = useState<Tab>("Rules & Settings");
  const [historyFor, setHistoryFor] = useState("");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl font-bold text-white">Spin Management</h2>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">
          Automatic spins from validated sales, manual allocations, balances, history, prizes and authorised displays. All changes are
          validated on the server, saved in one database transaction and recorded in the audit log.
        </p>
      </div>
      <div role="tablist" aria-label="Spin management" className="flex flex-wrap gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn("rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors", tab === t ? "bg-primary text-white shadow" : "text-text-secondary hover:text-white")}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Rules & Settings" && <RulesTab />}
      {tab === "Manual Allocation" && <AllocateTab />}
      {tab === "Agent Balances" && (
        <BalancesTab
          onHistory={(u) => {
            setHistoryFor(u);
            setTab("Credit History");
          }}
        />
      )}
      {tab === "Credit History" && <HistoryTab key={historyFor} initialUserCode={historyFor} />}
      {tab === "Prizes" && <PrizesTab />}
      {tab === "Displays" && <DevicesTab />}
    </div>
  );
}
