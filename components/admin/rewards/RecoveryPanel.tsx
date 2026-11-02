"use client";

import { useState } from "react";
import { History, Search, ShieldCheck } from "lucide-react";
import { adminApi } from "@/components/admin/admin-api";
import { Notice, fmtDate } from "@/components/admin/spins/shared";
import { inputClass, PrimaryButton, GhostButton } from "@/components/admin/ui";
import { cn } from "@/lib/utils";

interface ScanItem {
  userCode: string;
  agentName: string;
  programId: string;
  programName: string;
  kind: string;
  salesRequired: number;
  periodKey: string;
  periodDate: string;
  recover: { awards: number; amount: number; currency: string; sales: string[] } | null;
  catchUp: { awards: number; amount: number; currency: string; sales: string[] } | null;
}
interface Scan {
  range: { from: string; to: string; notBefore: string; notAfter: string; timezone: string };
  agents: number;
  sales: number;
  items: ScanItem[];
}
interface Preview {
  agent: { userCode: string; name: string };
  program: { id: string; name: string; kind: string; amount: number; currency: string; prizeLabel: string; rewardType: string; salesRequired: number; activeSince: string | null };
  period: { key: string; timezone: string };
  automaticCountingFrom: string;
  sales: Array<{ caseId: string; validatedAt: string; source: string; rewardEligible: boolean; class: string; explanation: string }>;
  existing: Array<{ n: number; status: string; source: string }>;
  toCreate: Array<{ n: number; amount: number; currency: string; triggerCaseId: string }>;
  catchUp: { due: number; blocked: string | null; amount: number; currency: string };
  blockers: string[];
  notes: string[];
}

const CLASS_STYLE: Record<string, string> = {
  recoverable: "text-emerald-300",
  counted_automatically: "text-sky-300",
  historical_import: "text-amber-200",
  not_validated: "text-rose-300",
  outside_range: "text-text-muted",
};
const lbl = "block text-xs font-semibold uppercase tracking-wider text-text-muted";
const money = (c: string, v: number) => `${c} ${v.toLocaleString("en-US")}`;
const monthRange = () => {
  const d = new Date();
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return { from, to: `${from.slice(0, 8)}${String(last).padStart(2, "0")}` };
};
const itemKey = (i: ScanItem, mode: "recover" | "catchup") => `${mode}|${i.userCode}|${i.programId}|${i.periodKey}`;

/**
 * Owner only. Finds and creates bonuses that were genuinely earned but never issued — generic for any agent,
 * program and period. Scans are read-only; creating needs explicit selection, a reason and confirmation,
 * is audited, idempotent and limited to sales inside the approved range.
 */
