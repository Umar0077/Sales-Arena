"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Users } from "lucide-react";
import { adminApi } from "@/components/admin/admin-api";
import { Section, PrimaryButton, inputClass } from "@/components/admin/ui";
import { Notice, Table, td } from "@/components/admin/spins/shared";
import { cn } from "@/lib/utils";

interface Preview {
  today: string;
  programs: Array<{ id: string; name: string; kind: string; salesRequired: number; amount: number; currency: string; enabled: boolean; rewardGroup: string; audience: string; proposedAudience: string; existingAwards: { awards: number; effectiveAmount: number } }>;
  impact: { seniors: Agent[]; juniorsWhoStopQualifying: Agent[]; undesignatedWhoStopQualifying: Agent[] };
  rules: string[];
}
interface Agent {
  userCode: string;
  name: string;
  designation: string | null;
  recentSales: number;
}

/**
 * Owner: move the pre-designation "all agents" programmes to Senior-only. Read-only preview first (which
 * programmes, who stops qualifying, existing awards that stay untouched), then an explicit, audited apply.
 */
export function AudienceReview() {
  const [pv, setPv] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await adminApi<Preview>("/api/admin/programs/audience");
    if (!r.ok) return setErr(r.status === 403 ? null : r.error); // non-owners simply do not see it
    setPv(r.data);
    setPick(new Set(r.data.programs.filter((p) => p.audience === "all").map((p) => p.id)));
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);
  if (err) return <Notice kind="error">{err}</Notice>;
  if (!pv) return null;
  const pending = pv.programs.filter((p) => p.audience === "all");
  if (!pending.length)
    return (
      <Notice kind="ok">
        <span data-testid="audience-done">Every programme has a Senior or Junior audience. Junior agents cannot earn Senior programmes.</span>
      </Notice>
    );
  const apply = async () => {
    setBusy(true);
    const r = await adminApi<{ changed: Array<{ name: string }> }>("/api/admin/programs/audience", { method: "POST", body: { confirm: true, programIds: [...pick], reason } });
    setBusy(false);
    setConfirm(false);
    setMsg(r.ok ? { kind: "ok", text: `${r.data.changed.length} programme(s) are now Senior-only. Existing awards are unchanged.` } : { kind: "error", text: r.error });
    if (r.ok) await load();
  };
  const people = (list: Agent[]) => (list.length ? list.map((a) => `${a.name}${a.recentSales ? ` (${a.recentSales} sales / 30 d)` : ""}`).join(", ") : "none");
  return (
    <Section
      title="Senior / Junior eligibility review (Owner)"
      description="These programmes were created before Senior / Junior designations, so every agent (Juniors included) can still earn them. Review the impact, then move them to Senior-only. Nothing changes until you apply."
    >
      <div data-testid="audience-review" className="space-y-4">
        <Table head={["", "Programme", "Period", "Tier", "Now", "After", "Existing awards (unchanged)"]} testId="audience-programs">
          {pending.map((p) => (
            <tr key={p.id}>
              <td className={td}>
                <input type="checkbox" checked={pick.has(p.id)} onChange={(e) => setPick((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} aria-label={`Move ${p.name} to Senior-only`} />
              </td>
              <td className={cn(td, "font-medium text-white")}>{p.name}{!p.enabled && <span className="ml-2 text-xs text-text-muted">(paused)</span>}</td>
              <td className={td}>{p.kind}</td>
              <td className={td}>{p.salesRequired} sales · {p.currency} {p.amount.toLocaleString("en-US")}</td>
              <td className={cn(td, "text-amber-200")}>All agents</td>
              <td className={cn(td, "text-secondary")}>Senior only</td>
              <td className={cn(td, "text-text-muted")}>{p.existingAwards.awards} award(s) · {p.currency} {p.existingAwards.effectiveAmount.toLocaleString("en-US")} effective</td>
            </tr>
          ))}
        </Table>
        <div className="grid gap-2 text-sm" data-testid="audience-impact">
          <p className="flex items-start gap-2 text-text-secondary"><Users className="mt-0.5 h-4 w-4 shrink-0 text-secondary" /><span><b className="text-white">Keep qualifying (Senior):</b> {people(pv.impact.seniors)}</span></p>
          <p className="text-amber-200"><b>Stop qualifying for these programmes (Junior):</b> {people(pv.impact.juniorsWhoStopQualifying)}</p>
          <p className="text-rose-300"><b>Stop qualifying (no designation yet, designate them first if needed):</b> {people(pv.impact.undesignatedWhoStopQualifying)}</p>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-xs text-text-muted">{pv.rules.map((r) => <li key={r}>{r}</li>)}</ul>
        <input className={cn(inputClass, "max-w-xl")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (recorded in the audit log)" maxLength={300} data-testid="audience-reason" />
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} data-testid="audience-confirm" /> I reviewed who stops qualifying. Existing awards stay as they are.
        </label>
        <PrimaryButton disabled={!confirm || busy || !pick.size || reason.trim().length < 5} onClick={() => void apply()} data-testid="audience-apply">
          <ShieldCheck className="h-4 w-4" /> Make {pick.size} programme(s) Senior-only
        </PrimaryButton>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      </div>
    </Section>
  );
}
