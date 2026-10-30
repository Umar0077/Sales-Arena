"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { 
  Users, 
  Search, 
  CheckCircle2, 
  XCircle, 
  Disc3, 
  Gift, 
  RefreshCw, 
  AlertCircle,
  ExternalLink,
  X
} from "lucide-react";
import { adminApi } from "@/components/admin/admin-api";
import Link from "next/link";

interface AgentRow {
  user_code: string;
  name: string;
  spin_eligible: boolean;
  active: boolean;
  available: number;
  auto_earned: number;
  manual_earned: number;
  consumed: number;
  last_spin_at: string | null;
  validated_sales: number;
  eligible_sales: number;
}

export default function AdminAgentsPage() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [togglingCode, setTogglingCode] = useState<string | null>(null);

  // Manual spin allocation modal state
  const [allocatingAgent, setAllocatingAgent] = useState<AgentRow | null>(null);
  const [allocQty, setAllocQty] = useState(1);
  const [allocReason, setAllocReason] = useState("");
  const [allocating, setAllocating] = useState(false);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    const res = await adminApi<{ ok: boolean; agents: AgentRow[] }>("/api/admin/spins/agents?limit=150");
    setLoading(false);
    if (res.ok) {
      setAgents(res.data.agents);
      setError(null);
    } else {
      setError(res.error);
    }
  }, []);

  useEffect(() => {
    let active = true;
    adminApi<{ ok: boolean; agents: AgentRow[] }>("/api/admin/spins/agents?limit=150").then((res) => {
      if (!active) return;
      setLoading(false);
      if (res.ok) {
        setAgents(res.data.agents);
      } else {
        setError(res.error);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const toggleEligibility = async (agent: AgentRow) => {
    setTogglingCode(agent.user_code);
    const nextVal = !agent.spin_eligible;
    const res = await adminApi("/api/admin/spins/agents", {
      method: "PATCH",
      body: { userCode: agent.user_code, eligible: nextVal },
    });
    setTogglingCode(null);
    if (res.ok) {
      setAgents((prev) =>
        prev.map((a) => (a.user_code === agent.user_code ? { ...a, spin_eligible: nextVal } : a))
      );
      setActionMsg({
        kind: "ok",
        text: `Spin eligibility ${nextVal ? "enabled" : "disabled"} for ${agent.name}.`,
      });
      setTimeout(() => setActionMsg(null), 4000);
    } else {
      setActionMsg({ kind: "error", text: res.error });
    }
  };

  const handleAllocate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allocatingAgent || allocQty < 1 || allocReason.trim().length < 3) return;

    setAllocating(true);
    const idempotencyKey = `agent-alloc-${allocatingAgent.user_code}-${Date.now()}`;
    const res = await adminApi<{ balanceAfter: number }>("/api/admin/spins/allocate", {
      method: "POST",
      body: {
        userCode: allocatingAgent.user_code,
        quantity: allocQty,
        reason: allocReason.trim(),
        idempotencyKey,
      },
    });
    setAllocating(false);

    if (res.ok) {
      setActionMsg({
        kind: "ok",
        text: `Granted ${allocQty} spin${allocQty > 1 ? "s" : ""} to ${allocatingAgent.name}. New balance: ${res.data.balanceAfter}`,
      });
      setAllocatingAgent(null);
      setAllocQty(1);
      setAllocReason("");
      loadAgents();
      setTimeout(() => setActionMsg(null), 5000);
    } else {
      setActionMsg({ kind: "error", text: res.error });
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) => a.name.toLowerCase().includes(q) || a.user_code.toLowerCase().includes(q)
    );
  }, [agents, search]);

  const totals = useMemo(() => {
    return {
      closers: agents.length,
      availableSpins: agents.reduce((acc, a) => acc + (a.available || 0), 0),
      validatedSales: agents.reduce((acc, a) => acc + (a.validated_sales || 0), 0),
      eligibleClosers: agents.filter((a) => a.spin_eligible).length,
    };
  }, [agents]);

  return (
    <div className="space-y-6">
      {/* Header & Overview Stats */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-bold text-white">Agent & Closer Management</h2>
          <p className="mt-1 text-sm text-text-muted">
            Live closers synced with Safe Quote and PostgreSQL. View real-time sales counts, authoritative spin balances, and grant spins directly.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/spin-management"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-semibold text-text-secondary hover:text-white transition-colors"
          >
            <Disc3 className="h-4 w-4 text-primary" />
            <span>Spin Management</span>
            <ExternalLink className="h-3 w-3" />
          </Link>
          <button
            onClick={loadAgents}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-primary hover:bg-primary-hover text-xs font-bold text-white shadow-lg shadow-primary/20 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh Roster</span>
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-300">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      {actionMsg && (
        <div
          role="status"
          className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium ${
            actionMsg.kind === "ok"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-rose-500/30 bg-rose-500/10 text-rose-300"
          }`}
        >
          {actionMsg.kind === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <span>{actionMsg.text}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-white/10 bg-[#0D1426]/80 p-4 backdrop-blur-md">
          <div className="flex items-center justify-between text-xs text-muted font-semibold">
            <span>TOTAL CLOSERS</span>
            <Users className="w-4 h-4 text-secondary" />
          </div>
          <div className="font-heading text-2xl font-bold text-white mt-1">{totals.closers}</div>
          <div className="text-[11px] font-mono text-muted mt-0.5">Authoritative Safe Quote roster</div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0D1426]/80 p-4 backdrop-blur-md">
          <div className="flex items-center justify-between text-xs text-muted font-semibold">
            <span>SPIN ELIGIBLE</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="font-heading text-2xl font-bold text-emerald-400 mt-1">{totals.eligibleClosers}</div>
          <div className="text-[11px] font-mono text-muted mt-0.5">Active for automatic milestones</div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0D1426]/80 p-4 backdrop-blur-md">
          <div className="flex items-center justify-between text-xs text-muted font-semibold">
            <span>VALIDATED SALES</span>
            <CheckCircle2 className="w-4 h-4 text-gold" />
          </div>
          <div className="font-heading text-2xl font-bold text-gold mt-1">{totals.validatedSales}</div>
          <div className="text-[11px] font-mono text-muted mt-0.5">All-time persisted sales</div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0D1426]/80 p-4 backdrop-blur-md">
          <div className="flex items-center justify-between text-xs text-muted font-semibold">
            <span>AVAILABLE SPINS</span>
            <Disc3 className="w-4 h-4 text-primary" />
          </div>
          <div className="font-heading text-2xl font-bold text-primary mt-1">{totals.availableSpins}</div>
          <div className="text-[11px] font-mono text-muted mt-0.5">Ready to spin on floor</div>
        </div>
      </div>

      {/* Action Bar / Search */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            placeholder="Search by closer name or CLS code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-surface border border-white/10 text-xs text-white placeholder-muted focus:outline-none focus:border-primary/50"
          />
        </div>
        <span className="text-xs text-text-muted">
          Showing {filtered.length} of {agents.length} closers
        </span>
      </div>

      {/* Agents Table */}
      <div className="rounded-3xl border border-white/10 bg-[#0D1426]/90 overflow-hidden backdrop-blur-md">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/5 bg-surface/40 font-mono text-[11px] uppercase text-muted">
              <tr>
                <th className="py-3 px-4">Closer</th>
                <th className="py-3 px-4">Closer Code</th>
                <th className="py-3 px-4 text-center">Validated Sales</th>
                <th className="py-3 px-4 text-center">Spins Available</th>
                <th className="py-3 px-4 text-center">Earned (Auto / Manual)</th>
                <th className="py-3 px-4 text-center">Auto-Spins</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading && agents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted">
                    Loading authoritative agents from PostgreSQL database...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted">
                    {search ? `No closers match "${search}".` : "No agents recorded in the database yet."}
                  </td>
                </tr>
              ) : (
                filtered.map((a) => (
                  <tr key={a.user_code} className="hover:bg-white/5 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/20 border border-primary/30 font-heading text-xs font-bold text-white">
                          {a.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-heading font-bold text-white">{a.name}</div>
                          <div className="text-[10px] text-muted">Final Expense Closer</div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <span className="font-mono text-secondary font-semibold">{a.user_code}</span>
                    </td>

                    <td className="py-3 px-4 text-center">
                      <span className="font-heading font-bold text-white">{a.validated_sales}</span>
                    </td>

                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold font-mono ${
                          a.available > 0
                            ? "bg-primary/20 text-primary border border-primary/40"
                            : "text-muted"
                        }`}
                      >
                        {a.available} ready
                      </span>
                    </td>

                    <td className="py-3 px-4 text-center text-text-muted font-mono">
                      <span className="text-emerald-400">{a.auto_earned}</span>
                      <span className="mx-1">/</span>
                      <span className="text-secondary">{a.manual_earned}</span>
                    </td>

                    <td className="py-3 px-4 text-center">
                      <button
                        onClick={() => toggleEligibility(a)}
                        disabled={togglingCode === a.user_code}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all ${
                          a.spin_eligible
                            ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20"
                            : "border-white/10 bg-white/5 text-text-muted hover:text-white"
                        }`}
                        title={a.spin_eligible ? "Click to disable automatic spins" : "Click to enable automatic spins"}
                      >
                        {a.spin_eligible ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Eligible</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Paused</span>
                          </>
                        )}
                      </button>
                    </td>

                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => {
                          setAllocatingAgent(a);
                          setAllocQty(1);
                          setAllocReason("Floor milestone bonus");
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-secondary/30 bg-secondary/10 hover:bg-secondary/20 text-secondary text-xs font-semibold transition-colors"
                        title="Allocate manual spin to this closer"
                      >
                        <Gift className="w-3.5 h-3.5" />
                        <span>Allocate Spin</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manual Spin Allocation Modal */}
      {allocatingAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#0D1426] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-4">
              <div>
                <h3 className="font-heading font-bold text-lg text-white">Allocate Spin Credits</h3>
                <p className="text-xs text-text-muted mt-0.5">
                  Grant manual spins to <span className="text-white font-semibold">{allocatingAgent.name}</span> ({allocatingAgent.user_code})
                </p>
              </div>
              <button
                onClick={() => setAllocatingAgent(null)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-muted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAllocate} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted block mb-1">
                  Number of Spins to Grant
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  required
                  value={allocQty}
                  onChange={(e) => setAllocQty(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm font-mono text-white focus:outline-none focus:border-primary/50"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-muted block mb-1">
                  Reason / Audit Note (required, min 3 chars)
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  maxLength={120}
                  placeholder="e.g. Daily top closer bonus, Friday push celebration"
                  value={allocReason}
                  onChange={(e) => setAllocReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm text-white focus:outline-none focus:border-primary/50"
                />
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-text-muted space-y-1 font-mono">
                <div className="flex justify-between">
                  <span>Current balance:</span>
                  <span className="text-white font-bold">{allocatingAgent.available}</span>
                </div>
                <div className="flex justify-between">
                  <span>Balance after grant:</span>
                  <span className="text-primary font-bold">{allocatingAgent.available + allocQty}</span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setAllocatingAgent(null)}
                  disabled={allocating}
                  className="px-4 py-2 rounded-xl bg-surface hover:bg-surface-hover text-xs font-semibold text-muted hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={allocating || allocQty < 1 || allocReason.trim().length < 3}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-primary hover:bg-primary-hover font-heading text-xs font-bold text-white shadow-lg shadow-primary/25 disabled:opacity-50"
                >
                  <Gift className="w-3.5 h-3.5" />
                  <span>{allocating ? "Granting..." : `Grant ${allocQty} Spin${allocQty > 1 ? "s" : ""}`}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
