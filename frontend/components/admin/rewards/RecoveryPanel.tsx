"use client";

import { useState } from "react";
import { History, Search, ShieldCheck } from "lucide-react";
import { adminApi } from "@/frontend/components/admin/admin-api";
import { Notice, fmtDate } from "@/frontend/components/admin/spins/shared";
import { inputClass, PrimaryButton, GhostButton } from "@/frontend/components/admin/ui";
import { cn } from "@/shared/utils";

interface Proposed {
  programId: string;
  programName: string;
  salesRequired: number;
  amount: number;
  currency: string;
  previousAmount: number;
  incrementAmount: number;
  payableAmount: number;
  countedCaseIds: string[];
  triggerCaseId: string;
}
interface ScanItem {
  userCode: string;
  agentName: string;
  kind: "daily" | "weekly" | "monthly";
  rewardGroup: string;
  periodKey: string;
  periodDate: string;
  existing: { programName: string; salesRequired: number; amount: number; status: string } | null;
  proposed: Proposed;
  source: "automatic" | "recovery";
  approvalCaseIds: string[];
  excluded: Array<{ caseId: string; reason: string }>;
}
interface Scan {
  range: { from: string; to: string; notBefore: string; notAfter: string; timezone: string };
  audience?: "all" | "senior" | "junior";
  programGroups?: number;
  agents: number;
  sales: number;
  items: ScanItem[];
}
interface Preview {
  agent: { userCode: string; name: string };
  group: { kind: string; rewardGroup: string };
  period: { key: string; timezone: string };
  tiers: Array<{ programId: string; name: string; salesRequired: number; amount: number; currency: string; activeSince: string | null }>;
  sales: Array<{ caseId: string; validatedAt: string; source: string; class: string; explanation: string }>;
  chain: Array<{ id: string; programName: string; salesRequired: number; amount: number; status: string; source: string; superseded: boolean }>;
  proposed: Proposed | null;
  blockers: string[];
  notes: string[];
}

const CLASS_STYLE: Record<string, string> = {
  counted_automatically: "text-sky-300",
  owner_approved: "text-emerald-300",
  needs_approval: "text-amber-200",
  historical_import: "text-text-muted",
  outside_range: "text-text-muted",
};
const lbl = "block text-xs font-semibold uppercase tracking-wider text-text-muted";
const money = (c: string, v: number) => `${c} ${Math.round(v).toLocaleString("en-US")}`;
const monthRange = () => {
  const d = new Date();
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return { from, to: `${from.slice(0, 8)}${String(last).padStart(2, "0")}` };
};
const keyOf = (i: ScanItem) => `${i.userCode}|${i.kind}|${i.rewardGroup}|${i.periodKey}`;

/**
 * Owner only. Finds highest-tier bonuses that were genuinely earned but never issued (missed automatic
 * tiers, missed upgrades after a recovery, pre-activation sales needing approval). Read-only until the
 * Owner ticks items, gives a reason and confirms. Each upgrade supersedes the previous tier; it never adds
 * the full tier amount on top, and nothing is paid automatically.
 */
