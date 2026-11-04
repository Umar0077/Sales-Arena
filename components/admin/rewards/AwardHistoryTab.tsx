"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi } from "@/components/admin/admin-api";
import { Notice, Table, td, fmtDate } from "@/components/admin/spins/shared";
import { Section, Choice } from "@/components/admin/ui";
import { useAdminSync } from "@/components/admin/AdminLiveSync";
import { rewardText } from "./ProgramsTab";
import { RecoveryPanel } from "./RecoveryPanel";

type Status = "earned" | "pending_approval" | "approved" | "paid" | "reversed" | "cancelled";
interface Award {
  id: string;
  programName: string;
  kind: string;
  rewardType: "cash" | "physical" | "voucher" | "badge" | "time_off" | "custom";
  agentName: string;
  userCode: string;
  periodKey: string;
  n: number;
  validatedAtAward: number;
  salesRequired: number;
  amount: number;
  currency: string;
  prizeLabel: string;
  status: Status;
  statusNote: string | null;
  statusChangedAt: string | null;
  statusChangedBy: string | null;
  triggerCaseId: string | null;
  source: "automatic" | "recovery";
  recoveryReason: string | null;
  recoveredBy: string | null;
  recoveredAt: string | null;
  createdAt: string;
  tierPolicy: "highest_tier" | "additive";
  effective: boolean;
  supersededBy: string | null;
  supersededByName: string | null;
  supersededAt: string | null;
  supersedesId: string | null;
  previousAmount: number;
  incrementAmount: number;
  payableAmount: number;
}
interface Totals {
  count: number;
  cash: number;
  paid: number;
  outstanding: number;
  superseded: number;
}

const STATUS_LABEL: Record<Status, string> = {
  earned: "Earned",
  pending_approval: "Pending approval",
  approved: "Approved",
  paid: "Fulfilled / paid",
  reversed: "Reversed",
  cancelled: "Cancelled",
};
const NEXT: Record<Status, Status[]> = {
  earned: ["pending_approval", "approved", "cancelled"],
  pending_approval: ["approved", "cancelled"],
  approved: ["paid", "cancelled"],
  paid: ["reversed"],
  reversed: [],
  cancelled: [],
};

