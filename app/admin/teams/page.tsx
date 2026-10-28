"use client";

import { useState } from "react";
import { useArenaStore } from "@/store/arena-store";
import type { Team } from "@/types";
import { Shield, Plus, Edit2, Users, X, CheckCircle2 } from "lucide-react";

export default function AdminTeamsPage() {
  const store = useArenaStore();
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form states
  const [formName, setFormName] = useState("");
  const [formColor, setFormColor] = useState("#7568FF");
  const [formLead, setFormLead] = useState("");
  const [formCampaignId, setFormCampaignId] = useState("");

  const openCreate = () => {
    setFormName("");
    setFormColor("#7568FF");
    setFormLead("");
    setFormCampaignId(store.campaigns[0]?.id || "cmp_fiber");
    setIsCreating(true);
  };

  const openEdit = (team: Team) => {
    setEditingTeam(team);
    setFormName(team.name);
    setFormColor(team.color);
    setFormLead(team.leadName);
    setFormCampaignId(team.campaignId);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;

    if (editingTeam) {
      store.upsertTeam({
        id: editingTeam.id,
        name: formName.trim(),
        color: formColor,
        leadName: formLead.trim() || "Lead",
        campaignId: formCampaignId,
        active: true,
      });
      setEditingTeam(null);
    } else {
      store.upsertTeam({
        name: formName.trim(),
        color: formColor,
        leadName: formLead.trim() || "Lead",
        campaignId: formCampaignId,
        active: true,
      });
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-xl font-bold text-white">Campaign Teams</h2>
          <p className="text-xs text-muted">Manage active calling floor squads</p>
        </div>

        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover font-heading text-xs font-bold text-white shadow-lg shadow-primary/25 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>Add Team</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {store.teams.map((team) => {
          const members = store.agents.filter((a) => a.teamId === team.id);
          const approved = store.sales.filter((s) => s.teamId === team.id && s.status === "approved").length;

          return (
            <div
              key={team.id}
              className="rounded-3xl border border-white/10 bg-[#0D1426]/90 p-6 backdrop-blur-md flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-4 h-4 rounded-full shadow-md"
                      style={{ backgroundColor: team.color }}
                    />
                    <h3 className="font-heading text-lg font-black text-white">
                      {team.name}
                    </h3>
                  </div>

                  <button
                    onClick={() => openEdit(team)}
                    className="p-1.5 rounded-lg bg-surface hover:bg-surface-hover text-muted hover:text-white transition-colors"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="space-y-2 text-xs text-muted">
                  <div className="flex justify-between">
                    <span>Team Lead:</span>
                    <span className="text-white font-semibold">{team.leadName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Roster:</span>
                    <span className="text-secondary font-mono">{members.length} agents</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Approved Sales:</span>
                    <span className="text-emerald-400 font-mono font-bold">{approved} today</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-3 border-t border-white/5 flex items-center justify-between text-[11px] font-mono text-muted">
                <span>ID: {team.id}</span>
                <span className="text-emerald-400 font-semibold">Active Squad</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal Dialog */}
      {(isCreating || editingTeam) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#0D1426] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-4">
              <h3 className="font-heading font-bold text-lg text-white">
                {editingTeam ? "Edit Team" : "Create New Team"}
              </h3>
              <button
                onClick={() => {
                  setEditingTeam(null);
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
                  Team Name
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Apex Predators"
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm text-white focus:outline-none focus:border-primary/50"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-muted block mb-1">
                  Team Lead Name
                </label>
                <input
                  type="text"
                  value={formLead}
                  onChange={(e) => setFormLead(e.target.value)}
                  placeholder="e.g. Elena Rostova"
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm text-white focus:outline-none focus:border-primary/50"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-muted block mb-1">
                  Squad Brand Color (Hex)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={formColor}
                    onChange={(e) => setFormColor(e.target.value)}
                    className="h-9 w-9 rounded-lg border-0 bg-transparent cursor-pointer"
                  />
                  <input
                    type="text"
                    value={formColor}
                    onChange={(e) => setFormColor(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm font-mono text-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => {
                    setEditingTeam(null);
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
                  Save Team
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