export function RecoveryPanel({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState(monthRange);
  const [includeBackfill, setIncludeBackfill] = useState(false);
  const [scan, setScan] = useState<Scan | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [sure, setSure] = useState(false);
  const [announce, setAnnounce] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [detail, setDetail] = useState<Preview | null>(null);

  const doScan = async () => {
    setBusy(true);
    setMsg(null);
    setScan(null);
    setPicked(new Set());
    setDetail(null);
    const r = await adminApi<Scan>("/api/admin/awards/recovery/scan", { method: "POST", body: { ...range, includeBackfill } });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "error", text: r.status === 403 ? "Only the Owner can scan for missing awards." : r.error });
    setScan(r.data);
  };
  const showDetail = async (i: ScanItem) => {
    if (!scan) return;
    const r = await adminApi<{ preview: Preview }>("/api/admin/awards/recovery/preview", {
      method: "POST",
      body: { userCode: i.userCode, programId: i.programId, periodDate: i.periodDate, notBefore: scan.range.notBefore, notAfter: scan.range.notAfter, includeBackfill },
    });
    if (r.ok) setDetail(r.data.preview);
    else setMsg({ kind: "error", text: r.error });
  };
  const approve = async () => {
    if (!scan) return;
    setBusy(true);
    setMsg(null);
    const results: string[] = [];
    let ok = 0;
    for (const i of scan.items) {
      for (const mode of ["catchup", "recover"] as const) {
        if (!picked.has(itemKey(i, mode))) continue;
        const r = await adminApi<{ created: Array<{ amount: number; currency: string }> }>("/api/admin/awards/recovery", {
          method: "POST",
          body: { mode, userCode: i.userCode, programId: i.programId, periodDate: i.periodDate, notBefore: scan.range.notBefore, notAfter: scan.range.notAfter, includeBackfill, reason, confirm: sure, announce },
        });
        if (r.ok) {
          ok += r.data.created.length;
          results.push(`${i.agentName} · ${i.programName} · ${i.periodKey}: ${r.data.created.map((c) => money(c.currency, c.amount)).join(", ")}`);
        } else results.push(`${i.agentName} · ${i.programName} · ${i.periodKey}: not created (${r.error})`);
      }
    }
    setBusy(false);
    setMsg({ kind: ok ? "ok" : "error", text: `${ok} award(s) created with status "earned" (not paid). ${results.join(" | ")}` });
    setSure(false);
    onCreated();
    await doScan();
  };

  if (!open)
    return (
      <GhostButton onClick={() => setOpen(true)} data-testid="open-recovery">
        <History className="h-4 w-4" /> Find missing awards (Owner)
      </GhostButton>
    );

  const selectable = scan?.items.flatMap((i) => [i.catchUp && itemKey(i, "catchup"), i.recover && itemKey(i, "recover")].filter(Boolean) as string[]) ?? [];
  return (
    <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.04] p-4" data-testid="recovery-panel">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-heading font-bold text-white"><ShieldCheck className="h-4 w-4 text-amber-300" /> Missing bonus awards</h3>
          <p className="mt-1 max-w-3xl text-xs text-text-muted">
            Read-only scan of a business date range for bonuses genuinely earned but never issued. <b className="text-sky-300">Catch-up</b>: sales the automatic rule counts
            whose award was never created. <b className="text-emerald-300">Recovery</b>: sales validated before the program was activated. Only sales inside the range count;
            nothing is created until you tick it, give a reason and confirm. Sales, processing flags, activation times and spin credits are never changed.
          </p>
        </div>
        <button onClick={() => { setOpen(false); setScan(null); setDetail(null); }} className="text-xs text-text-muted hover:text-white">Close</button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1.5">
          <span className={lbl}>From (business date)</span>
          <input type="date" className={inputClass} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} data-testid="scan-from" />
        </label>
        <label className="space-y-1.5">
          <span className={lbl}>To</span>
          <input type="date" className={inputClass} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} data-testid="scan-to" />
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs text-text-secondary">
          <input type="checkbox" className="h-4 w-4 accent-[#7568FF]" checked={includeBackfill} onChange={(e) => setIncludeBackfill(e.target.checked)} />
          Also count historical-import (backfill) sales
        </label>
        <PrimaryButton onClick={doScan} disabled={busy} data-testid="scan-run"><Search className="h-4 w-4" /> {busy && !scan ? "Scanning…" : "Scan (read-only)"}</PrimaryButton>
      </div>
      {msg && <div className="mt-3"><Notice kind={msg.kind}>{msg.text}</Notice></div>}

      {scan && (
        <div className="mt-4 space-y-3 text-sm" data-testid="scan-result">
          <p className="text-text-secondary">
            {scan.range.from} → {scan.range.to} ({scan.range.timezone}) · {scan.sales} validated sale(s) by {scan.agents} agent(s) · {scan.items.length} period(s) with missing awards.
          </p>
          {scan.items.length === 0 ? (
            <Notice kind="info">No missing awards in this range.</Notice>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-white/[0.07]">
              <table className="w-full min-w-[820px] text-xs">
                <thead className="bg-white/[0.04] text-left uppercase tracking-wider text-text-muted">
                  <tr><th className="px-3 py-2">Agent</th><th className="px-3 py-2">Program</th><th className="px-3 py-2">Period</th><th className="px-3 py-2">Catch-up (automatic rule)</th><th className="px-3 py-2">Recovery (pre-activation)</th><th className="px-3 py-2" /></tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {scan.items.map((i) => (
                    <tr key={`${i.userCode}|${i.programId}|${i.periodKey}`} data-testid="scan-item" data-agent={i.userCode} data-program={i.programName}>
                      <td className="px-3 py-2 text-white">{i.agentName}<div className="text-text-muted">{i.userCode}</div></td>
                      <td className="px-3 py-2 text-text-secondary">{i.programName}<div className="capitalize text-text-muted">{i.kind} · {i.salesRequired} sales</div></td>
                      <td className="px-3 py-2 font-mono text-text-muted">{i.periodKey}</td>
                      {(["catchUp", "recover"] as const).map((k) => {
                        const v = i[k];
                        const mode = k === "catchUp" ? "catchup" : "recover";
                        return (
                          <td key={k} className="px-3 py-2">
                            {v ? (
                              <label className="flex items-start gap-2">
                                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#7568FF]" data-testid={`pick-${mode}`} checked={picked.has(itemKey(i, mode))}
                                  onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(itemKey(i, mode)); else n.delete(itemKey(i, mode)); return n; })} />
                                <span>
                                  <b className={mode === "catchup" ? "text-sky-300" : "text-emerald-300"}>{v.awards} × {money(v.currency, v.amount)}</b>
                                  <span className="block font-mono text-[10px] text-text-muted">{v.sales.join(", ")}</span>
                                </span>
                              </label>
                            ) : <span className="text-text-muted">—</span>}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2"><button onClick={() => void showDetail(i)} className="text-secondary hover:underline">Details</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {selectable.length > 0 && (
            <div className="space-y-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="flex gap-3 text-xs">
                <button className="text-secondary hover:underline" onClick={() => setPicked(new Set(selectable))}>Select all</button>
                <button className="text-text-muted hover:underline" onClick={() => setPicked(new Set())}>Clear</button>
                <span className="text-text-muted">{picked.size} selected</span>
              </div>
              <label className="block space-y-1.5">
                <span className={lbl}>Reason (stored in the audit log)</span>
                <textarea className={cn(inputClass, "min-h-[56px]")} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid="recovery-reason" />
              </label>
              <label className="flex items-center gap-2 text-xs text-text-secondary">
                <input type="checkbox" className="h-4 w-4 accent-[#7568FF]" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />
                Show the celebration popup on the Live Arena for the created awards (if announcements are on)
              </label>
              <label className="flex items-center gap-2 text-xs text-text-secondary">
                <input type="checkbox" className="h-4 w-4 accent-[#7568FF]" checked={sure} onChange={(e) => setSure(e.target.checked)} data-testid="recovery-confirm" />
                I confirm the selected sales genuinely earned these bonuses and approve creating the awards (status “earned”, not paid).
              </label>
              <PrimaryButton onClick={approve} disabled={busy || !sure || picked.size === 0 || reason.trim().length < 10} data-testid="recovery-approve">
                Create {picked.size} selected
              </PrimaryButton>
            </div>
          )}
        </div>
      )}

      {detail && (
        <div className="mt-4 space-y-2 text-xs" data-testid="recovery-detail">
          <p className="text-text-secondary">
            <b className="text-white">{detail.agent.name}</b> · <b className="text-white">{detail.program.name}</b> · period {detail.period.key} ({detail.period.timezone}) · program
            active since {detail.program.activeSince ? fmtDate(detail.program.activeSince) : "—"} · automatic counting from {fmtDate(detail.automaticCountingFrom)}
          </p>
          <div className="overflow-x-auto rounded-lg border border-white/[0.07]">
            <table className="w-full min-w-[640px]">
              <thead className="bg-white/[0.04] text-left uppercase tracking-wider text-text-muted">
                <tr><th className="px-3 py-2">Sale</th><th className="px-3 py-2">Validated</th><th className="px-3 py-2">Source</th><th className="px-3 py-2">Classification</th></tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {detail.sales.map((s) => (
                  <tr key={s.caseId} data-testid="recovery-sale" data-class={s.class}>
                    <td className="px-3 py-2 font-mono text-white">{s.caseId}</td>
                    <td className="px-3 py-2 text-text-secondary">{fmtDate(s.validatedAt)}</td>
                    <td className="px-3 py-2 text-text-muted">{s.source}{s.rewardEligible ? "" : " · reward_eligible = false"}</td>
                    <td className={cn("px-3 py-2", CLASS_STYLE[s.class])}>{s.explanation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {detail.existing.length > 0 && <p className="text-text-muted">Existing awards: {detail.existing.map((a) => `#${a.n} ${a.status} (${a.source})`).join(", ")}</p>}
          {[...detail.blockers, ...(detail.catchUp.blocked ? [detail.catchUp.blocked] : []), ...detail.notes].map((t) => <Notice key={t} kind="info">{t}</Notice>)}
        </div>
      )}
    </div>
  );
}
