"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, CheckCircle2, Globe, KeyRound, Pencil, Plus, Search, ShieldAlert, ShieldCheck, ShieldOff, Trash2, Wifi, X } from "lucide-react";
import { adminApi } from "@/components/admin/admin-api";
import { Notice, fmtDate } from "@/components/admin/spins/shared";
import { inputClass } from "@/components/admin/ui";
import { parseNetwork } from "@/lib/security/ip";
import { cn } from "@/lib/utils";

interface Rule {
  id: number;
  network: string;
  cidr: string;
  label: string;
  description: string;
  notes: string;
  active: boolean;
  allowManagement: boolean;
  expiresAt: string | null;
  status: "active" | "inactive" | "expired" | "archived";
  createdVia: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}
interface Overview {
  admin: { email: string; role: string };
  settings: { enabled: boolean; protectArena: boolean; protectPairing: boolean; protectAdmin: boolean; revision: number; updatedAt: string | null; updatedBy: string | null };
  rules: Rule[];
  current: { ip: string | null; matchedRule: { id: number; label: string; network: string; status: string; allowManagement: boolean } | null; arenaAllowedWhenOn: boolean; adminAllowedWhenOn: boolean; arenaAllowedNow: boolean; adminAllowedNow: boolean };
  stats: { enabled: boolean; activeRules: number; managementRules: number; totalRules: number; archivedRules: number; denied: { total: number; since: string; distinctIps: number } };
  recent: Array<{ action: string; targetId: string | null; details: Record<string, unknown>; ip: string | null; at: string; by: string | null }>;
}

const STATUS_STYLE: Record<Rule["status"], string> = {
  active: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  inactive: "border-white/15 bg-white/5 text-text-muted",
  expired: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  archived: "border-white/10 bg-white/[0.03] text-text-muted",
};
const ACTION_LABEL: Record<string, string> = {
  "ip_security.rule.created": "Rule created",
  "ip_security.rule.updated": "Rule edited",
  "ip_security.rule.activated": "Rule activated",
  "ip_security.rule.deactivated": "Rule deactivated",
  "ip_security.rule.archived": "Rule deleted (archived)",
  "ip_security.current_ip_whitelisted": "Current IP whitelisted",
  "ip_security.restriction.enabled": "IP restriction turned ON",
  "ip_security.restriction.disabled": "IP restriction turned OFF",
  "ip_security.scope.updated": "Protection scope changed",
  "ip_security.recovery.disable": "Console recovery: restriction OFF",
  "ip_security.recovery.allow": "Console recovery: network allowed",
  "ip_security.recovery.activate": "Console recovery: rule re-activated",
};

type Msg = { kind: "ok" | "error" | "info"; text: string } | null;

