"use client";

import { useSettingsStore } from "@/store/settings-store";
import { Section, Toggle } from "@/components/admin/ui";

import { useState } from "react";
import { useArenaStore } from "@/store/arena-store";
import type { TargetRule } from "@/types";
import { Target, Plus, Edit2, Trash2, CheckCircle2, Calculator, X } from "lucide-react";
import { previewRule } from "@/features/targets/eligibility";

export default function AdminTargetsPage() {
  const store = useArenaStore();
  const [editingRule, setEditingRule] = useState<TargetRule | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Form states
  const [formTeamId, setFormTeamId] = useState<string>("default");
  const [formSalesPerSpin, setFormSalesPerSpin] = useState<number>(3);
  const [formPeriod, setFormPeriod] = useState<"daily" | "weekly">("daily");
  const [formTeamTarget, setFormTeamTarget] = useState<number>(100);
  const [formAgentTarget, setFormAgentTarget] = useState<number>(8);
  const [formEnabled, setFormEnabled] = useState(true);

  // Live Rule Calculator Preview state
  const [calcSales, setCalcSales] = useState<number>(9);

  const openEdit = (rule: TargetRule) => {
    setEditingRule(rule);
    setFormTeamId(rule.teamId || "default");
    setFormSalesPerSpin(rule.salesPerSpin);
    setFormPeriod(rule.period);
    setFormTeamTarget(rule.teamDailyTarget);
    setFormAgentTarget(rule.agentDailyTarget);
    setFormEnabled(rule.enabled);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const teamIdVal = formTeamId === "default" ? null : formTeamId;

    if (editingRule) {
      store.upsertTargetRule({
        id: editingRule.id,
        teamId: teamIdVal,
        salesPerSpin: formSalesPerSpin,
        period: formPeriod,
        teamDailyTarget: formTeamTarget,
        agentDailyTarget: formAgentTarget,
        enabled: formEnabled,
      });
      setEditingRule(null);
    } else {
      store.upsertTargetRule({
        teamId: teamIdVal,
        salesPerSpin: formSalesPerSpin,
        period: formPeriod,
        teamDailyTarget: formTeamTarget,
        agentDailyTarget: formAgentTarget,
        enabled: formEnabled,
      });
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <SpinFeatureSwitch />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-heading text-xl font-bold text-white">Target & Eligibility Rules</h2>
          <p className="text-xs text-muted">Configure how approved sales convert into 3D Spin wheel credits</p>
        </div>

        <button
          onClick={() => {
            setEditingRule(null);
            setFormTeamId("default");
            setFormSalesPerSpin(3);
            setFormPeriod("daily");
            setFormTeamTarget(100);
            setFormAgentTarget(8);
            setFormEnabled(true);
            setIsCreating(true);
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover font-heading text-xs font-bold text-white shadow-lg shadow-primary/25 transition-all"
        >
          <Plus className="w-4 h-4" />
          <span>New Target Rule</span>
        </button>
      </div>

      {/* Interactive Rule Eligibility Calculator */}
      <div className="rounded-2xl border border-secondary/25 bg-gradient-to-r from-[#121C32] via-[#0D1426] to-[#121C32] p-5 backdrop-blur-md">
        <div className="flex items-center gap-2 mb-3">
          <Calculator className="w-4 h-4 text-secondary" />
          <h4 className="font-heading font-bold text-sm text-white">
            Live Eligibility Simulator
          </h4>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-muted">Simulate Agent Sales:</span>
            <input
              type="number"
              min={0}
              max={50}
              value={calcSales}
              onChange={(e) => setCalcSales(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-16 px-2.5 py-1 rounded-lg bg-surface border border-white/10 text-white font-mono text-center font-bold"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-muted">Default Rule (3 sales/spin):</span>
            <span className="px-2 py-0.5 rounded-md bg-gold/20 text-gold font-mono font-bold">
              {Math.floor(calcSales / 3)} spin credit(s)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-muted">Titans Override (4 sales/spin):</span>
            <span className="px-2 py-0.5 rounded-md bg-primary/20 text-primary font-mono font-bold">
              {Math.floor(calcSales / 4)} spin credit(s)
            </span>
          </div>
        </div>
      </div>

      {/* Target Rules Table */}
      <div className="rounded-3xl border border-white/10 bg-[#0D1426]/90 overflow-hidden backdrop-blur-md">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/5 bg-surface/40 font-mono text-[11px] uppercase text-muted">
              <tr>
                <th className="py-3 px-4">Rule Target Scope</th>
                <th className="py-3 px-4">Sales Per Spin</th>
                <th className="py-3 px-4">Cadence Period</th>
                <th className="py-3 px-4">Daily Targets</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {store.targetRules.map((r) => {
                const team = r.teamId ? store.teams.find((t) => t.id === r.teamId) : null;

                return (
                  <tr key={r.id} className="hover:bg-white/5 transition-colors">
                    <td className="py-3 px-4">
                      <span className="font-heading font-bold text-white block">
                        {team ? `Team ${team.name}` : "Global Floor Default"}
                      </span>
                      <span className="text-[10px] font-mono text-muted">
                        {team ? `Applies only to ${team.name}` : "Applies to all unassigned teams"}
                      </span>
                    </td>

                    <td className="py-3 px-4">
                      <span className="font-mono font-bold text-gold text-sm">
                        {r.salesPerSpin}
                      </span>
                      <span className="text-muted text-[10px] ml-1">sales / spin</span>
                    </td>

                    <td className="py-3 px-4 font-mono uppercase text-secondary">
                      {r.period}
                    </td>

                    <td className="py-3 px-4 text-muted">
                      <div>Team: {r.teamDailyTarget}</div>
                      <div>Agent: {r.agentDailyTarget}</div>
                    </td>

                    <td className="py-3 px-4">
                      {r.enabled ? (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold text-[10px]">
                          ACTIVE
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 font-semibold text-[10px]">
                          DISABLED
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(r)}
                          title="Edit rule"
                          aria-label="Edit rule"
                          className="p-1.5 rounded-lg bg-surface hover:bg-surface-hover text-muted hover:text-white transition-colors"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        {r.teamId !== null && (
                          <button
                            onClick={() => store.deleteTargetRule(r.id)}
                            className="p-1.5 rounded-lg bg-surface hover:bg-rose-500/20 text-muted hover:text-rose-400 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit / Create Modal */}
      {(isCreating || editingRule) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#0D1426] p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-4">
              <h3 className="font-heading font-bold text-lg text-white">
                {editingRule ? "Edit Target Rule" : "Create Target Rule"}
              </h3>
              <button
                onClick={() => {
                  setEditingRule(null);
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
                  Team Scope
                </label>
                <select
                  value={formTeamId}
                  onChange={(e) => setFormTeamId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm text-white focus:outline-none cursor-pointer"
                >
                  <option value="default" className="bg-elevated">Global Floor Default</option>
                  {store.teams.map((t) => (
                    <option key={t.id} value={t.id} className="bg-elevated">
                      Team {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted block mb-1">
                  Validated Sales Required per 1 Spin
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  required
                  value={formSalesPerSpin}
                  onChange={(e) => setFormSalesPerSpin(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm text-white font-mono focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-muted block mb-1">
                  Target Reset Cadence
                </label>
                <select
                  value={formPeriod}
                  onChange={(e) => setFormPeriod(e.target.value as "daily" | "weekly")}
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm text-white focus:outline-none cursor-pointer"
                >
                  <option value="daily" className="bg-elevated">Daily (Reset every midnight)</option>
                  <option value="weekly" className="bg-elevated">Weekly (Rolling 7-day period)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted block mb-1">
                    Team Target
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={formTeamTarget}
                    onChange={(e) => setFormTeamTarget(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm text-white font-mono focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted block mb-1">
                    Agent Target
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={formAgentTarget}
                    onChange={(e) => setFormAgentTarget(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-3 py-2 rounded-xl bg-surface border border-white/10 text-sm text-white font-mono focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <input
                  type="checkbox"
                  id="ruleEnabledToggle"
                  checked={formEnabled}
                  onChange={(e) => setFormEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-white/10 bg-surface accent-primary cursor-pointer"
                />
                <label htmlFor="ruleEnabledToggle" className="text-xs font-semibold text-white cursor-pointer">
                  Rule Active
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => {
                    setEditingRule(null);
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
                  Save Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function SpinFeatureSwitch() {
  const enabled = useSettingsStore((s) => s.spinFeatureEnabled);
  const update = useSettingsStore((s) => s.update);
  return (
    <Section title="Spin feature" description="Approved sales earn spins using the rules below (per team, or the default rule). Changes apply to the Live Arena immediately.">
      <Toggle label="Spin rewards enabled" checked={enabled} onChange={(v) => update({ spinFeatureEnabled: v })} />
    </Section>
  );
}
