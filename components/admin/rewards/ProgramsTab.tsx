"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, History, Pencil, Plus, Save, X } from "lucide-react";
import { adminApi } from "@/components/admin/admin-api";
import { Notice, fmtDate } from "@/components/admin/spins/shared";
import { Section, Toggle, inputClass, PrimaryButton, GhostButton } from "@/components/admin/ui";
import { useAdminSync } from "@/components/admin/AdminLiveSync";
import { saveSettings } from "@/lib/admin/global-settings";
import { useSettingsStore } from "@/store/settings-store";
import { cn } from "@/lib/utils";

export type Kind = "daily" | "weekly" | "monthly";
type DupGroup = Array<{ id: string; name: string; salesRequired: number; amount: number; currency: string }>;
type RewardType = "cash" | "physical" | "voucher" | "badge" | "time_off" | "custom";
export interface Program {
  id: string;
  kind: Kind;
  name: string;
  description: string;
  rewardType: RewardType;
  amount: number;
  currency: string;
  prizeLabel: string;
  salesRequired: number;
  maxAwards: number;
  maxTotalAwards: number | null;
  startDate: string | null;
  endDate: string | null;
  scopeType: "all" | "campaign" | "agents";
  scopeIds: string[];
  stackable: boolean;
  enabled: boolean;
  showOnArena: boolean;
  headline: string;
  message: string;
  rewardLine: string;
  popupSeconds: number;
  accent: string;
  status: "active" | "paused" | "scheduled" | "expired" | "archived";
  revision: number;
  createdAt: string;
  updatedAt: string;
}

const REWARD_TYPES: Array<{ id: RewardType; label: string }> = [
  { id: "cash", label: "Cash bonus" },
  { id: "physical", label: "Physical prize" },
  { id: "voucher", label: "Voucher" },
  { id: "badge", label: "Recognition badge" },
  { id: "time_off", label: "Time-off perk" },
  { id: "custom", label: "Custom reward" },
];
const KIND_LABEL: Record<Kind, { title: string; period: string; word: string }> = {
  daily: { title: "Daily", period: "business day", word: "today" },
  weekly: { title: "Weekly", period: "business week", word: "this week" },
  monthly: { title: "Monthly", period: "calendar month", word: "this month" },
};
const STATUS_STYLE: Record<Program["status"], string> = {
  active: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  paused: "border-white/15 bg-white/5 text-text-muted",
  scheduled: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  expired: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  archived: "border-white/10 bg-white/[0.03] text-text-muted",
};

export function rewardText(p: Pick<Program, "rewardType" | "amount" | "currency" | "prizeLabel">) {
  return p.rewardType === "cash" ? `${p.currency} ${Number(p.amount).toLocaleString("en-US")}` : p.prizeLabel;
}

type Draft = Omit<Program, "id" | "status" | "revision" | "createdAt" | "updatedAt" | "maxTotalAwards" | "amount" | "salesRequired" | "maxAwards" | "popupSeconds"> & {
  amount: string;
  salesRequired: string;
  maxAwards: string;
  maxTotalAwards: string;
  popupSeconds: string;
  scopeText: string;
};

function toDraft(kind: Kind, p?: Program, currency = "Rs."): Draft {
  return {
    kind,
    name: p?.name ?? "",
    description: p?.description ?? "",
    rewardType: p?.rewardType ?? "cash",
    amount: p ? String(p.amount || "") : "",
    currency: p?.currency ?? currency,
    prizeLabel: p?.prizeLabel ?? "",
    salesRequired: p ? String(p.salesRequired) : "",
    maxAwards: p ? String(p.maxAwards) : "1",
    maxTotalAwards: p?.maxTotalAwards ? String(p.maxTotalAwards) : "",
    startDate: p?.startDate ?? null,
    endDate: p?.endDate ?? null,
    scopeType: p?.scopeType ?? "all",
    scopeIds: p?.scopeIds ?? [],
    scopeText: (p?.scopeIds ?? []).join(", "),
    stackable: p?.stackable ?? true,
    enabled: p?.enabled ?? false,
    showOnArena: p?.showOnArena ?? true,
    headline: p?.headline ?? "",
    message: p?.message ?? "",
    rewardLine: p?.rewardLine ?? "",
    popupSeconds: p ? String(p.popupSeconds) : "7",
    accent: p?.accent ?? "",
  };
}

