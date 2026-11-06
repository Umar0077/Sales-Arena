"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Archive, CalendarPlus, Trash2, X } from "lucide-react";
import { adminApi } from "@/frontend/components/admin/admin-api";
import { Notice } from "@/frontend/components/admin/spins/shared";
import { inputClass, PrimaryButton, GhostButton } from "@/frontend/components/admin/ui";
import { cn } from "@/shared/utils";

type Kind = "daily" | "weekly" | "monthly";

function Modal({ title, onClose, children, testId }: { title: string; onClose: () => void; children: React.ReactNode; testId: string }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-[#0D1426] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-heading text-lg font-bold text-white">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-text-muted hover:bg-white/5 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

interface Check {
  program: { id: string; name: string; kind: Kind; salesRequired: number; rewardType: string; amount: number; currency: string; prizeLabel: string; status: string; revision: number };
  awards: { total: number; paid: number; recovered: number; cash: number };
  duplicate: { awarding: boolean; others: Array<{ id: string; name: string; awarding: boolean }> } | null;
  canDelete: boolean;
  blockers: string[];
}

/** Owner: permanent delete with integrity checks; programs with award history can only be archived. */
export function DeleteProgramDialog({ programId, onClose, onDone }: { programId: string; onClose: () => void; onDone: (text: string) => void }) {
  const [check, setCheck] = useState<Check | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await adminApi<Check>(`/api/admin/programs/${encodeURIComponent(programId)}/permanent`);
      if (r.ok) setCheck(r.data);
      else setError(r.status === 403 ? "Only the Owner can delete reward programs." : r.error);
    }, 0);
    return () => clearTimeout(t);
  }, [programId]);

  const del = async () => {
    if (!check) return;
    setBusy(true);
    const r = await adminApi(`/api/admin/programs/${encodeURIComponent(programId)}/permanent`, { method: "POST", body: { confirm: true, revision: check.program.revision } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onDone(`"${check.program.name}" was permanently deleted (recorded in the audit log).`);
  };
  const archive = async () => {
    if (!check) return;
    setBusy(true);
    const r = await adminApi(`/api/admin/programs/${encodeURIComponent(programId)}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onDone(`"${check.program.name}" archived. Its awards and history are kept.`);
  };

  const p = check?.program;
  return (
    <Modal title="Delete reward program" onClose={onClose} testId="delete-dialog">
      {error && <Notice kind="error">{error}</Notice>}
      {!check && !error && <p className="text-sm text-text-muted">Checking award history in PostgreSQL…</p>}
      {check && p && (
        <div className="space-y-4 text-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:grid-cols-3">
            <div><dt className="text-xs text-text-muted">Program</dt><dd className="font-semibold text-white">{p.name}</dd></div>
            <div><dt className="text-xs text-text-muted">Category</dt><dd className="capitalize text-white">{p.kind}</dd></div>
            <div><dt className="text-xs text-text-muted">Threshold</dt><dd className="text-white">{p.salesRequired} validated sales</dd></div>
            <div><dt className="text-xs text-text-muted">Reward</dt><dd className="text-gold">{p.rewardType === "cash" ? `${p.currency} ${p.amount.toLocaleString("en-US")}` : p.prizeLabel}</dd></div>
            <div><dt className="text-xs text-text-muted">Linked awards</dt><dd className="text-white" data-testid="delete-award-count">{check.awards.total}{check.awards.paid ? ` (${check.awards.paid} paid)` : ""}</dd></div>
            <div><dt className="text-xs text-text-muted">Status</dt><dd className="capitalize text-white">{p.status}</dd></div>
          </dl>
          {check.duplicate && (
            <Notice kind="info">
              {check.duplicate.awarding
                ? "This is the duplicate that currently AWARDS (the oldest). Deleting it would make another copy award instead."
                : "This is a duplicate that does NOT award; the oldest copy keeps awarding."}{" "}
              Other copies: {check.duplicate.others.map((o) => `${o.name}${o.awarding ? " (awarding)" : ""}`).join(", ")}.
            </Notice>
          )}
          {check.canDelete ? (
            <>
              <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-rose-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                No award references this program, so it can be permanently deleted. This cannot be undone; its settings and revision history are kept in the audit log.
              </div>
              <label className="flex items-center gap-2 text-text-secondary">
                <input type="checkbox" className="h-4 w-4 accent-[#7568FF]" checked={sure} onChange={(e) => setSure(e.target.checked)} data-testid="delete-confirm" />
                I want to permanently delete “{p.name}”.
              </label>
              <div className="flex justify-end gap-2">
                <GhostButton onClick={onClose}>Cancel</GhostButton>
                <button onClick={del} disabled={!sure || busy} data-testid="delete-permanent" className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 font-semibold text-white hover:bg-rose-500 disabled:opacity-50">
                  <Trash2 className="h-4 w-4" /> {busy ? "Deleting…" : "Delete permanently"}
                </button>
              </div>
            </>
          ) : (
            <>
              <Notice kind="error"><span data-testid="delete-blocked">{check.blockers.join(" ")}</span></Notice>
              {check.awards.total > 0 && <p className="text-xs text-text-muted">Linked financial history: {check.awards.total} award(s), cash earned {check.awards.cash.toLocaleString("en-US")}{check.awards.recovered ? `, ${check.awards.recovered} Owner-approved` : ""}. It is never deleted.</p>}
              <div className="flex justify-end gap-2">
                <GhostButton onClick={onClose}>Cancel</GhostButton>
                {p.status !== "archived" && <PrimaryButton onClick={archive} disabled={busy} data-testid="delete-archive-instead"><Archive className="h-4 w-4" /> Archive instead</PrimaryButton>}
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

interface ExtItem {
  id: string;
  name: string;
  kind: Kind;
  salesRequired: number;
  amount: number;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  newEndDate: string | null;
  effectiveStart: string | null;
  revision: number;
  status: "will_extend" | "already_covered" | "needs_reactivation" | "ineligible";
  note: string;
}
interface ExtPreview {
  currentMonth: string;
  earliestMonth: string;
  timezone: string;
  targetMonth: string | null;
  newEndDate: string | null;
  items: ExtItem[];
  affected: number;
}
const STATUS: Record<ExtItem["status"], [string, string]> = {
  will_extend: ["Will extend", "text-emerald-300"],
  already_covered: ["Already covered", "text-text-muted"],
  needs_reactivation: ["Needs reactivation", "text-amber-200"],
  ineligible: ["Ineligible", "text-rose-300"],
};
const monthLabel = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** Owner: extend programs to the end of a future month. Read-only preview, then explicit confirmation. */
export function ExtendProgramsDialog({ defaultKind, onClose, onDone }: { defaultKind: Kind; onClose: () => void; onDone: (text: string) => void }) {
  const [range, setRange] = useState<ExtPreview | null>(null);
  const [month, setMonth] = useState("");
  const [kinds, setKinds] = useState<Kind[]>([defaultKind]);
  const [pv, setPv] = useState<ExtPreview | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [react, setReact] = useState<Set<string>>(new Set());
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await adminApi<ExtPreview>("/api/admin/programs/extend/preview", { method: "POST", body: {} });
      if (!r.ok) return setError(r.status === 403 ? "Only the Owner can extend reward programs." : r.error);
      setRange(r.data);
      setMonth(r.data.earliestMonth);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const load = async () => {
    setBusy(true);
    setError(null);
    const r = await adminApi<ExtPreview>("/api/admin/programs/extend/preview", { method: "POST", body: { targetMonth: month, kinds } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setPv(r.data);
    setPicked(new Set(r.data.items.filter((i) => i.status === "will_extend").map((i) => i.id)));
    setReact(new Set());
    setSure(false);
  };
  const apply = async () => {
    if (!pv) return;
    setBusy(true);
    const ids = [...picked];
    const revisions = Object.fromEntries(pv.items.filter((i) => picked.has(i.id)).map((i) => [i.id, i.revision]));
    const r = await adminApi<{ extended: string[]; skipped: Array<{ id: string }> }>("/api/admin/programs/extend", {
      method: "POST",
      body: { targetMonth: pv.targetMonth, programIds: ids, reactivateIds: [...react].filter((id) => picked.has(id)), revisions, confirm: true },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onDone(`Extended ${r.data.extended.length} program(s) to ${monthLabel(pv.targetMonth!)} (ends ${pv.newEndDate}).${r.data.skipped.length ? ` ${r.data.skipped.length} skipped.` : ""}`);
  };

  const selectable = useMemo(() => pv?.items.filter((i) => i.status === "will_extend" || i.status === "needs_reactivation") ?? [], [pv]);
  const willChange = selectable.filter((i) => picked.has(i.id) && (i.status === "will_extend" || react.has(i.id))).length;

  return (
    <Modal title="Extend Reward Programs" onClose={onClose} testId="extend-dialog">
      {error && <div className="mb-3"><Notice kind="error">{error}</Notice></div>}
      {range && (
        <div className="space-y-4 text-sm">
          <p className="text-xs text-text-muted">
            Moves only the end date to the last day of the chosen month. Thresholds, amounts, stackable, eligibility, visibility, start dates, activation and earned awards
            stay the same, and sales still count per business {kinds.join(" / ")} period (months never combine). Business timezone: {range.timezone}.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <label className="space-y-1.5">
              <span className="block text-xs font-semibold uppercase tracking-wider text-text-muted">Target month</span>
              <input type="month" className={cn(inputClass, "w-48")} min={range.earliestMonth} value={month} onChange={(e) => setMonth(e.target.value)} data-testid="extend-month" />
            </label>
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-semibold uppercase tracking-wider text-text-muted">Categories</legend>
              <div className="flex flex-wrap gap-3">
                {(["daily", "weekly", "monthly"] as Kind[]).map((k) => (
                  <label key={k} className="flex items-center gap-1.5 capitalize text-text-secondary">
                    <input type="checkbox" className="h-4 w-4 accent-[#7568FF]" checked={kinds.includes(k)} data-testid={`extend-kind-${k}`}
                      onChange={(e) => setKinds((ks) => (e.target.checked ? [...ks, k] : ks.filter((x) => x !== k)))} />
                    {k}
                  </label>
                ))}
                <button className="text-xs text-secondary hover:underline" onClick={() => setKinds(["daily", "weekly", "monthly"])}>All categories</button>
              </div>
            </fieldset>
            <PrimaryButton onClick={load} disabled={busy || !month || !kinds.length} data-testid="extend-preview"><CalendarPlus className="h-4 w-4" /> Preview</PrimaryButton>
          </div>

          {pv && (
            <>
              <p className="text-text-secondary">
                {monthLabel(pv.targetMonth!)} → new end date <b className="text-white">{pv.newEndDate}</b> · <span data-testid="extend-affected">{willChange}</span> program(s) will change
              </p>
              <div className="overflow-x-auto rounded-lg border border-white/[0.07]">
                <table className="w-full min-w-[720px] text-xs" data-testid="extend-table">
                  <thead className="bg-white/[0.04] text-left uppercase tracking-wider text-text-muted">
                    <tr><th className="px-3 py-2" /><th className="px-3 py-2">Program</th><th className="px-3 py-2">Start</th><th className="px-3 py-2">Current end</th><th className="px-3 py-2">New end</th><th className="px-3 py-2">Status</th></tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {pv.items.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-text-muted">No programs in these categories.</td></tr>}
                    {pv.items.map((i) => {
                      const can = i.status === "will_extend" || i.status === "needs_reactivation";
                      return (
                        <tr key={i.id} data-testid="extend-row" data-program={i.name} data-status={i.status}>
                          <td className="px-3 py-2">
                            {can && <input type="checkbox" className="h-4 w-4 accent-[#7568FF]" checked={picked.has(i.id)} aria-label={`Extend ${i.name}`}
                              onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(i.id); else n.delete(i.id); return n; })} />}
                          </td>
                          <td className="px-3 py-2 text-white">{i.name}<div className="capitalize text-text-muted">{i.kind} · {i.salesRequired} sales · {i.currency} {i.amount.toLocaleString("en-US")}</div></td>
                          <td className="px-3 py-2 text-text-muted">{i.startDate ?? "—"}</td>
                          <td className="px-3 py-2 text-text-muted">{i.endDate ?? "No end"}</td>
                          <td className="px-3 py-2 text-white">{can ? i.newEndDate : "—"}</td>
                          <td className="px-3 py-2">
                            <span className={STATUS[i.status][1]}>{STATUS[i.status][0]}</span>
                            {i.note && <div className="text-text-muted">{i.note}</div>}
                            {i.status === "needs_reactivation" && (
                              <label className="mt-1 flex items-center gap-1.5 text-amber-200">
                                <input type="checkbox" className="h-3.5 w-3.5 accent-[#7568FF]" checked={react.has(i.id)}
                                  onChange={(e) => setReact((s) => { const n = new Set(s); if (e.target.checked) n.add(i.id); else n.delete(i.id); return n; })} />
                                Reactivate · earns from: {i.effectiveStart}
                              </label>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {selectable.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-text-secondary">
                    <input type="checkbox" className="h-4 w-4 accent-[#7568FF]" checked={sure} onChange={(e) => setSure(e.target.checked)} data-testid="extend-confirm" />
                    I confirm extending the selected programs to {monthLabel(pv.targetMonth!)}.
                  </label>
                  <PrimaryButton onClick={apply} disabled={busy || !sure || willChange === 0} data-testid="extend-apply">Extend {willChange} program(s)</PrimaryButton>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