/** Award History: every award in PostgreSQL. Earned ≠ paid: payment is a separate, audited step. */
export function AwardHistoryTab() {
  const awardsRev = useAdminSync((s) => s.awardsRev);
  const [kind, setKind] = useState<"all" | "daily" | "weekly" | "monthly">("all");
  const [status, setStatus] = useState<"all" | Status>("all");
  const [audience, setAudience] = useState<"all" | "senior" | "junior">("all");
  const [data, setData] = useState<{ awards: Award[]; totals: Totals } | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const q = new URLSearchParams({ limit: "300" });
    if (kind !== "all") q.set("kind", kind);
    if (status !== "all") q.set("status", status);
    if (audience !== "all") q.set("audience", audience);
    const r = await adminApi<{ awards: Award[]; totals: Totals }>(`/api/admin/awards?${q}`);
    if (r.ok) setData(r.data);
    else setMsg({ kind: "error", text: r.error });
  }, [kind, status, audience]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, awardsRev]);

  const change = async (a: Award, to: Status) => {
    let note: string | null = "";
    if (to === "cancelled" || to === "reversed") {
      note = prompt(`Reason for marking this award ${STATUS_LABEL[to].toLowerCase()}:`);
      if (!note?.trim()) return;
    }
    setBusy(a.id);
    const r = await adminApi<{ award: Award }>(`/api/admin/awards/${encodeURIComponent(a.id)}`, { method: "PATCH", body: { status: to, note } });
    setBusy(null);
    if (!r.ok) return setMsg({ kind: "error", text: r.error });
    setData((d) => (d ? { ...d, awards: d.awards.map((x) => (x.id === a.id ? r.data.award : x)) } : d));
    setMsg({ kind: "ok", text: `${a.agentName}: ${a.programName} → ${STATUS_LABEL[to]}.` });
  };

  return (
    <Section
      title="Award history"
      description="Every award earned from genuine validated sales, stored in PostgreSQL with the rule as it was at the time. Highest-tier programs: reaching a higher milestone supersedes the previous tier (kept here for history), so only the current tier counts and the upgrade owes only the difference. Earned is not paid until an admin marks it paid."
    >
      <div className="flex flex-wrap gap-4">
        <Choice label="Bonuses" value={audience} options={[{ value: "all", label: "All" }, { value: "senior", label: "Senior" }, { value: "junior", label: "Junior" }]} onChange={setAudience} />
        <Choice label="Category" value={kind} options={[{ value: "all", label: "All" }, { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }]} onChange={setKind} />
        <Choice
          label="Status"
          value={status}
          options={[{ value: "all", label: "All" }, ...(Object.keys(STATUS_LABEL) as Status[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))]}
          onChange={setStatus}
        />
      </div>
      <RecoveryPanel onCreated={() => void load()} />
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {data && (
        <p className="text-sm text-text-secondary">
          {data.totals.count} award record{data.totals.count === 1 ? "" : "s"}{data.totals.superseded ? ` (${data.totals.superseded} superseded by a higher tier)` : ""} · effective cash entitlement{" "}
          <b className="text-white" data-testid="totals-effective">{data.totals.cash.toLocaleString("en-US")}</b> · paid <b className="text-white">{data.totals.paid.toLocaleString("en-US")}</b> · outstanding{" "}
          <b className="text-gold" data-testid="totals-outstanding">{data.totals.outstanding.toLocaleString("en-US")}</b>
        </p>
      )}
      <Table head={["Agent", "Program", "Period", "Qualified with", "Reward", "Source", "Status", "When", "Action"]} empty={!!data && data.awards.length === 0} testId="award-history">
        {(data?.awards ?? []).map((a) => (
          <tr key={a.id} data-testid="award-row" data-effective={a.effective} className={a.supersededBy ? "opacity-60" : undefined}>
            <td className={`${td} font-medium text-white`}>
              {a.agentName}
              <div className="text-xs text-text-muted">{a.userCode}</div>
            </td>
            <td className={`${td} text-text-secondary`}>
              {a.programName}
              <div className="text-xs capitalize text-text-muted">{a.kind}</div>
            </td>
            <td className={`${td} tabular text-text-muted`}>{a.periodKey} · #{a.n}</td>
            <td className={`${td} text-text-muted`}>
              {a.validatedAtAward} validated (rule {a.salesRequired})
              {a.triggerCaseId && <div className="font-mono text-[10px]" title="Sale that reached the milestone">{a.triggerCaseId}</div>}
            </td>
            <td className={td} data-testid="award-amount">
              <span className={a.supersededBy ? "font-semibold text-text-muted line-through" : "font-semibold text-gold"}>{rewardText(a)}</span>
              {a.supersedesId && a.rewardType === "cash" && (
                <div className="text-[11px] text-emerald-300">
                  Upgrade: +{a.currency} {a.incrementAmount.toLocaleString("en-US")} (was {a.currency} {a.previousAmount.toLocaleString("en-US")})
                </div>
              )}
              {a.supersededBy && <div className="text-[11px] text-text-muted">Superseded by {a.supersededByName ?? "a higher tier"}{a.supersededAt ? ` · ${fmtDate(a.supersededAt)}` : ""}</div>}
              {a.rewardType === "cash" && a.status !== "paid" && !a.supersededBy && a.payableAmount !== a.amount && (
                <div className="text-[11px] text-text-muted">Payable now: {a.currency} {a.payableAmount.toLocaleString("en-US")}</div>
              )}
            </td>
            <td className={td} data-testid="award-source">
              {a.source === "recovery" ? <span className="text-amber-200">Owner recovery</span> : a.recoveredBy ? <span className="text-sky-300">Automatic (Owner catch-up)</span> : <span className="text-text-secondary">Automatic</span>}
              {a.recoveredBy && <div className="text-[10px] text-text-muted">by {a.recoveredBy}{a.recoveredAt ? ` · ${fmtDate(a.recoveredAt)}` : ""}</div>}
              {a.recoveryReason && <div className="max-w-[14rem] truncate text-[10px] text-text-muted" title={a.recoveryReason}>“{a.recoveryReason}”</div>}
            </td>
            <td className={td}>
              <span className="text-text-secondary" data-testid="award-status">{STATUS_LABEL[a.status]}</span>
              {a.statusChangedAt && <div className="text-xs text-text-muted">{fmtDate(a.statusChangedAt)}{a.statusChangedBy ? ` · ${a.statusChangedBy}` : ""}</div>}
              {a.statusNote && <div className="text-xs text-text-muted">“{a.statusNote}”</div>}
            </td>
            <td className={`${td} text-text-muted`}>{fmtDate(a.createdAt)}</td>
            <td className={td}>
              {a.supersededBy ? (
                <span className="text-xs text-text-muted" title="Manage the current (highest) tier instead">Superseded</span>
              ) : NEXT[a.status].length > 0 ? (
                <select
                  aria-label="Change award status"
                  value=""
                  disabled={busy === a.id}
                  onChange={(e) => e.target.value && void change(a, e.target.value as Status)}
                  className="rounded-lg border border-white/10 bg-[#070B16] px-2 py-1 text-xs text-white"
                >
                  <option value="">Change…</option>
                  {NEXT[a.status].map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              ) : (
                <span className="text-xs text-text-muted">Final</span>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {!data && <p className="text-sm text-text-muted">Loading from PostgreSQL…</p>}
    </Section>
  );
}