function fromDraft(d: Draft) {
  return {
    kind: d.kind,
    name: d.name,
    description: d.description,
    rewardType: d.rewardType,
    amount: d.rewardType === "cash" ? Number(d.amount) : 0,
    currency: d.currency,
    prizeLabel: d.rewardType === "cash" ? "" : d.prizeLabel,
    salesRequired: Number(d.salesRequired),
    maxAwards: Number(d.maxAwards),
    maxTotalAwards: d.maxTotalAwards.trim() ? Number(d.maxTotalAwards) : null,
    startDate: d.startDate || null,
    endDate: d.endDate || null,
    scopeType: d.scopeType,
    scopeIds: d.scopeType === "all" ? [] : d.scopeText.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean),
    stackable: d.stackable,
    enabled: d.enabled,
    showOnArena: d.showOnArena,
    headline: d.headline || undefined,
    message: d.message || undefined,
    rewardLine: d.rewardLine || undefined,
    popupSeconds: Number(d.popupSeconds),
    accent: d.accent || undefined,
  };
}

/** One category (Daily / Weekly / Monthly): its two global switches and its list of programs. */
export function ProgramsTab({ kind }: { kind: Kind }) {
  const meta = KIND_LABEL[kind];
  const cat = useSettingsStore((s) => s.rewardCategories[kind]);
  const cats = useSettingsStore((s) => s.rewardCategories);
  const currency = useSettingsStore((s) => s.currencyLabel);
  const programsRev = useAdminSync((s) => s.programsRev);
  const [programs, setPrograms] = useState<Program[] | null>(null);
  const [duplicates, setDuplicates] = useState<DupGroup[]>([]);
  const [filter, setFilter] = useState<"current" | "active" | "inactive" | "archived" | "all">("current");
  const [editing, setEditing] = useState<Program | "new" | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [history, setHistory] = useState<{ id: string; rows: Array<{ revision: number; action: string; at: string; by: string | null }> } | null>(null);

  const load = useCallback(async () => {
    const r = await adminApi<{ programs: Program[]; duplicates?: DupGroup[] }>(`/api/admin/programs?kind=${kind}&archived=1`);
    if (r.ok) {
      setPrograms(r.data.programs);
      setDuplicates(r.data.duplicates ?? []);
    }
    else setMsg({ kind: "error", text: r.error });
  }, [kind]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, programsRev]);

  const rows = useMemo(() => {
    const list = programs ?? [];
    if (filter === "all") return list;
    if (filter === "archived") return list.filter((p) => p.status === "archived");
    if (filter === "active") return list.filter((p) => p.status === "active");
    if (filter === "inactive") return list.filter((p) => p.status !== "active" && p.status !== "archived");
    return list.filter((p) => p.status !== "archived");
  }, [programs, filter]);

  const patch = async (p: Program, body: Record<string, unknown>, okText: string) => {
    setBusy(p.id);
    setMsg(null);
    const r = await adminApi<{ program: Program }>(`/api/admin/programs/${encodeURIComponent(p.id)}`, { method: "PATCH", body });
    setBusy(null);
    if (!r.ok) return setMsg({ kind: "error", text: r.error });
    setPrograms((cur) => (cur ?? []).map((x) => (x.id === p.id ? r.data.program : x)));
    setMsg({ kind: "ok", text: okText });
  };

  const showHistory = async (p: Program) => {
    const r = await adminApi<{ history: Array<{ revision: number; action: string; at: string; by: string | null }> }>(`/api/admin/programs/${encodeURIComponent(p.id)}`);
    if (r.ok) setHistory({ id: p.id, rows: r.data.history });
    else setMsg({ kind: "error", text: r.error });
  };

  return (
    <div className="space-y-6" data-testid={`programs-${kind}`}>
      <Section
        title={`${meta.title} rewards`}
        description={`Two separate switches. Program Active decides whether new ${meta.title.toLowerCase()} awards can be earned. Show on Live Arena decides whether they are announced publicly. Hiding never deletes or revokes earned awards; pausing never removes awards already earned.`}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div data-testid={`cat-${kind}-active`}>
            <Toggle
              label="Program Active"
              hint={cat.active ? `Agents can earn ${meta.title.toLowerCase()} rewards from the active programs below.` : `No new ${meta.title.toLowerCase()} awards are earned (from the next validated sale).`}
              checked={cat.active}
              onChange={(v) => void saveSettings({ rewardCategories: { ...cats, [kind]: { ...cat, active: v } } }, { immediate: true })}
            />
          </div>
          <div data-testid={`cat-${kind}-visible`}>
            <Toggle
              label="Show on Live Arena"
              hint={cat.showOnArena ? "Award popups and reward cards appear on every screen." : "Awards are still earned and recorded, but nothing appears publicly."}
              checked={cat.showOnArena}
              onChange={(v) => void saveSettings({ rewardCategories: { ...cats, [kind]: { ...cat, showOnArena: v } } }, { immediate: true })}
            />
          </div>
        </div>
      </Section>

      <Section
        title={`${meta.title} reward programs`}
        description={`Counted per ${meta.period} in the business timezone. Several programs can run at the same time. Edits apply from the next validated sale and never change awards already earned.`}
        actions={
          <PrimaryButton onClick={() => setEditing("new")} data-testid="add-program">
            <Plus className="h-4 w-4" /> Add reward
          </PrimaryButton>
        }
      >
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
        {duplicates.length > 0 && (
          <div data-testid="duplicate-programs">
            <Notice kind="error">
              <b>Duplicate active programs:</b> these pay the same milestone. To prevent double cash awards only the oldest of each group awards; pause or archive the others.
              <ul className="mt-1 list-disc pl-5">
                {duplicates.map((g, i) => (
                  <li key={i}>{g.map((p, j) => `${p.name} (${p.salesRequired} sales, ${p.currency} ${p.amount.toLocaleString("en-US")})${j === 0 ? " awards" : " skipped"}`).join(" · ")}</li>
                ))}
              </ul>
            </Notice>
          </div>
        )}
        {editing && (
          <ProgramEditorForm
            kind={kind}
            program={editing === "new" ? undefined : editing}
            currency={currency}
            onCancel={() => setEditing(null)}
            onSaved={(p, created) => {
              setEditing(null);
              setPrograms((cur) => (created ? [...(cur ?? []), p] : (cur ?? []).map((x) => (x.id === p.id ? p : x))));
              setMsg({ kind: "ok", text: `${created ? "Created" : "Saved"} "${p.name}". All connected screens are updated.` });
            }}
          />
        )}

        <div className="flex flex-wrap gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1 text-sm" role="tablist" aria-label="Filter programs">
          {(["current", "active", "inactive", "archived", "all"] as const).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={cn("rounded-lg px-3 py-1.5 font-semibold capitalize", filter === f ? "bg-white/10 text-white" : "text-text-secondary hover:text-white")}>
              {f === "current" ? "Not archived" : f}
            </button>
          ))}
        </div>

        {programs === null ? (
          <p className="text-sm text-text-muted">Loading from PostgreSQL…</p>
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-text-muted">
            No {filter === "all" || filter === "current" ? "" : `${filter} `}{meta.title.toLowerCase()} programs. Use “Add reward” to create one.
          </p>
        ) : (
          <ul className="space-y-3" data-testid="program-list">
            {rows.map((p) => (
              <li key={p.id} data-testid="program-row" data-program={p.name} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-heading font-bold text-white">{p.name}</h3>
                      <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider", STATUS_STYLE[p.status])} data-testid="program-status">{p.status}</span>
                      {!p.showOnArena && <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-text-muted">hidden on arena</span>}
                      {!p.stackable && <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-text-muted">non-stackable</span>}
                    </div>
                    <p className="mt-1 text-sm text-text-secondary">
                      <b className="text-gold">{rewardText(p)}</b> for {p.salesRequired} validated sale{p.salesRequired === 1 ? "" : "s"} {meta.word}
                      {" · "}up to {p.maxAwards} per agent{p.maxTotalAwards ? ` · ${p.maxTotalAwards} in total` : ""}
                      {" · "}
                      {p.scopeType === "all" ? "all agents" : p.scopeType === "agents" ? `${p.scopeIds.length} agent${p.scopeIds.length === 1 ? "" : "s"}` : `${p.scopeIds.length} campaign${p.scopeIds.length === 1 ? "" : "s"}`}
                      {(p.startDate || p.endDate) && ` · ${p.startDate ?? "…"} → ${p.endDate ?? "…"}`}
                    </p>
                    <p className="mt-1 text-xs text-text-muted">Created {fmtDate(p.createdAt)} · updated {fmtDate(p.updatedAt)} · revision {p.revision}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {p.status !== "archived" && (
                      <>
                        <label className="flex items-center gap-2 text-xs text-text-secondary">
                          <input type="checkbox" className="h-4 w-4 accent-[#7568FF]" checked={p.enabled} disabled={busy === p.id} data-testid="program-active"
                            onChange={(e) => void patch(p, { enabled: e.target.checked }, e.target.checked ? `"${p.name}" is active: sales from now on count.` : `"${p.name}" paused. Earned awards are kept.`)} />
                          Active
                        </label>
                        <label className="flex items-center gap-2 text-xs text-text-secondary">
                          <input type="checkbox" className="h-4 w-4 accent-[#7568FF]" checked={p.showOnArena} disabled={busy === p.id} data-testid="program-visible"
                            onChange={(e) => void patch(p, { showOnArena: e.target.checked }, e.target.checked ? `"${p.name}" is shown on the Live Arena.` : `"${p.name}" is hidden on the Live Arena (still earning if active).`)} />
                          On arena
                        </label>
                        <GhostButton onClick={() => setEditing(p)} disabled={busy === p.id} data-testid="program-edit"><Pencil className="h-4 w-4" /> Edit</GhostButton>
                        <GhostButton
                          disabled={busy === p.id}
                          data-testid="program-archive"
                          onClick={() => confirm(`Archive "${p.name}"? It stops earning; its awards and history are kept.`) && void patch(p, { archived: true }, `"${p.name}" archived.`)}
                        >
                          <Archive className="h-4 w-4" /> Archive
                        </GhostButton>
                      </>
                    )}
                    {p.status === "archived" && (
                      <GhostButton disabled={busy === p.id} onClick={() => void patch(p, { archived: false }, `"${p.name}" restored (paused).`)}><ArchiveRestore className="h-4 w-4" /> Restore</GhostButton>
                    )}
                    <GhostButton onClick={() => (history?.id === p.id ? setHistory(null) : void showHistory(p))}><History className="h-4 w-4" /> History</GhostButton>
                  </div>
                </div>
                {history?.id === p.id && (
                  <ul className="mt-3 space-y-1 border-t border-white/[0.06] pt-3 text-xs text-text-muted" data-testid="program-history">
                    {history.rows.map((h) => (
                      <li key={h.revision}>
                        Revision {h.revision} · <b className="text-text-secondary">{h.action}</b> · {fmtDate(h.at)}{h.by ? ` · ${h.by}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function ProgramEditorForm({ kind, program, currency, onCancel, onSaved }: {
  kind: Kind;
  program?: Program;
  currency: string;
  onCancel: () => void;
  onSaved: (p: Program, created: boolean) => void;
}) {
  const [d, setD] = useState<Draft>(() => toDraft(kind, program, currency));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const cash = d.rewardType === "cash";
  const word = KIND_LABEL[kind].title.toUpperCase();
  const sales = Number(d.salesRequired) || 0;
  const rewardPreview = cash ? `${d.currency} ${(Number(d.amount) || 0).toLocaleString("en-US")} Bonus Earned` : `${d.prizeLabel || "Your reward"} Earned`;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const body = fromDraft(d);
    const r = program
      ? await adminApi<{ program: Program }>(`/api/admin/programs/${encodeURIComponent(program.id)}`, { method: "PATCH", body })
      : await adminApi<{ program: Program }>("/api/admin/programs", { method: "POST", body });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onSaved(r.data.program, !program);
  };

  const label = "block text-xs font-semibold uppercase tracking-wider text-text-muted";
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/[0.06] p-4" data-testid="program-editor">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-heading font-bold text-white">{program ? `Edit "${program.name}"` : `New ${KIND_LABEL[kind].title.toLowerCase()} reward`}</h3>
        <button onClick={onCancel} aria-label="Close editor" className="rounded-lg p-1.5 text-text-muted hover:bg-white/5 hover:text-white"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <label className="space-y-1.5 lg:col-span-2">
          <span className={label}>Name</span>
          <input className={inputClass} value={d.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Daily Double Sale Bonus" data-testid="pe-name" />
        </label>
        <label className="space-y-1.5">
          <span className={label}>Validated sales required</span>
          <input className={inputClass} type="number" min={1} value={d.salesRequired} onChange={(e) => set({ salesRequired: e.target.value })} data-testid="pe-sales" />
        </label>
        <label className="space-y-1.5">
          <span className={label}>Reward type</span>
          <select className={inputClass} value={d.rewardType} onChange={(e) => set({ rewardType: e.target.value as RewardType })} data-testid="pe-type">
            {REWARD_TYPES.map((t) => <option key={t.id} value={t.id} className="bg-[#0D1426]">{t.label}</option>)}
          </select>
        </label>
        {cash ? (
          <>
            <label className="space-y-1.5">
              <span className={label}>Cash amount</span>
              <input className={inputClass} type="number" min={0} value={d.amount} onChange={(e) => set({ amount: e.target.value })} data-testid="pe-amount" />
            </label>
            <label className="space-y-1.5">
              <span className={label}>Currency</span>
              <input className={inputClass} value={d.currency} maxLength={8} onChange={(e) => set({ currency: e.target.value })} />
            </label>
          </>
        ) : (
          <label className="space-y-1.5 lg:col-span-2">
            <span className={label}>Prize / reward</span>
            <input className={inputClass} value={d.prizeLabel} maxLength={128} onChange={(e) => set({ prizeLabel: e.target.value })} placeholder="e.g. Premium Headset" data-testid="pe-prize" />
          </label>
        )}
        <label className="space-y-1.5">
          <span className={label}>Awards per agent per period</span>
          <input className={inputClass} type="number" min={1} max={100} value={d.maxAwards} onChange={(e) => set({ maxAwards: e.target.value })} />
        </label>
        <label className="space-y-1.5">
          <span className={label}>Total awards per period (optional)</span>
          <input className={inputClass} type="number" min={1} value={d.maxTotalAwards} onChange={(e) => set({ maxTotalAwards: e.target.value })} placeholder="No limit" />
        </label>
        <label className="space-y-1.5">
          <span className={label}>Eligible</span>
          <select className={inputClass} value={d.scopeType} onChange={(e) => set({ scopeType: e.target.value as Draft["scopeType"] })}>
            <option value="all" className="bg-[#0D1426]">All agents</option>
            <option value="agents" className="bg-[#0D1426]">Selected agents (user codes)</option>
            <option value="campaign" className="bg-[#0D1426]">Selected campaigns (IDs)</option>
          </select>
        </label>
        {d.scopeType !== "all" && (
          <label className="space-y-1.5 md:col-span-2 lg:col-span-3">
            <span className={label}>{d.scopeType === "agents" ? "Agent user codes" : "Campaign IDs"} (comma separated)</span>
            <input className={inputClass} value={d.scopeText} onChange={(e) => set({ scopeText: e.target.value })} placeholder={d.scopeType === "agents" ? "e.g. HN01, AK22" : "campaign ids"} />
            {d.scopeType === "campaign" && <span className="block text-xs text-amber-200/80">Safe Quote does not send campaigns, so this only matches agents whose campaign was assigned in PostgreSQL.</span>}
          </label>
        )}
        <label className="space-y-1.5">
          <span className={label}>Starts (optional)</span>
          <input className={inputClass} type="date" value={d.startDate ?? ""} onChange={(e) => set({ startDate: e.target.value || null })} />
        </label>
        <label className="space-y-1.5">
          <span className={label}>Ends (optional)</span>
          <input className={inputClass} type="date" value={d.endDate ?? ""} onChange={(e) => set({ endDate: e.target.value || null })} />
        </label>
        <label className="space-y-1.5">
          <span className={label}>Popup seconds</span>
          <input className={inputClass} type="number" min={3} max={30} value={d.popupSeconds} onChange={(e) => set({ popupSeconds: e.target.value })} />
        </label>
        <label className="space-y-1.5 md:col-span-2 lg:col-span-3">
          <span className={label}>Description (optional)</span>
          <input className={inputClass} value={d.description} maxLength={500} onChange={(e) => set({ description: e.target.value })} />
        </label>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="flex items-start gap-2 text-sm text-text-secondary">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#7568FF]" checked={d.enabled} onChange={(e) => set({ enabled: e.target.checked })} data-testid="pe-active" />
          <span><b className="text-white">Program Active</b><br />New awards can be earned (sales validated from now on).</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-text-secondary">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#7568FF]" checked={d.showOnArena} onChange={(e) => set({ showOnArena: e.target.checked })} />
          <span><b className="text-white">Show on Live Arena</b><br />Announce awards publicly (popup + cards).</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-text-secondary">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#7568FF]" checked={d.stackable} onChange={(e) => set({ stackable: e.target.checked })} />
          <span><b className="text-white">Stackable</b><br />Off: not given if the agent already has another {KIND_LABEL[kind].title.toLowerCase()} award this period; the highest tier wins when several unlock together.</span>
        </label>
      </div>

      <div className="mt-4 rounded-xl border border-white/10 bg-[#0A0F22] p-4 text-center" data-testid="pe-preview">
        <p className="text-[11px] font-bold tracking-[0.25em] text-gold">AWARD PREVIEW</p>
        <p className="mt-1 font-heading text-xl font-extrabold text-white">{d.headline || `${word} BONUS UNLOCKED!`}</p>
        <p className="text-sm font-semibold text-secondary">Agent name</p>
        <p className="font-heading text-lg font-bold text-gold">{rewardPreview}</p>
        <p className="text-xs text-emerald-300">{sales || "N"} Validated Sale{sales === 1 ? "" : "s"} Completed</p>
      </div>

      {error && <div className="mt-3"><Notice kind="error">{error}</Notice></div>}
      <div className="mt-4 flex flex-wrap gap-2">
        <PrimaryButton onClick={submit} disabled={busy} data-testid="pe-save"><Save className="h-4 w-4" /> {busy ? "Saving…" : program ? "Save changes" : "Create reward"}</PrimaryButton>
        <GhostButton onClick={onCancel}>Cancel</GhostButton>
      </div>
    </div>
  );
}
