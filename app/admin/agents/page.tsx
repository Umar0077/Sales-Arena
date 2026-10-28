"use client";

import { useState, useMemo } from "react";
import { useArenaStore } from "@/store/arena-store";
import type { Agent } from "@/types";
import { 
  Users, 
  Search, 
  Plus, 
  Edit2, 
  Check, 
  X, 
  Filter, 
  CheckCircle2, 
  XCircle 
} from "lucide-react";

export default function AdminAgentsPage() {
  const store = useArenaStore();
  const [search, setSearch] = useState("");
  const [selectedTeam, setSelectedTeam] = useState("all");
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form states
  const [formName, setFormName] = useState("");
  const [formTeamId, setFormTeamId] = useState("");
  const [formTitle, setFormTitle] = useState("Sales Agent");
  const [formActive, setFormActive] = useState(true);

  const filteredAgents = useMemo(() => {
    return store.agents.filter((a) => {
      const matchSearch =
        a.name.toLowerCase().includes(search.toLowerCase()) ||
        a.title.toLowerCase().includes(search.toLowerCase());
      const matchTeam = selectedTeam === "all" || a.teamId === selectedTeam;
      return matchSearch && matchTeam;
    });
  }, [store.agents, search, selectedTeam]);

  const openCreate = () => {
    setFormName("");
    setFormTeamId(store.teams[0]?.id || "");
    setFormTitle("Sales Agent");
    setFormActive(true);
    setIsCreating(true);
  };

  const openEdit = (agent: Agent) => {
    setEditingAgent(agent);
    setFormName(agent.name);
    setFormTeamId(agent.teamId);
    setFormTitle(agent.title);
    setFormActive(agent.active);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;

    const team = store.teams.find((t) => t.id === formTeamId);

    if (editingAgent) {
      store.upsertAgent({
        id: editingAgent.id,
        name: formName.trim(),
        teamId: formTeamId,
        campaignId: team?.campaignId || "cmp_fiber",
        title: formTitle,
        active: formActive,
      });
      setEditingAgent(null);
    } else {
      store.upsertAgent({
        name: formName.trim(),
        teamId: formTeamId,
        campaignId: team?.campaignId || "cmp_fiber",
        title: formTitle,
        active: formActive,
      });
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Action Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
            <input
              type="text"
              placeholder="Search roster..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-surface border border-white/10 text-xs text-white placeholder-muted focus:outline-none focus:border-primary/50"
            />
          </div>

          <div className="flex items-center gap-1.5 bg-surface border border-white/10 rounded-xl px-3 py-2 text-xs text-muted">
            <Filter className="w-3.5 h-3.5" />
            <select
              value={selectedTeam}
              onChange={(e) => setSelectedTeam(e.target.value)}
              className="bg-transparent text-white font-semibold focus:outline-none cursor-pointer"
            >
              <option value="all" className="bg-elevated">All Teams</option>
              {store.teams.map((t) => (
                <option key={t.id} value={t.id} className="bg-elevated">
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={openCreate}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover font-heading text-xs font-bold text-white shadow-lg shadow-primary/25 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Add New Agent</span>
        </button>
      </div>

      {/* Agents Table */}
      <div className="rounded-3xl border border-white/10 bg-[#0D1426]/90 overflow-hidden backdrop-blur-md">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/5 bg-surface/40 font-mono text-[11px] uppercase text-muted">
              <tr>
                <th className="py-3 px-4">Agent Name</th>
                <th className="py-3 px-4">Team</th>
                <th className="py-3 px-4">Title</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredAgents.map((a) => {
                const team = store.teams.find((t) => t.id === a.teamId);
                return (
                  <tr key={a.id} className="hover:bg-white/5 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-heading text-xs font-bold text-white"
                          style={{ backgroundColor: team?.color || "#7568FF" }}
                        >
                          {a.initials}
                        </div>
                        <span className="font-heading font-bold text-white">
                          {a.name}
                        </span>
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <span
                        className="px-2.5 py-0.5 rounded-full text-xs font-medium"
                        style={{
                          backgroundColor: `${team?.color || "#7568FF"}20`,
                          color: team?.color || "#7568FF",
                        }}
                      >
                        {team?.name || "Unassigned"}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-muted">{a.title}</td>

                    <td className="py-3 px-4">
                      {a.active ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-muted">
                          <XCircle className="w-3.5 h-3.5" /> Inactive
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => openEdit(a)}
                        className="p-1.5 rounded-lg bg-surface hover:bg-surface-hover text-muted hover:text-white transition-colors"
                        title="Edit Agent"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Dialog: Add / Edit Agent */}
      {(isCreating || editingAgent) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#0D1426] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-4">
              <h3 className="font-heading font-bold text-lg text-white">
                {editingAgent ? "Edit Agent Details" : "Add New Agent"}
              </h3>
              <button
                onClick={() => {
                  setEditingAgent(null);
                  setIsCreating(false);
                }}
                className="p-1 rounded-lg hover:bg-white/10 text-muted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted block mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Jordan Hayes"
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm text-white focus:outline-none focus:border-primary/50"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-muted block mb-1">
                  Assigned Team
                </label>
                <select
                  value={formTeamId}
                  onChange={(e) => setFormTeamId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm text-white focus:outline-none cursor-pointer"
                >
                  {store.teams.map((t) => (
                    <option key={t.id} value={t.id} className="bg-elevated">
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted block mb-1">
                  Role Title
                </label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g. Senior Closer"
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm text-white focus:outline-none focus:border-primary/50"
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <input
                  type="checkbox"
                  id="activeToggle"
                  checked={formActive}
                  onChange={(e) => setFormActive(e.target.checked)}
                  className="h-4 w-4 rounded border-white/10 bg-surface accent-primary cursor-pointer"
                />
                <label htmlFor="activeToggle" className="text-xs font-semibold text-white cursor-pointer">
                  Active Floor Agent
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => {
                    setEditingAgent(null);
                    setIsCreating(false);
                  }}
                  className="px-4 py-2 rounded-xl bg-surface hover:bg-surface-hover text-xs font-semibold text-muted hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-primary hover:bg-primary-hover font-heading text-xs font-bold text-white shadow-lg shadow-primary/25"
                >
                  Save Agent
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
