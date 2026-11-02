"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi } from "@/components/admin/admin-api";
import { Notice, Table, td, fmtDate } from "@/components/admin/spins/shared";
import { Section, Choice } from "@/components/admin/ui";
import { useAdminSync } from "@/components/admin/AdminLiveSync";
import { rewardText } from "./ProgramsTab";

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
  createdAt: string;
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
  const [data, setData] = useState<{ awards: Award[]; totals: { count: number; cash: number } } | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const q = new URLSearchParams({ limit: "300" });
    if (kind !== "all") q.set("kind", kind);
    if (status !== "all") q.set("status", status);
    const r = await adminApi<{ awards: Award[]; totals: { count: number; cash: number } }>(`/api/admin/awards?${q}`);
    if (r.ok) setData(r.data);
    else setMsg({ kind: "error", text: r.error });
  }, [kind, status]);
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
      description="Every award earned from genuine validated sales, stored in PostgreSQL with the rule as it was at the time. Editing or archiving a program never changes past awards. A cash bonus that is earned is not paid until an admin marks it paid."
    >
      <div className="flex flex-wrap gap-4">
        <Choice label="Category" value={kind} options={[{ value: "all", label: "All" }, { value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }]} onChange={setKind} />
        <Choice
          label="Status"
          value={status}
          options={[{ value: "all", label: "All" }, ...(Object.keys(STATUS_LABEL) as Status[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))]}
          onChange={setStatus}
        />
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {data && (
        <p className="text-sm text-text-secondary">
          {data.totals.count} award{data.totals.count === 1 ? "" : "s"} · cash earned (excluding cancelled / reversed) <b className="text-white">{data.totals.cash.toLocaleString("en-US")}</b>
        </p>
      )}
      <Table head={["Agent", "Program", "Period", "Qualified with", "Reward", "Status", "When", "Action"]} empty={!!data && data.awards.length === 0} testId="award-history">
        {(data?.awards ?? []).map((a) => (
          <tr key={a.id} data-testid="award-row">
            <td className={`${td} font-medium text-white`}>
              {a.agentName}
              <div className="text-xs text-text-muted">{a.userCode}</div>
            </td>
            <td className={`${td} text-text-secondary`}>
              {a.programName}
              <div className="text-xs capitalize text-text-muted">{a.kind}</div>
            </td>
            <td className={`${td} tabular text-text-muted`}>{a.periodKey} · #{a.n}</td>
            <td className={`${td} text-text-muted`}>{a.validatedAtAward} validated (rule {a.salesRequired})</td>
            <td className={`${td} font-semibold text-gold`}>{rewardText(a)}</td>
            <td className={td}>
              <span className="text-text-secondary" data-testid="award-status">{STATUS_LABEL[a.status]}</span>
              {a.statusChangedAt && <div className="text-xs text-text-muted">{fmtDate(a.statusChangedAt)}{a.statusChangedBy ? ` · ${a.statusChangedBy}` : ""}</div>}
              {a.statusNote && <div className="text-xs text-text-muted">“{a.statusNote}”</div>}
            </td>
            <td className={`${td} text-text-muted`}>{fmtDate(a.createdAt)}</td>
            <td className={td}>
              {NEXT[a.status].length > 0 ? (
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