export default function IpSecurityPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  const [confirmOn, setConfirmOn] = useState(false);
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"live" | "active" | "inactive" | "expired" | "archived">("live");

  const load = useCallback(async () => {
    const r = await adminApi<Overview>("/api/admin/ip-security");
    if (r.ok) {
      setData(r.data);
      setLoadError(null);
    } else setLoadError(r.status === 403 ? "Only the Owner can view and manage IP perimeter security." : r.error);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.rules ?? [])
      .filter((r) => (filter === "live" ? r.status !== "archived" : r.status === filter))
      .filter((r) => !s || [r.network, r.label, r.description, r.notes, r.createdBy ?? ""].some((x) => x.toLowerCase().includes(s)));
  }, [data, q, filter]);

  const settingsPut = async (body: Record<string, unknown>, okText: string) => {
    setBusy(true);
    setMsg(null);
    const r = await adminApi("/api/admin/ip-security/settings", { method: "PUT", body });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "error", text: r.error });
    setMsg({ kind: "ok", text: okText });
    await load();
  };
  const rulePatch = async (rule: Rule, body: Record<string, unknown>, okText: string) => {
    setBusy(true);
    setMsg(null);
    const r = body.archived
      ? await adminApi(`/api/admin/ip-security/rules/${rule.id}`, { method: "DELETE" })
      : await adminApi(`/api/admin/ip-security/rules/${rule.id}`, { method: "PATCH", body });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: "error", text: r.error });
    setMsg({ kind: "ok", text: okText });
    await load();
  };

  if (loadError)
    return (
      <div className="space-y-4" data-testid="ip-security-denied">
        <Header data={null} />
        <Notice kind="error">{loadError}</Notice>
      </div>
    );
  if (!data) return <p className="text-sm text-text-muted">Loading the security policy from PostgreSQL…</p>;

  const s = data.settings;
  const c = data.current;
  return (
    <div className="space-y-6" data-testid="ip-security">
      <Header data={data} />
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      {/* Status cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={s.enabled ? ShieldCheck : ShieldOff} tone={s.enabled ? "ok" : "muted"} label="IP restriction" value={s.enabled ? "ON" : "OFF"} testId="stat-restriction" />
        <StatCard icon={Wifi} tone={c.arenaAllowedWhenOn ? "ok" : "bad"} label="Your current IP" value={c.ip ? (c.arenaAllowedWhenOn ? "Allowed" : "Not whitelisted") : "Unverified"} testId="stat-current" />
        <StatCard icon={CheckCircle2} tone="info" label="Active rules" value={`${data.stats.activeRules}`} sub={`${data.stats.managementRules} with Admin access`} />
        <StatCard icon={Globe} tone="info" label="Total rules" value={`${data.stats.totalRules}`} sub={`${data.stats.denied.total} blocked request(s) since ${fmtDate(data.stats.denied.since)}`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Master switch + scope */}
        <section className="rounded-2xl border border-white/[0.07] bg-[#0B1122]/80 p-5 xl:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-heading text-base font-bold text-white">Master IP restriction</h2>
              <p className="mt-1 max-w-xl text-sm text-text-muted">
                On: only whitelisted networks reach the protected areas below. Off: the whitelist is not enforced, and sign-in and admin permissions still apply as usual.
                Separate from the Live Arena on/off switch.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={s.enabled}
              aria-label="Enable IP restriction"
              disabled={busy}
              data-testid="master-switch"
              onClick={() => (s.enabled ? confirm("Turn IP restriction OFF? Every network will be able to reach FE Sales Arena again (sign-in still required for Admin).") && void settingsPut({ enabled: false }, "IP restriction is OFF.") : setConfirmOn(true))}
              className={cn("relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50", s.enabled ? "border-emerald-400/60 bg-emerald-500" : "border-white/10 bg-white/10")}
            >
              <span className={cn("inline-block h-6 w-6 rounded-full bg-white shadow transition-transform", s.enabled ? "translate-x-7" : "translate-x-1")} />
            </button>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <ScopeToggle label="Live Arena" hint="/, Live Arena screens, leaderboard, spin display and their APIs + live stream" checked={s.protectArena} disabled={busy}
              onChange={(v) => void settingsPut({ protectArena: v }, `Live Arena is ${v ? "" : "no longer "}protected by the whitelist.`)} testId="scope-arena" />
            <ScopeToggle label="Display pairing" hint="/pair and the pairing API" checked={s.protectPairing} disabled={busy}
              onChange={(v) => void settingsPut({ protectPairing: v }, `Display pairing is ${v ? "" : "no longer "}protected.`)} testId="scope-pairing" />
            <ScopeToggle label="Admin Panel" hint="/admin and /api/admin: only rules with Admin access. Sign-in is always required." checked={s.protectAdmin} disabled={busy}
              onChange={(v) => void settingsPut({ protectAdmin: v }, `Admin Panel is ${v ? "" : "no longer "}restricted to Admin-access networks.`)} testId="scope-admin" />
          </div>
          <p className="mt-3 text-xs text-text-muted">Revision {s.revision}{s.updatedAt ? ` · last change ${fmtDate(s.updatedAt)}${s.updatedBy ? ` by ${s.updatedBy}` : ""}` : ""}. Changes apply to every server process within seconds, without a restart.</p>
        </section>

        {/* Current connection */}
        <section className="rounded-2xl border border-white/[0.07] bg-[#0B1122]/80 p-5" data-testid="current-connection">
          <h2 className="font-heading text-base font-bold text-white">Current connection</h2>
          <dl className="mt-4 space-y-2.5 text-sm">
            <Row k="Public IP (seen by the server)" v={<span className="font-mono text-white" data-testid="current-ip">{c.ip ?? "Not verified"}</span>} />
            <Row k="Matched rule" v={c.matchedRule ? `${c.matchedRule.label} (${c.matchedRule.network}, ${c.matchedRule.status})` : "None"} />
            <Row k="Live Arena with restriction ON" v={<Allowed ok={c.arenaAllowedWhenOn} />} />
            <Row k="Admin Panel with Admin scope ON" v={<Allowed ok={c.adminAllowedWhenOn} />} />
            <Row k="Right now" v={<span>{c.arenaAllowedNow ? "Arena allowed" : "Arena blocked"} · {c.adminAllowedNow ? "Admin allowed" : "Admin blocked"}</span>} />
          </dl>
          <button
            onClick={() => setMine(true)}
            disabled={!c.ip || busy || !!c.matchedRule}
            data-testid="whitelist-me"
            title={!c.ip ? "Your IP could not be verified through the trusted proxy." : c.matchedRule ? "Already covered by a rule." : undefined}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
          >
            <KeyRound className="h-4 w-4" /> Whitelist my current IP
          </button>
          {!c.ip && <p className="mt-2 text-xs text-amber-200/80">The trusted proxy did not supply a verifiable client IP for this connection.</p>}
        </section>
      </div>

      {/* Whitelist table */}
      <section className="rounded-2xl border border-white/[0.07] bg-[#0B1122]/80 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-heading text-base font-bold text-white">Allowed networks</h2>
            <p className="mt-1 text-sm text-text-muted">IPv4 and IPv6 addresses or CIDR ranges, stored as PostgreSQL <code>cidr</code>. Rules cannot overlap, so each address matches at most one rule.</p>
          </div>
          <button onClick={() => setEditing("new")} data-testid="add-rule" className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90">
            <Plus className="h-4 w-4" /> Add new rule
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search IP, label, notes…" className={cn(inputClass, "pl-9")} data-testid="rule-search" aria-label="Search rules" />
          </label>
          <div className="flex flex-wrap gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1 text-sm" role="tablist" aria-label="Filter rules">
            {(["live", "active", "inactive", "expired", "archived"] as const).map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={cn("rounded-lg px-3 py-1.5 font-semibold capitalize", filter === f ? "bg-white/10 text-white" : "text-text-secondary hover:text-white")}>
                {f === "live" ? "All current" : f === "archived" ? "Deleted" : f}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 overflow-x-auto rounded-xl border border-white/[0.07]">
          <table className="w-full min-w-[860px] text-sm" data-testid="rules-table">
            <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wider text-text-muted">
              <tr>
                {["Network", "Label", "Access", "Status", "Expires", "Updated", "Actions"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-text-muted">No rules{q ? " match your search" : ""}.</td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} data-testid="rule-row" data-network={r.network}>
                  <td className="px-4 py-2.5 font-mono text-white">{r.network}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-white">{r.label}</div>
                    {(r.description || r.notes) && <div className="max-w-xs truncate text-xs text-text-muted" title={[r.description, r.notes].filter(Boolean).join(" · ")}>{[r.description, r.notes].filter(Boolean).join(" · ")}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-text-secondary">{r.allowManagement ? "Live Arena + Admin" : "Live Arena"}</td>
                  <td className="px-4 py-2.5"><span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider", STATUS_STYLE[r.status])} data-testid="rule-status">{r.status === "archived" ? "deleted" : r.status}</span></td>
                  <td className="px-4 py-2.5 text-text-muted">{r.expiresAt ? fmtDate(r.expiresAt) : "Never"}</td>
                  <td className="px-4 py-2.5 text-xs text-text-muted">{fmtDate(r.updatedAt)}{r.updatedBy ? <div>{r.updatedBy}</div> : null}</td>
                  <td className="px-4 py-2.5">
                    {r.status !== "archived" && (
                      <div className="flex flex-wrap gap-1.5">
                        <IconBtn label="Edit" onClick={() => setEditing(r)} disabled={busy}><Pencil className="h-3.5 w-3.5" /></IconBtn>
                        <IconBtn label={r.active ? "Deactivate" : "Activate"} disabled={busy} testId="rule-toggle"
                          onClick={() => void rulePatch(r, { active: !r.active }, `${r.label} is now ${r.active ? "inactive" : "active"}.`)}>
                          {r.active ? <Ban className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        </IconBtn>
                        <IconBtn label="Delete" danger disabled={busy} testId="rule-delete"
                          onClick={() => confirm(`Delete the rule "${r.label}" (${r.network})? It is archived and kept in the audit log.`) && void rulePatch(r, { archived: true }, `${r.label} deleted (archived).`)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconBtn>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-white/[0.07] bg-[#0B1122]/80 p-5">
          <h2 className="font-heading text-base font-bold text-white">Recent changes</h2>
          <ul className="mt-3 divide-y divide-white/[0.05] text-sm" data-testid="recent-changes">
            {data.recent.length === 0 && <li className="py-3 text-text-muted">No changes yet.</li>}
            {data.recent.map((a, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                <span className="text-white">{ACTION_LABEL[a.action] ?? a.action}{a.targetId && a.targetId !== "settings" ? <span className="text-text-muted"> · rule #{a.targetId}</span> : null}</span>
                <span className="text-xs text-text-muted">{fmtDate(a.at)} · {a.by ?? "system"}{a.ip ? ` · ${a.ip}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-5 text-sm text-text-secondary">
          <h2 className="flex items-center gap-2 font-heading text-base font-bold text-white"><ShieldAlert className="h-4 w-4 text-amber-300" /> Lockout protection & recovery</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            <li>IP restriction can only be turned on from a network covered by an active Admin-access rule.</li>
            <li>While it is on, changes that remove the last Admin-access rule, leave only expiring ones, or cut off your own network (with the Admin scope on) are refused.</li>
            <li>Lost access anyway? A server operator can run <code className="text-white">scripts/ip-security.mjs</code> on the server console (see the deployment runbook). There is no bypass URL.</li>
          </ul>
        </section>
      </div>

      {editing && <RuleModal rule={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onSaved={async (text) => { setEditing(null); setMsg({ kind: "ok", text }); await load(); }} />}
      {mine && c.ip && <MyIpModal ip={c.ip} onClose={() => setMine(false)} onSaved={async (text) => { setMine(false); setMsg({ kind: "ok", text }); await load(); }} />}
      {confirmOn && (
        <EnableModal data={data} onClose={() => setConfirmOn(false)} onConfirm={async () => { setConfirmOn(false); await settingsPut({ enabled: true, confirm: true }, "IP restriction is ON. Only whitelisted networks can reach the protected areas."); }} />
      )}
    </div>
  );
}

function Header({ data }: { data: Overview | null }) {
  const on = data?.settings.enabled;
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-4">
        <div className={cn("grid h-14 w-14 shrink-0 place-items-center rounded-2xl border", on ? "border-emerald-400/40 bg-emerald-400/10" : "border-primary/40 bg-primary/10")}>
          <ShieldCheck className={cn("h-7 w-7", on ? "text-emerald-300" : "text-secondary")} />
        </div>
        <div>
          <h2 className="font-heading text-2xl font-extrabold text-white">IP Perimeter Security</h2>
          <p className="mt-1 text-sm text-text-muted">Restrict FE Sales Arena access to authorized network IP addresses.</p>
          {data && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className={cn("rounded-full border px-2.5 py-0.5 font-bold tracking-wider", on ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-white/15 bg-white/5 text-text-muted")} data-testid="protection-status">
                {on ? "PROTECTION ON" : "PROTECTION OFF"}
              </span>
              <span className="text-text-muted">Signed in as <b className="text-text-secondary">{data.admin.email}</b> ({data.admin.role})</span>
            </p>
          )}
        </div>
      </div>
      <Link href="/admin" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm font-semibold text-text-secondary hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Back to Admin Dashboard
      </Link>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, tone, testId }: { icon: typeof ShieldCheck; label: string; value: string; sub?: string; tone: "ok" | "bad" | "muted" | "info"; testId?: string }) {
  const color = { ok: "text-emerald-300", bad: "text-rose-300", muted: "text-text-muted", info: "text-secondary" }[tone];
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#0B1122]/80 p-4" data-testid={testId}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted"><Icon className={cn("h-4 w-4", color)} /> {label}</div>
      <div className={cn("mt-2 font-heading text-2xl font-extrabold", color)}>{value}</div>
      {sub && <div className="mt-1 text-xs text-text-muted">{sub}</div>}
    </div>
  );
}
function ScopeToggle({ label, hint, checked, onChange, disabled, testId }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; testId: string }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3", checked ? "border-primary/40 bg-primary/[0.07]" : "border-white/10 bg-white/[0.02]")}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#7568FF]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span><b className="text-white">{label}</b><span className="mt-0.5 block text-xs text-text-muted">{hint}</span></span>
    </label>
  );
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-text-muted">{k}</dt>
      <dd className="text-right text-text-secondary">{v}</dd>
    </div>
  );
}
const Allowed = ({ ok }: { ok: boolean }) => <span className={ok ? "font-semibold text-emerald-300" : "font-semibold text-rose-300"}>{ok ? "Allowed" : "Blocked"}</span>;
function IconBtn({ children, label, onClick, danger, disabled, testId }: { children: React.ReactNode; label: string; onClick: () => void; danger?: boolean; disabled?: boolean; testId?: string }) {
  return (
    <button onClick={onClick} disabled={disabled} title={label} aria-label={label} data-testid={testId}
      className={cn("inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-50", danger ? "border-rose-500/30 text-rose-300 hover:bg-rose-500/10" : "border-white/10 text-text-secondary hover:text-white")}>
      {children} <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function Modal({ title, children, onClose, testId }: { title: string; children: React.ReactNode; onClose: () => void; testId: string }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0D1426] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-heading text-lg font-bold text-white"><ShieldCheck className="h-5 w-5 text-secondary" /> {title}</h3>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-text-muted hover:bg-white/5 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
const lbl = "block text-xs font-semibold uppercase tracking-wider text-text-muted";
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "");

function RuleModal({ rule, onClose, onSaved }: { rule?: Rule; onClose: () => void; onSaved: (text: string) => void }) {
  const [network, setNetwork] = useState(rule?.network ?? "");
  const [label, setLabel] = useState(rule?.label ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [notes, setNotes] = useState(rule?.notes ?? "");
  const [active, setActive] = useState(rule?.active ?? true);
  const [mgmt, setMgmt] = useState(rule?.allowManagement ?? false);
  const [expires, setExpires] = useState(toLocal(rule?.expiresAt ?? null));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = network.trim() ? parseNetwork(network) : null;

  const save = async () => {
    setError(null);
    if (!parsed?.ok) return setError(parsed ? parsed.error : "Enter an IP address or CIDR range.");
    if (!label.trim()) return setError("Enter a rule label.");
    setBusy(true);
    const body = { network: network.trim(), label, description, notes, active, allowManagement: mgmt, expiresAt: expires ? new Date(expires).toISOString() : null };
    const r = rule
      ? await adminApi(`/api/admin/ip-security/rules/${rule.id}`, { method: "PATCH", body })
      : await adminApi("/api/admin/ip-security/rules", { method: "POST", body });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onSaved(`${rule ? "Saved" : "Added"} rule "${label.trim()}". It applies within seconds.`);
  };

  return (
    <Modal title={rule ? "Edit rule" : "Add new rule"} onClose={onClose} testId="rule-modal">
      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className={lbl}>IP address / CIDR range</span>
          <input className={cn(inputClass, "font-mono", parsed && !parsed.ok && "border-rose-500/60")} value={network} onChange={(e) => setNetwork(e.target.value)} placeholder="203.0.113.25 · 192.0.2.0/24 · 2001:db8::/32" data-testid="rule-network" />
          {parsed && !parsed.ok && <span className="block text-xs text-rose-300" data-testid="rule-network-error">{parsed.error}</span>}
          {parsed?.ok && <span className="block text-xs text-emerald-300">IPv{parsed.network.family} · {parsed.network.cidr}</span>}
        </label>
        <label className="block space-y-1.5">
          <span className={lbl}>Rule label / branch name</span>
          <input className={inputClass} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="Head Office, FE Floor, Remote Office…" data-testid="rule-label" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <fieldset className="space-y-1.5">
            <legend className={lbl}>Enforcement status</legend>
            <div className="flex gap-2">
              {[{ v: true, t: "Active" }, { v: false, t: "Inactive" }].map((o) => (
                <button key={o.t} type="button" onClick={() => setActive(o.v)} aria-pressed={active === o.v} className={cn("flex-1 rounded-xl border px-3 py-2 text-sm font-semibold", active === o.v ? "border-primary/60 bg-primary/15 text-white" : "border-white/10 text-text-secondary")}>{o.t}</button>
              ))}
            </div>
            <span className="block text-xs text-text-muted">{active ? "Matching networks are allowed." : "Saved, but allows nothing."}</span>
          </fieldset>
          <label className="block space-y-1.5">
            <span className={lbl}>Expires (optional)</span>
            <input type="datetime-local" className={inputClass} value={expires} onChange={(e) => setExpires(e.target.value)} data-testid="rule-expires" />
          </label>
        </div>
        <label className="flex items-start gap-2 text-sm text-text-secondary">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#7568FF]" checked={mgmt} onChange={(e) => setMgmt(e.target.checked)} data-testid="rule-mgmt" />
          <span><b className="text-white">Admin access (management network)</b><br />Also allowed into the Admin Panel when the Admin scope is protected.</span>
        </label>
        <label className="block space-y-1.5">
          <span className={lbl}>Description (optional)</span>
          <input className={inputClass} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="block space-y-1.5">
          <span className={lbl}>Notes (optional)</span>
          <textarea className={cn(inputClass, "min-h-[64px]")} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-text-secondary hover:text-white">Cancel</button>
          <button onClick={save} disabled={busy} data-testid="rule-save" className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50">{busy ? "Saving…" : "Save rule"}</button>
        </div>
      </div>
    </Modal>
  );
}

function MyIpModal({ ip, onClose, onSaved }: { ip: string; onClose: () => void; onSaved: (text: string) => void }) {
  const [label, setLabel] = useState("");
  const [mgmt, setMgmt] = useState(true);
  const [sure, setSure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    const r = await adminApi<{ rule: Rule }>("/api/admin/ip-security/rules/current", { method: "POST", body: { label, allowManagement: mgmt, confirm: sure } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onSaved(`Whitelisted ${r.data.rule.network} as "${r.data.rule.label}".`);
  };
  return (
    <Modal title="Whitelist my current IP" onClose={onClose} testId="my-ip-modal">
      <div className="space-y-4 text-sm">
        <p className="text-text-secondary">This adds an exact single-address rule for the IP the server sees for you: <b className="font-mono text-white">{ip}</b>.</p>
        <label className="block space-y-1.5">
          <span className={lbl}>Rule label</span>
          <input className={inputClass} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Head Office" data-testid="my-ip-label" />
        </label>
        <label className="flex items-start gap-2 text-text-secondary">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#7568FF]" checked={mgmt} onChange={(e) => setMgmt(e.target.checked)} />
          <span>Admin access (management network)</span>
        </label>
        <label className="flex items-start gap-2 text-text-secondary">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#7568FF]" checked={sure} onChange={(e) => setSure(e.target.checked)} data-testid="my-ip-confirm" />
          <span>I confirm this is a trusted FE network.</span>
        </label>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2 font-semibold text-text-secondary hover:text-white">Cancel</button>
          <button onClick={save} disabled={busy || !sure || !label.trim()} data-testid="my-ip-save" className="rounded-xl bg-primary px-4 py-2 font-semibold text-white hover:bg-primary/90 disabled:opacity-50">{busy ? "Saving…" : "Save rule"}</button>
        </div>
      </div>
    </Modal>
  );
}

function EnableModal({ data, onClose, onConfirm }: { data: Overview; onClose: () => void; onConfirm: () => void }) {
  const [sure, setSure] = useState(false);
  const c = data.current;
  const ready = data.stats.managementRules > 0 && c.adminAllowedWhenOn;
  return (
    <Modal title="Turn IP restriction on" onClose={onClose} testId="enable-modal">
      <div className="space-y-4 text-sm text-text-secondary">
        <ul className="space-y-2">
          <li className="flex items-center gap-2">{data.stats.managementRules > 0 ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <Ban className="h-4 w-4 text-rose-300" />} {data.stats.managementRules} active Admin-access rule(s)</li>
          <li className="flex items-center gap-2">{c.adminAllowedWhenOn ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <Ban className="h-4 w-4 text-rose-300" />} Your IP {c.ip ?? "(unverified)"} is {c.adminAllowedWhenOn ? "" : "NOT "}covered by an Admin-access rule</li>
          <li className="flex items-center gap-2"><Globe className="h-4 w-4 text-secondary" /> Protected: {[data.settings.protectArena && "Live Arena", data.settings.protectPairing && "Display pairing", data.settings.protectAdmin && "Admin Panel"].filter(Boolean).join(", ") || "nothing yet"}</li>
        </ul>
        <p>Every other network will get an “Access restricted” page (HTTP 403). Open Live Arena streams from blocked networks are cut within seconds.</p>
        <p className="text-xs text-text-muted">If access is ever lost, a server operator can run <code>node --env-file=… scripts/ip-security.mjs disable</code> on the server console.</p>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#7568FF]" checked={sure} onChange={(e) => setSure(e.target.checked)} data-testid="enable-confirm" />
          <span>I have checked the whitelist and want to turn IP restriction on.</span>
        </label>
        {!ready && <Notice kind="error">Add your current IP with “Whitelist my current IP” (with Admin access) before turning restriction on.</Notice>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2 font-semibold hover:text-white">Cancel</button>
          <button onClick={onConfirm} disabled={!sure || !ready} data-testid="enable-save" className="rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">Turn on</button>
        </div>
      </div>
    </Modal>
  );
}
