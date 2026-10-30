"use client";

import { useState, useMemo } from "react";
import { useArenaStore } from "@/store/arena-store";
import type { SpinResult } from "@/types";
import { 
  Disc3, 
  Search, 
  Download, 
  Filter, 
  Clock, 
  CheckCircle2, 
  Eye, 
  X 
} from "lucide-react";
import { formatDateTime, toCsv, downloadText } from "@/lib/utils";

export default function AdminSpinsPage() {
  const store = useArenaStore();
  const [search, setSearch] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [inspectSpin, setInspectSpin] = useState<SpinResult | null>(null);

  const filteredSpins = useMemo(() => {
    return store.spins.filter((s) => {
      const agent = store.agents.find((a) => a.id === s.agentId);
      const matchSearch =
        (agent?.name || "").toLowerCase().includes(search.toLowerCase()) ||
        s.rewardTitle.toLowerCase().includes(search.toLowerCase());
      const matchStatus = selectedStatus === "all" || s.status === selectedStatus;
      return matchSearch && matchStatus;
    });
  }, [store.spins, store.agents, search, selectedStatus]);

  const handleExportCsv = () => {
    const rows = filteredSpins.map((s) => {
      const agent = store.agents.find((a) => a.id === s.agentId);
      return {
        SpinId: s.id,
        Agent: agent?.name || s.agentId,
        Prize: s.rewardTitle,
        Status: s.status,
        Mode: s.mode,
        Timestamp: s.createdAt,
      };
    });

    const csvContent = toCsv(rows);
    downloadText(`sales-arena-spins-${new Date().toISOString().slice(0, 10)}.csv`, csvContent);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-bold text-white">Spin Audit Logs</h2>
          <p className="text-xs text-muted">
            Immutable log of all wheel spins, prize distributions, and fulfillment states
          </p>
        </div>

        <button
          onClick={handleExportCsv}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface border border-white/10 hover:border-primary/40 font-heading text-xs font-bold text-white shadow transition-all"
        >
          <Download className="w-4 h-4 text-secondary" />
          <span>Export CSV</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            placeholder="Search by agent name or prize..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-surface border border-white/10 text-xs text-white placeholder-muted focus:outline-none focus:border-primary/50"
          />
        </div>

        <div className="flex items-center gap-1.5 bg-surface border border-white/10 rounded-xl px-3 py-2 text-xs text-muted">
          <Filter className="w-3.5 h-3.5" />
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="bg-transparent text-white font-semibold focus:outline-none cursor-pointer"
          >
            <option value="all" className="bg-elevated">All Statuses</option>
            <option value="completed" className="bg-elevated">Completed</option>
            <option value="fulfilled" className="bg-elevated">Fulfilled</option>
            <option value="in-progress" className="bg-elevated">In Progress</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-3xl border border-white/10 bg-[#0D1426]/90 overflow-hidden backdrop-blur-md">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/5 bg-surface/40 font-mono text-[11px] uppercase text-muted">
              <tr>
                <th className="py-3 px-4">Agent</th>
                <th className="py-3 px-4">Won Prize</th>
                <th className="py-3 px-4">Date / Time</th>
                <th className="py-3 px-4">Mode</th>
                <th className="py-3 px-4">Fulfillment</th>
                <th className="py-3 px-4 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredSpins.map((s) => {
                const agt = store.agents.find((a) => a.id === s.agentId);
                const team = agt ? store.teams.find((t) => t.id === agt.teamId) : null;

                return (
                  <tr key={s.id} className="hover:bg-white/5 transition-colors">
                    <td className="py-3 px-4">
                      <span className="font-heading font-bold text-white block">
                        {agt?.name || "Agent"}
                      </span>
                      <span className="text-[10px] text-muted">
                        {team?.name || "Team"}
                      </span>
                    </td>

                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: s.rewardColor }}
                        />
                        <span className="font-heading font-bold text-gold">
                          {s.rewardTitle}
                        </span>
                      </div>
                    </td>

                    {/* Demo data is timestamped separately on server and browser, so minutes can differ. */}
                    <td className="py-3 px-4 font-mono text-muted text-[11px]" suppressHydrationWarning>
                      {formatDateTime(s.createdAt)}
                    </td>

                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-md bg-white/5 font-mono text-[10px] uppercase text-text-secondary">
                        {s.mode}
                      </span>
                    </td>

                    <td className="py-3 px-4">
                      {s.status === "fulfilled" ? (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold text-[10px]">
                          FULFILLED
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-gold/15 text-gold font-semibold text-[10px]">
                          COMPLETED
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => setInspectSpin(s)}
                        className="p-1.5 rounded-lg bg-surface hover:bg-surface-hover text-muted hover:text-white transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inspect Detail Modal */}
      {inspectSpin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#0D1426] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-4">
              <h3 className="font-heading font-bold text-lg text-white">
                Spin Transaction Receipt
              </h3>
              <button
                onClick={() => setInspectSpin(null)}
                className="p-1 rounded-lg hover:bg-white/10 text-muted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-muted">Transaction ID:</span>
                <span className="font-mono text-white">{inspectSpin.id}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-muted">Agent ID:</span>
                <span className="font-mono text-white">{inspectSpin.agentId}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-muted">Prize Won:</span>
                <span className="font-bold text-gold">{inspectSpin.rewardTitle}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-muted">Mode:</span>
                <span className="font-mono uppercase text-secondary">{inspectSpin.mode}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-white/5">
                <span className="text-muted">Timestamp:</span>
                <span className="font-mono text-white">{formatDateTime(inspectSpin.createdAt)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-muted">Fulfillment Status:</span>
                <span className="font-bold text-emerald-400 uppercase">{inspectSpin.status}</span>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => {
                  store.setSpinStatus(
                    inspectSpin.id,
                    inspectSpin.status === "fulfilled" ? "completed" : "fulfilled"
                  );
                  setInspectSpin(null);
                }}
                className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover font-heading text-xs font-bold text-white shadow-lg shadow-primary/25"
              >
                Toggle Fulfilled Status
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
