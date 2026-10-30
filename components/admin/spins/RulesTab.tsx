"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi } from "@/components/admin/admin-api";
import { Section, Field, Toggle, Choice, SelectField, PrimaryButton, GhostButton, inputClass } from "@/components/admin/ui";
import { fmtDate, Notice, Table, td, toLocalInput } from "./shared";

interface Rule {
  id: string;
  scope_type: "global" | "team" | "campaign";
  scope_id: string | null;
  sales_per_spin: number;
  spins_per_threshold: number;
  period: string;
  enabled: boolean;
  effective_from: string;
  superseded_at: string | null;
  change_note: string | null;
  created_by_email: string | null;
}
interface Overview {
  settings: { autoEnabled: boolean; activationCutoff: string | null; manualMaxPerGrant: number };
  timezone: string;
  rules: Rule[];
  teams: Array<{ id: string; name: string }>;
  campaigns: Array<{ id: string; name: string }>;
  totals: { automatic: number; manual: number; consumed: number; available: number };
}

const PERIOD_LABEL: Record<string, string> = { daily: "per business day", weekly: "per week", monthly: "per month", lifetime: "in total" };

export function RulesTab() {
  const [data, setData] = useState<Overview | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [form, setForm] = useState({ scopeType: "global", scopeId: "", salesPerSpin: 2, spinsPerThreshold: 1, period: "daily", enabled: true, when: "now", at: "", note: "" });
  const [cutoffAt, setCutoffAt] = useState("");
  const [maxGrant, setMaxGrant] = useState(50);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await adminApi<Overview & { ok: true }>("/api/admin/spins/overview");
    if (r.ok) {
      setData(r.data);
      setMaxGrant(r.data.settings.manualMaxPerGrant);
    } else setMsg({ kind: "error", text: r.error });
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const saveSettings = async (patch: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const r = await adminApi("/api/admin/spins/settings", { method: "POST", body: patch });
    setBusy(false);
    setMsg(r.ok ? { kind: "ok", text: ok } : { kind: "error", text: r.error });
    if (r.ok) void load();
  };

  const createRule = async () => {
    setBusy(true);
    const r = await adminApi("/api/admin/spins/rules", {
      method: "POST",
      body: {
        scopeType: form.scopeType,
        scopeId: form.scopeType === "global" ? null : form.scopeId,
        salesPerSpin: Number(form.salesPerSpin),
        spinsPerThreshold: Number(form.spinsPerThreshold),
        period: form.period,
        enabled: form.enabled,
        effectiveFrom: form.when === "now" ? "now" : new Date(form.at).toISOString(),
        note: form.note,
      },
    });
    setBusy(false);
    setMsg(r.ok ? { kind: "ok", text: "New rule version saved. Earlier sales are not re-counted." } : { kind: "error", text: r.error });
    if (r.ok) {
      setForm((f) => ({ ...f, note: "" }));
      void load();
    }
  };

  if (!data) return msg ? <Notice kind="error">{msg.text}</Notice> : <p className="text-sm text-text-muted">Loading…</p>;
  const s = data.settings;
  const current = data.rules.filter((r) => !r.superseded_at);
  const scopeName = (r: Rule) =>
    r.scope_type === "global"
      ? "Everyone (global)"
      : `${r.scope_type === "team" ? "Team" : "Campaign"}: ${(r.scope_type === "team" ? data.teams : data.campaigns).find((x) => x.id === r.scope_id)?.name ?? r.scope_id}`;

  return (
    <div className="space-y-6">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Automatic spins granted", data.totals.automatic],
          ["Manual spins granted", data.totals.manual],
          ["Spins used", data.totals.consumed],
          ["Spins available now", data.totals.available],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-xl border border-white/[0.07] bg-[#0B1122]/80 px-4 py-3">
            <div className="text-xs text-text-muted">{k}</div>
            <div className="mt-1 font-heading text-2xl font-bold text-white tabular">{v}</div>
          </div>
        ))}
      </div>

      <Section title="Automatic spins" description={`Spins are granted on the server from validated sales only. Business timezone: ${data.timezone}.`}>
        <Toggle label="Automatic spins enabled" checked={s.autoEnabled} onChange={(v) => saveSettings({ autoSpinsEnabled: v }, v ? "Automatic spins enabled." : "Automatic spins disabled.")} />
        <Field label="Reward activation cutoff" hint="Only sales validated at or after this moment can earn automatic spins or bonuses. Imported history never does.">
          <div className="space-y-2">
            <p className="text-sm text-white" data-testid="activation-cutoff">
              {s.activationCutoff ? `Active since ${fmtDate(s.activationCutoff)}` : "Not set — automatic rewards are OFF until you set it."}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <GhostButton disabled={busy} onClick={() => saveSettings({ activationCutoff: "now" }, "Automatic rewards start from now.")} data-testid="cutoff-now">
                Start rewards from now
              </GhostButton>
              <input type="datetime-local" value={cutoffAt} min={toLocalInput(new Date())} onChange={(e) => setCutoffAt(e.target.value)} className={`${inputClass} max-w-[220px]`} aria-label="Cutoff date and time" />
              <GhostButton disabled={busy || !cutoffAt} onClick={() => saveSettings({ activationCutoff: new Date(cutoffAt).toISOString() }, "Activation cutoff scheduled.")}>
                Schedule
              </GhostButton>
              {s.activationCutoff && (
                <GhostButton disabled={busy} onClick={() => saveSettings({ activationCutoff: null }, "Automatic rewards turned off (cutoff cleared).")}>
                  Clear
                </GhostButton>
              )}
            </div>
          </div>
        </Field>
        <Field label="Manual grant limit" hint="Most spins one manual allocation may grant.">
          <div className="flex items-center gap-2">
            <input type="number" min={1} max={1000} value={maxGrant} onChange={(e) => setMaxGrant(Number(e.target.value))} className={`${inputClass} w-28`} />
            <GhostButton disabled={busy || maxGrant === s.manualMaxPerGrant} onClick={() => saveSettings({ manualMaxPerGrant: maxGrant }, "Manual grant limit saved.")}>Save</GhostButton>
          </div>
        </Field>
      </Section>

      <Section title="Current rules" description="The most specific rule applies: team, then campaign, then global.">
        <Table head={["Scope", "Rule", "Status", "Effective from"]} empty={!current.length} testId="current-rules">
          {current.map((r) => (
            <tr key={r.id}>
              <td className={td}>{scopeName(r)}</td>
              <td className={`${td} text-white`}>
                {r.sales_per_spin} validated sale{r.sales_per_spin > 1 ? "s" : ""} = {r.spins_per_threshold} spin{r.spins_per_threshold > 1 ? "s" : ""} {PERIOD_LABEL[r.period]}
              </td>
              <td className={td}>{r.enabled ? <span className="text-emerald-300">Active</span> : <span className="text-text-muted">Disabled</span>}</td>
              <td className={td}>{fmtDate(r.effective_from)}</td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="New rule version" description="Saving creates a new version from its effective time. The previous version stays in the history; past grants are never changed or repeated.">
        <Choice
          label="Applies to"
          value={form.scopeType}
          options={[{ value: "global", label: "Everyone" }, { value: "team", label: "A team" }, { value: "campaign", label: "A campaign" }]}
          onChange={(v) => setForm({ ...form, scopeType: v, scopeId: "" })}
        />
        {form.scopeType !== "global" && (
          <SelectField
            label={form.scopeType === "team" ? "Team" : "Campaign"}
            value={form.scopeId}
            options={[{ value: "", label: "Choose…" }, ...(form.scopeType === "team" ? data.teams : data.campaigns).map((x) => ({ value: x.id, label: x.name }))]}
            onChange={(v) => setForm({ ...form, scopeId: v })}
          />
        )}
        <Field label="Validated sales required" hint="Per threshold, e.g. 2 = every 2 validated sales.">
          <input type="number" min={1} max={1000} value={form.salesPerSpin} onChange={(e) => setForm({ ...form, salesPerSpin: Number(e.target.value) })} className={`${inputClass} w-28`} data-testid="rule-sales" />
        </Field>
        <Field label="Spins per threshold">
          <input type="number" min={1} max={100} value={form.spinsPerThreshold} onChange={(e) => setForm({ ...form, spinsPerThreshold: Number(e.target.value) })} className={`${inputClass} w-28`} data-testid="rule-spins" />
        </Field>
        <Choice
          label="Counting period"
          value={form.period}
          options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }, { value: "lifetime", label: "No reset" }]}
          onChange={(v) => setForm({ ...form, period: v })}
        />
        <Toggle label="Rule enabled" checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} />
        <Field label="Effective from">
          <div className="flex flex-wrap items-center gap-2">
            <Choice label="" value={form.when} options={[{ value: "now", label: "Now" }, { value: "at", label: "Scheduled" }]} onChange={(v) => setForm({ ...form, when: v })} />
            {form.when === "at" && (
              <input type="datetime-local" min={toLocalInput(new Date())} value={form.at} onChange={(e) => setForm({ ...form, at: e.target.value })} className={`${inputClass} max-w-[220px]`} aria-label="Effective date and time" />
            )}
          </div>
        </Field>
        <Field label="Change note" hint="Why this change? Saved in the history.">
          <input value={form.note} maxLength={500} onChange={(e) => setForm({ ...form, note: e.target.value })} className={inputClass} />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm text-white">
          <span data-testid="rule-preview">
            Preview: every <b>{form.salesPerSpin}</b> validated sale{form.salesPerSpin > 1 ? "s" : ""} → <b>{form.spinsPerThreshold}</b> spin
            {form.spinsPerThreshold > 1 ? "s" : ""} {PERIOD_LABEL[form.period]}
            {form.enabled ? "" : " (disabled)"}, from {form.when === "now" ? "now" : form.at ? fmtDate(new Date(form.at).toISOString()) : "—"}.
          </span>
          <PrimaryButton disabled={busy || (form.when === "at" && !form.at) || (form.scopeType !== "global" && !form.scopeId)} onClick={createRule} data-testid="rule-save">
            Save new version
          </PrimaryButton>
        </div>
      </Section>

      <Section title="Rule history">
        <Table head={["Effective from", "Until", "Scope", "Rule", "Enabled", "By", "Note"]} empty={!data.rules.length}>
          {data.rules.map((r) => (
            <tr key={r.id}>
              <td className={td}>{fmtDate(r.effective_from)}</td>
              <td className={td}>{r.superseded_at ? fmtDate(r.superseded_at) : <span className="text-emerald-300">current</span>}</td>
              <td className={td}>{scopeName(r)}</td>
              <td className={td}>{r.sales_per_spin} → {r.spins_per_threshold} ({r.period})</td>
              <td className={td}>{r.enabled ? "Yes" : "No"}</td>
              <td className={td}>{r.created_by_email ?? "system"}</td>
              <td className={`${td} text-text-muted`}>{r.change_note ?? ""}</td>
            </tr>
          ))}
        </Table>
      </Section>
    </div>
  );
}