export function RecoveryPanel({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState(monthRange);
  const [includeBackfill, setIncludeBackfill] = useState(false);
  const [audience, setAudience] = useState<"all" | "senior" | "junior">("all");
  const [scan, setScan] = useState<Scan | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [sure, setSure] = useState(false);
  const [announce, setAnnounce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [detail, setDetail] = useState<Preview | null>(null);

  const doScan = async () => {
    setBusy(true);
    setMsg(null);
    setScan(null);
    setPicked(new Set());
    setDetail(null);
    const r = await adminApi<Scan>("/api/admin/awards/recovery/scan", { method: "POST", body: { ...range, includeBackfill, audience } });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "error", text: r.status === 403 ? "Only the Owner can scan for missing awards." : r.error });
    setScan(r.data);
  };
  const body = (i: ScanItem) => ({ userCode: i.userCode, kind: i.kind, rewardGroup: i.rewardGroup, periodDate: i.periodDate, notBefore: scan!.range.notBefore, notAfter: scan!.range.notAfter, includeBackfill });
  const showDetail = async (i: ScanItem) => {
    const r = await adminApi<{ preview: Preview }>("/api/admin/awards/recovery/preview", { method: "POST", body: body(i) });
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
      if (!picked.has(keyOf(i))) continue;
      const r = await adminApi<{ created: { amount: number; currency: string; incrementAmount: number } }>("/api/admin/awards/recovery", {
        method: "POST",
        body: { ...body(i), expectProgramId: i.proposed.programId, reason, confirm: sure, announce },
      });
      if (r.ok) {
        ok++;
        results.push(`${i.agentName} · ${i.periodKey}: now ${money(r.data.created.currency, r.data.created.amount)} (+${money(r.data.created.currency, r.data.created.incrementAmount)})`);
      } else results.push(`${i.agentName} · ${i.periodKey}: not applied (${r.error})`);
    }
    setBusy(false);
    setMsg({ kind: ok ? "ok" : "error", text: `${ok} upgrade(s) applied (status "earned", not paid). ${results.join(" | ")}` });
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

  return (
    <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.04] p-4" data-testid="recovery-panel">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-heading font-bold text-white"><ShieldCheck className="h-4 w-4 text-amber-300" /> Missing bonus awards and tier upgrades</h3>
          <p className="mt-1 max-w-3xl text-xs text-text-muted">
            Read-only scan of a business date range. For each agent and period it shows the highest tier the sales now reach and what changes:
            <b className="text-sky-300"> catch-up</b> (counted automatically, award never created) or <b className="text-amber-200">recovery</b> (needs your approval of sales
            validated before the program was active). The new tier replaces the previous one: the agent&apos;s bonus becomes the higher tier amount, not both.
            Sales, processing flags, activation times and spin credits are never changed; nothing is paid automatically.
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
        <label className="space-y-1.5">
          <span className={lbl}>Bonuses</span>
          <select className={inputClass} value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)} data-testid="scan-audience">
            <option value="all" className="bg-[#0D1426]">All</option>
            <option value="senior" className="bg-[#0D1426]">Senior</option>
            <option value="junior" className="bg-[#0D1426]">Junior</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs text-text-secondary">
          <input type="checkbox" className="h-4 w-4 accent-[#7568FF]" checked={includeBackfill} onChange={(e) => setIncludeBackfill(e.target.checked)} />
          Also allow historical-import (backfill) sales
        </label>
        <PrimaryButton onClick={doScan} disabled={busy} data-testid="scan-run"><Search className="h-4 w-4" /> {busy && !scan ? "Scanning…" : "Scan (read-only)"}</PrimaryButton>
      </div>
      {msg && <div className="mt-3"><Notice kind={msg.kind}>{msg.text}</Notice></div>}

      {scan && (
        <div className="mt-4 space-y-3 text-sm" data-testid="scan-result">
          <p className="text-text-secondary">
            {scan.range.from} → {scan.range.to} ({scan.range.timezone}) · {scan.sales} validated sale(s) by {scan.agents} agent(s) · {scan.items.length} upgrade(s) found.
          </p>
          {scan.items.length === 0 ? (
            <Notice kind="info">
              {scan.audience === "junior" && scan.programGroups === 0
                ? <span data-testid="scan-no-junior">No Junior bonus programmes are configured, so there are no missing Junior awards.</span>
                : "No missing awards or upgrades in this range."}
            </Notice>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-white/[0.07]">
              <table className="w-full min-w-[920px] text-xs">
                <thead className="bg-white/[0.04] text-left uppercase tracking-wider text-text-muted">
                  <tr>
                    <th className="px-3 py-2" /><th className="px-3 py-2">Agent</th><th className="px-3 py-2">Group · period</th><th className="px-3 py-2">Current tier</th>
                    <th className="px-3 py-2">Proposed tier</th><th className="px-3 py-2">Increase · payable</th><th className="px-3 py-2">Sales</th><th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {scan.items.map((i) => (
                    <tr key={keyOf(i)} data-testid="scan-item" data-agent={i.userCode} data-source={i.source}>
                      <td className="px-3 py-2">
                        <input type="checkbox" className="h-4 w-4 accent-[#7568FF]" data-testid="pick-item" aria-label={`Apply for ${i.agentName}`} checked={picked.has(keyOf(i))}
                          onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(keyOf(i)); else n.delete(keyOf(i)); return n; })} />
                      </td>
                      <td className="px-3 py-2 text-white">{i.agentName}<div className="text-text-muted">{i.userCode}</div></td>
                      <td className="px-3 py-2 text-text-secondary"><span className="capitalize">{i.kind}</span> · {i.rewardGroup}<div className="font-mono text-text-muted">{i.periodKey}</div></td>
                      <td className="px-3 py-2 text-text-secondary">{i.existing ? `${i.existing.programName} (${i.existing.salesRequired} sales) ${money(i.proposed.currency, i.existing.amount)}` : "None"}</td>
                      <td className="px-3 py-2">
                        <b className="text-white">{i.proposed.programName}</b> ({i.proposed.salesRequired} sales)
                        <div className="text-gold">{money(i.proposed.currency, i.proposed.amount)} total</div>
                        <span className={i.source === "recovery" ? "text-amber-200" : "text-sky-300"}>{i.source === "recovery" ? "Recovery (needs approval)" : "Catch-up"}</span>
                      </td>
                      <td className="px-3 py-2 text-text-secondary">
                        <span className="text-emerald-300">+{money(i.proposed.currency, i.proposed.incrementAmount)}</span>
                        <div className="text-text-muted">payable {money(i.proposed.currency, i.proposed.payableAmount)}</div>
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-text-muted">
                        {i.proposed.countedCaseIds.join(", ")}
                        {i.approvalCaseIds.length > 0 && <div className="text-amber-200">approve: {i.approvalCaseIds.join(", ")}</div>}
                        {i.excluded.length > 0 && <div title={i.excluded.map((x) => `${x.caseId}: ${x.reason}`).join("\n")}>{i.excluded.length} excluded</div>}
                      </td>
                      <td className="px-3 py-2"><button onClick={() => void showDetail(i)} className="text-secondary hover:underline">Details</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {scan.items.length > 0 && (
            <div className="space-y-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="flex gap-3 text-xs">
                <button className="text-secondary hover:underline" onClick={() => setPicked(new Set(scan.items.map(keyOf)))}>Select all</button>
                <button className="text-text-muted hover:underline" onClick={() => setPicked(new Set())}>Clear</button>
                <span className="text-text-muted">{picked.size} selected</span>
              </div>
              <label className="block space-y-1.5">
                <span className={lbl}>Reason (stored in the audit log)</span>
                <textarea className={cn(inputClass, "min-h-[56px]")} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid="recovery-reason" />
              </label>
              <label className="flex items-center gap-2 text-xs text-text-secondary">
                <input type="checkbox" className="h-4 w-4 accent-[#7568FF]" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />
                Show a celebration popup on the Live Arena for these (off by default for historical corrections)
              </label>
              <label className="flex items-center gap-2 text-xs text-text-secondary">
                <input type="checkbox" className="h-4 w-4 accent-[#7568FF]" checked={sure} onChange={(e) => setSure(e.target.checked)} data-testid="recovery-confirm" />
                I confirm these sales genuinely reached the proposed tiers and approve the upgrades (status “earned”, not paid).
              </label>
              <PrimaryButton onClick={approve} disabled={busy || !sure || picked.size === 0 || reason.trim().length < 10} data-testid="recovery-approve">
                Apply {picked.size} selected
              </PrimaryButton>
            </div>
          )}
        </div>
      )}

      {detail && (
        <div className="mt-4 space-y-2 text-xs" data-testid="recovery-detail">
          <p className="text-text-secondary">
            <b className="text-white">{detail.agent.name}</b> · <span className="capitalize">{detail.group.kind}</span> group “{detail.group.rewardGroup}” · period {detail.period.key} ({detail.period.timezone}) · tiers:{" "}
            {detail.tiers.map((t) => `${t.salesRequired} → ${money(t.currency, t.amount)}`).join(", ")}
          </p>
          <div className="overflow-x-auto rounded-lg border border-white/[0.07]">
            <table className="w-full min-w-[640px]">
              <thead className="bg-white/[0.04] text-left uppercase tracking-wider text-text-muted">
                <tr><th className="px-3 py-2">Sale</th><th className="px-3 py-2">Validated</th><th className="px-3 py-2">Source</th><th className="px-3 py-2">Counts?</th></tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {detail.sales.map((s) => (
                  <tr key={s.caseId} data-testid="recovery-sale" data-class={s.class}>
                    <td className="px-3 py-2 font-mono text-white">{s.caseId}</td>
                    <td className="px-3 py-2 text-text-secondary">{fmtDate(s.validatedAt)}</td>
                    <td className="px-3 py-2 text-text-muted">{s.source}</td>
                    <td className={cn("px-3 py-2", CLASS_STYLE[s.class])}>{s.explanation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {detail.chain.length > 0 && (
            <p className="text-text-muted">Award chain: {detail.chain.map((c) => `${c.programName} ${c.amount.toLocaleString("en-US")} (${c.status}${c.superseded ? ", superseded" : ""}, ${c.source})`).join(" → ")}</p>
          )}
          {[...detail.blockers, ...detail.notes].map((t) => <Notice key={t} kind="info">{t}</Notice>)}
        </div>
      )}
    </div>
  );
}
