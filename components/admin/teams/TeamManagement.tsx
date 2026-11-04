"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Crown, Plus, RefreshCw, Upload, UserMinus, ArrowRightLeft, ShieldCheck } from "lucide-react";
import { adminApi } from "@/components/admin/admin-api";
import { Section, Field, GhostButton, PrimaryButton, inputClass } from "@/components/admin/ui";
import { Notice, Table, td, fmtDate } from "@/components/admin/spins/shared";
import { useAdminSync } from "@/components/admin/AdminLiveSync";
import { cn } from "@/lib/utils";

type Designation = "senior" | "junior";
interface Team {
  id: string;
  name: string;
  slug: string | null;
  logoUrl: string | null;
  color: string;
  accentSecondary: string | null;
  leaderUserCode: string | null;
  leaderName: string | null;
  displayOrder: number;
  active: boolean;
  memberCount: number;
}
interface Member {
  userCode: string;
  name: string;
  agentActive: boolean;
  teamId: string;
  effectiveFrom: string;
  designation: Designation | null;
  designationFrom: string | null;
}
interface View {
  teams: Team[];
  members: Member[];
  unassigned: Array<{ userCode: string; name: string; active: boolean; designation: Designation | null }>;
}
type Msg = { kind: "ok" | "error" | "info"; text: string } | null;

const TABS = ["Teams", "Members", "Initial roster import", "History"] as const;
type Tab = (typeof TABS)[number];
const today = () => new Date().toISOString().slice(0, 10);
const DES: Record<Designation, string> = { senior: "Senior (SR)", junior: "Junior (Jr)" };

export function TeamManagement() {
  const [tab, setTab] = useState<Tab>("Teams");
  const [view, setView] = useState<View | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const teamsRev = useAdminSync((s) => s.teamsRev); // another admin (or tab) changed teams
  const load = useCallback(async () => {
    const r = await adminApi<View>("/api/admin/teams");
    if (r.ok) setView(r.data);
    else setMsg({ kind: "error", text: r.error });
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, teamsRev]);

  return (
    <div className="space-y-6" data-testid="team-management">
      <div>
        <h2 className="font-heading text-xl font-bold text-white">Team Management</h2>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">
          Teams, members and Senior / Junior designations for the Teams Arena, stored in PostgreSQL. Changes take effect from the business date you
          choose: each day&apos;s sales count for the team the agent belonged to on that day, so earlier results never move. Team changes never
          change earned bonuses.
        </p>
      </div>
      <div role="tablist" aria-label="Team management" className="flex flex-wrap gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors", tab === t ? "bg-primary text-white shadow" : "text-text-secondary hover:text-white")}>
            {t}
          </button>
        ))}
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {tab === "Teams" && <TeamsTab view={view} reload={load} setMsg={setMsg} />}
      {tab === "Members" && <MembersTab view={view} reload={load} setMsg={setMsg} />}
      {tab === "Initial roster import" && <ImportTab reload={load} />}
      {tab === "History" && <HistoryTab />}
    </div>
  );
}

// ------------------------------------------------------------------ teams

async function readLogo(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Choose a PNG, JPEG or WebP image.");
  if (file.size > 290 * 1024) throw new Error("The logo must be under 300 KB. Export a smaller (e.g. 512×512 WebP) version.");
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("Could not read the file."));
    r.readAsDataURL(file);
  });
}

function TeamsTab({ view, reload, setMsg }: { view: View | null; reload: () => Promise<void>; setMsg: (m: Msg) => void }) {
  const [draft, setDraft] = useState({ name: "", color: "#22D3FF" });
  const [busy, setBusy] = useState<string | null>(null);
  const create = async () => {
    setBusy("new");
    const r = await adminApi("/api/admin/teams", { method: "POST", body: draft });
    setBusy(null);
    setMsg(r.ok ? { kind: "ok", text: `Team “${draft.name}” created. Add members on the Members tab.` } : { kind: "error", text: r.error });
    if (r.ok) {
      setDraft({ name: "", color: "#22D3FF" });
      await reload();
    }
  };
  const patch = async (t: Team, body: Record<string, unknown>, label: string) => {
    setBusy(t.id);
    const r = await adminApi(`/api/admin/teams/${encodeURIComponent(t.id)}`, { method: "PATCH", body });
    setBusy(null);
    setMsg(r.ok ? { kind: "ok", text: `${t.name}: ${label}.` } : { kind: "error", text: r.error });
    if (r.ok) await reload();
  };
  if (!view) return <p className="text-sm text-text-muted">Loading…</p>;
  return (
    <div className="space-y-6">
      {view.teams.length === 0 && <Notice kind="info">No teams yet. Use “Initial roster import” (Owner) to create Team Alpha, Team Panthers and Team Sigma from the supplied roster, or add a team below.</Notice>}
      <div className="grid gap-4 lg:grid-cols-3" data-testid="admin-team-list">
        {view.teams.map((t) => (
          <TeamEditor key={t.id} team={t} members={view.members.filter((m) => m.teamId === t.id)} busy={busy === t.id} onPatch={(b, l) => void patch(t, b, l)} setMsg={setMsg} />
        ))}
      </div>
      <Section title="Add a team" description="Teams are display / analytics groups. Winning a team competition never creates a cash reward.">
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
          <Field label="Team name">
            <input className={inputClass} value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Team Falcons" data-testid="new-team-name" />
          </Field>
          <Field label="Accent colour">
            <input type="color" className={cn(inputClass, "h-10 p-1")} value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
          </Field>
          <PrimaryButton onClick={() => void create()} disabled={busy === "new" || draft.name.trim().length < 2} data-testid="create-team">
            <Plus className="h-4 w-4" /> Add team
          </PrimaryButton>
        </div>
      </Section>
    </div>
  );
}

function TeamEditor({ team, members, busy, onPatch, setMsg }: { team: Team; members: Member[]; busy: boolean; onPatch: (b: Record<string, unknown>, label: string) => void; setMsg: (m: Msg) => void }) {
  const [name, setName] = useState(team.name);
  return (
    <section className="space-y-3 rounded-2xl border bg-white/[0.02] p-4" style={{ borderColor: `${team.color}55` }} data-testid="admin-team" data-team={team.slug ?? team.id}>
      <div className="flex items-center gap-3">
        {team.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- official / uploaded team artwork
          <img src={team.logoUrl} alt={`${team.name} logo`} className="h-16 w-16 rounded-xl object-cover" data-testid="admin-team-logo" />
        ) : (
          <div className="grid h-16 w-16 place-items-center rounded-xl text-xs text-text-muted" style={{ border: `1px dashed ${team.color}` }}>No logo</div>
        )}
        <div className="min-w-0">
          <p className="truncate font-heading text-lg font-bold text-white">{team.name}</p>
          <p className="text-xs text-text-muted">
            {team.memberCount} members · order {team.displayOrder} · {team.active ? <span className="text-emerald-300">active</span> : <span className="text-amber-200">inactive</span>}
          </p>
          {team.leaderName && <p className="flex items-center gap-1 text-xs text-gold"><Crown className="h-3 w-3" /> {team.leaderName}</p>}
        </div>
      </div>
      <div className="flex gap-2">
        <input className={inputClass} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="Team name" />
        <GhostButton disabled={busy || name.trim() === team.name} onClick={() => onPatch({ name }, "renamed")}>Save</GhostButton>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          Accent <input type="color" value={team.color} onChange={(e) => onPatch({ color: e.target.value }, "accent colour saved")} className="h-8 w-10 cursor-pointer rounded border border-white/10 bg-transparent" />
        </label>
        <label className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-white", busy && "opacity-50")}>
          <Upload className="h-3.5 w-3.5" /> Logo
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            data-testid="team-logo-upload"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                onPatch({ logoUrl: await readLogo(f) }, "logo updated");
              } catch (err) {
                setMsg({ kind: "error", text: err instanceof Error ? err.message : "Logo not accepted." });
              }
            }}
          />
        </label>
        <select
          className={cn(inputClass, "h-8 w-auto py-0 text-xs")}
          value={team.leaderUserCode ?? ""}
          onChange={(e) => onPatch({ leaderUserCode: e.target.value || null }, e.target.value ? "team leader set" : "team leader cleared")}
          aria-label="Team leader"
        >
          <option value="" className="bg-[#0D1426]">No team leader</option>
          {members.map((m) => (
            <option key={m.userCode} value={m.userCode} className="bg-[#0D1426]">{m.name}</option>
          ))}
        </select>
        <input type="number" min={0} max={999} defaultValue={team.displayOrder} aria-label="Display order" className={cn(inputClass, "h-8 w-16 py-0 text-xs")} onBlur={(e) => Number(e.target.value) !== team.displayOrder && onPatch({ displayOrder: Number(e.target.value) }, "order saved")} />
        <GhostButton className="px-3 py-1.5 text-xs" disabled={busy} onClick={() => onPatch({ active: !team.active }, team.active ? "deactivated (hidden from the Teams Arena)" : "activated")} data-testid="team-active">
          {team.active ? "Deactivate" : "Activate"}
        </GhostButton>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ members

function MembersTab({ view, reload, setMsg }: { view: View | null; reload: () => Promise<void>; setMsg: (m: Msg) => void }) {
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState<string | null>(null);
  const [assign, setAssign] = useState<{ userCode: string; teamId: string; designation: Designation | "" }>({ userCode: "", teamId: "", designation: "" });
  const act = async (key: string, url: string, method: "POST" | "DELETE", body: Record<string, unknown>, ok: string) => {
    setBusy(key);
    const r = await adminApi(url, { method, body: { ...body, effectiveFrom: date } });
    setBusy(null);
    setMsg(r.ok ? { kind: "ok", text: ok } : { kind: "error", text: r.error });
    if (r.ok) await reload();
  };
  if (!view) return <p className="text-sm text-text-muted">Loading…</p>;
  const activeTeams = view.teams.filter((t) => t.active);
  return (
    <div className="space-y-6">
      <Field label="Effective from (business date)" hint="Assignments, transfers, removals and designation changes apply from this day. Today is the usual choice.">
        <input type="date" className={cn(inputClass, "max-w-[12rem]")} value={date} onChange={(e) => setDate(e.target.value)} data-testid="member-date" />
      </Field>
      {view.teams.map((t) => {
        const rows = view.members.filter((m) => m.teamId === t.id);
        return (
          <Section key={t.id} title={`${t.name} · ${rows.length} members`} description={t.active ? undefined : "Inactive team: hidden from the Teams Arena."}>
            <Table head={["Agent", "User code", "Designation", "Member since", "Actions"]} empty={!rows.length} testId={`members-${t.slug ?? t.id}`}>
              {rows.map((m) => (
                <tr key={m.userCode} data-testid="admin-member" data-user={m.userCode}>
                  <td className={td}>
                    <span className="font-medium text-white">{m.name}</span>
                    {!m.agentActive && <span className="ml-2 rounded bg-amber-400/10 px-1.5 text-[10px] text-amber-200">inactive agent</span>}
                  </td>
                  <td className={cn(td, "font-mono text-xs text-text-muted")}>{m.userCode}</td>
                  <td className={td}>
                    <select
                      className={cn(inputClass, "h-8 w-auto py-0 text-xs")}
                      value={m.designation ?? ""}
                      disabled={busy === m.userCode}
                      onChange={(e) => e.target.value && void act(m.userCode, "/api/admin/teams/designations", "POST", { userCode: m.userCode, designation: e.target.value }, `${m.name} is now ${DES[e.target.value as Designation]} from ${date}.`)}
                      aria-label={`Designation of ${m.name}`}
                      data-testid="member-designation"
                    >
                      <option value="" disabled className="bg-[#0D1426]">Not set</option>
                      <option value="senior" className="bg-[#0D1426]">{DES.senior}</option>
                      <option value="junior" className="bg-[#0D1426]">{DES.junior}</option>
                    </select>
                  </td>
                  <td className={cn(td, "text-text-muted")}>{m.effectiveFrom}</td>
                  <td className={td}>
                    <div className="flex flex-wrap gap-1.5">
                      <select
                        className={cn(inputClass, "h-8 w-auto py-0 text-xs")}
                        value=""
                        disabled={busy === m.userCode}
                        onChange={(e) => {
                          const to = activeTeams.find((x) => x.id === e.target.value);
                          if (to) void act(m.userCode, "/api/admin/teams/members", "POST", { userCode: m.userCode, teamId: to.id }, `${m.name} moves to ${to.name} from ${date}.`);
                        }}
                        aria-label={`Transfer ${m.name}`}
                        data-testid="member-transfer"
                      >
                        <option value="" className="bg-[#0D1426]">Transfer to…</option>
                        {activeTeams.filter((x) => x.id !== t.id).map((x) => (
                          <option key={x.id} value={x.id} className="bg-[#0D1426]">{x.name}</option>
                        ))}
                      </select>
                      <GhostButton
                        className="px-2.5 py-1 text-xs"
                        disabled={busy === m.userCode}
                        onClick={() => window.confirm(`Remove ${m.name} from ${t.name} from ${date}? Their earlier days stay with ${t.name}.`) && void act(m.userCode, "/api/admin/teams/members", "DELETE", { userCode: m.userCode }, `${m.name} removed from ${t.name} from ${date}.`)}
                        data-testid="member-remove"
                      >
                        <UserMinus className="h-3.5 w-3.5" /> Remove
                      </GhostButton>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          </Section>
        );
      })}
      <Section title={`Unassigned agents · ${view.unassigned.length}`} description="Verified agents (stored user codes) without a team. Assign one with a designation; nobody is assigned automatically.">
        <div className="grid gap-3 md:grid-cols-[1fr_12rem_11rem_auto] md:items-end">
          <Field label="Agent">
            <select className={inputClass} value={assign.userCode} onChange={(e) => setAssign({ ...assign, userCode: e.target.value })} data-testid="assign-agent">
              <option value="" className="bg-[#0D1426]">Choose an agent…</option>
              {view.unassigned.map((a) => (
                <option key={a.userCode} value={a.userCode} className="bg-[#0D1426]">{a.name} · {a.userCode}{a.active ? "" : " (inactive)"}</option>
              ))}
            </select>
          </Field>
          <Field label="Team">
            <select className={inputClass} value={assign.teamId} onChange={(e) => setAssign({ ...assign, teamId: e.target.value })} data-testid="assign-team">
              <option value="" className="bg-[#0D1426]">Choose…</option>
              {activeTeams.map((t) => (
                <option key={t.id} value={t.id} className="bg-[#0D1426]">{t.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Designation">
            <select className={inputClass} value={assign.designation} onChange={(e) => setAssign({ ...assign, designation: e.target.value as Designation })} data-testid="assign-designation">
              <option value="" className="bg-[#0D1426]">Keep current</option>
              <option value="senior" className="bg-[#0D1426]">{DES.senior}</option>
              <option value="junior" className="bg-[#0D1426]">{DES.junior}</option>
            </select>
          </Field>
          <PrimaryButton
            disabled={!assign.userCode || !assign.teamId || busy === "assign"}
            onClick={() =>
              void act("assign", "/api/admin/teams/members", "POST", { userCode: assign.userCode, teamId: assign.teamId, designation: assign.designation || undefined }, "Agent assigned.").then(() => setAssign({ userCode: "", teamId: "", designation: "" }))
            }
            data-testid="assign-submit"
          >
            <ArrowRightLeft className="h-4 w-4" /> Assign
          </PrimaryButton>
        </div>
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------ roster import (Owner)

interface Cand {
  userCode: string;
  name: string;
  sources: string[];
  score?: number;
  reason?: string;
  currentTeam?: string | null;
}
interface Preview {
  teams: Array<{
    slug: string;
    name: string;
    logoUrl: string;
    exists: boolean;
    leaderReference: string | null;
    leaderCandidates: Cand[];
    members: Array<{ rosterName: string; designation: Designation; status: string; candidates: Cand[]; note: string | null }>;
  }>;
  summary: Record<string, number>;
  candidates: Cand[];
  safeQuote: "ok" | "unavailable";
  effectiveFromDefault: string;
}
const STATUS: Record<string, { label: string; cls: string }> = {
  exact: { label: "Verified exact match", cls: "border-emerald-400/40 text-emerald-300" },
  possible: { label: "Possible match: confirm", cls: "border-amber-300/40 text-amber-200" },
  multiple: { label: "Multiple possible matches", cls: "border-orange-400/40 text-orange-300" },
  duplicate: { label: "Same agent suggested twice", cls: "border-rose-400/40 text-rose-300" },
  unmatched: { label: "Unmatched: no user code", cls: "border-white/20 text-text-muted" },
};

function ImportTab({ reload }: { reload: () => Promise<void> }) {
  const [pv, setPv] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [leaders, setLeaders] = useState<Record<string, string>>({});
  const [from, setFrom] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await adminApi<Preview>("/api/admin/teams/import");
    if (!r.ok) return setErr(r.error);
    setErr(null);
    setPv(r.data);
    setFrom(r.data.effectiveFromDefault);
    // Only verified exact matches are pre-selected; everything else needs a person to choose.
    const c: Record<string, string> = {};
    for (const t of r.data.teams) for (const m of t.members) if (m.status === "exact") c[`${t.slug}|${m.rosterName}`] = m.candidates[0].userCode;
    setChoice(c);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);
  const chosen = useMemo(() => Object.values(choice).filter(Boolean), [choice]);
  const dupes = useMemo(() => new Set(chosen.filter((c, i) => chosen.indexOf(c) !== i)), [chosen]);

  const apply = async () => {
    if (!pv) return;
    setBusy(true);
    const members = pv.teams.flatMap((t) => t.members.map((m) => ({ teamSlug: t.slug, rosterName: m.rosterName, userCode: choice[`${t.slug}|${m.rosterName}`] || null })));
    const r = await adminApi<{ teamsCreated: number; assigned: number; unchanged: number; agentsAdded: number; skipped: unknown[] }>("/api/admin/teams/import", {
      method: "POST",
      body: { confirm: true, effectiveFrom: from, members, leaders },
    });
    setBusy(false);
    setConfirm(false);
    setResult(
      r.ok
        ? { kind: "ok", text: `Imported: ${r.data.teamsCreated} team(s) created, ${r.data.assigned} member(s) assigned, ${r.data.unchanged} already in place, ${r.data.skipped.length} left unassigned (no verified identity).` }
        : { kind: "error", text: r.error },
    );
    if (r.ok) {
      await reload();
      await load();
    }
  };

  if (err) return <Notice kind="error">{err}</Notice>;
  if (!pv) return <p className="text-sm text-text-muted">Matching the roster against real agents…</p>;
  return (
    <div className="space-y-5" data-testid="roster-import">
      <Notice kind="info">
        Read-only preview: nothing is written until the Owner confirms below. Names are matched to real identities from the agents table and Safe Quote&apos;s
        closer list. Only identical names are pre-selected; possible, multiple and unmatched rows need a decision. A user code is never invented: unmatched
        people stay unassigned until they have a Safe Quote user code. Header-row names are offered as team leaders only, never as members.
      </Notice>
      {pv.safeQuote === "unavailable" && <Notice kind="error">Safe Quote&apos;s closer list could not be read: only agents already stored in PostgreSQL are candidates.</Notice>}
      <div className="flex flex-wrap gap-2 text-xs" data-testid="import-summary">
        {Object.entries(pv.summary).map(([k, v]) => (
          <span key={k} className="rounded-full border border-white/10 px-3 py-1 text-text-secondary">{k}: <b className="text-white">{v}</b></span>
        ))}
        <GhostButton className="px-3 py-1 text-xs" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" /> Re-check</GhostButton>
      </div>
      {pv.teams.map((t) => (
        <Section key={t.slug} title={`${t.name}${t.exists ? "" : " (will be created)"}`}>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- official logo */}
            <img src={t.logoUrl} alt={`${t.name} logo`} className="h-14 w-14 rounded-xl" />
            {t.leaderReference && (
              <Field label={`Team leader (sheet header: “${t.leaderReference}”)`} hint="Optional. Not counted as a team member.">
                <select className={cn(inputClass, "max-w-xs")} value={leaders[t.slug] ?? ""} onChange={(e) => setLeaders({ ...leaders, [t.slug]: e.target.value })} data-testid={`leader-${t.slug}`}>
                  <option value="" className="bg-[#0D1426]">No leader (decide later)</option>
                  {t.leaderCandidates.map((c) => (
                    <option key={c.userCode} value={c.userCode} className="bg-[#0D1426]">{c.name} · {c.userCode} ({c.reason})</option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          <Table head={["Roster name", "Designation", "Match status", "Matched agent (user code)"]} testId={`import-${t.slug}`}>
            {t.members.map((m) => {
              const key = `${t.slug}|${m.rosterName}`;
              const st = STATUS[m.status];
              const sel = choice[key] ?? "";
              return (
                <tr key={key} data-testid="import-row" data-status={m.status} data-roster={m.rosterName}>
                  <td className={cn(td, "font-medium text-white")}>{m.rosterName}</td>
                  <td className={td}>{m.designation === "senior" ? "SR" : "Jr"}</td>
                  <td className={td}>
                    <span className={cn("rounded-full border px-2 py-0.5 text-xs", st.cls)}>{st.label}</span>
                    {m.note && <p className="mt-1 text-xs text-rose-300">{m.note}</p>}
                  </td>
                  <td className={td}>
                    <select className={cn(inputClass, "min-w-[18rem]", sel && dupes.has(sel) && "border-rose-400")} value={sel} onChange={(e) => setChoice({ ...choice, [key]: e.target.value })} data-testid="import-choice">
                      <option value="" className="bg-[#0D1426]">Leave unassigned</option>
                      {m.candidates.length > 0 && (
                        <optgroup label="Suggested">
                          {m.candidates.map((c) => (
                            <option key={c.userCode} value={c.userCode} className="bg-[#0D1426]">
                              {c.name} · {c.userCode} — {c.reason}{c.currentTeam ? ` · now in ${c.currentTeam}` : ""}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="All verified agents">
                        {pv.candidates.filter((c) => !m.candidates.some((x) => x.userCode === c.userCode)).map((c) => (
                          <option key={c.userCode} value={c.userCode} className="bg-[#0D1426]">{c.name} · {c.userCode}</option>
                        ))}
                      </optgroup>
                    </select>
                    {sel && dupes.has(sel) && <p className="mt-1 text-xs text-rose-300">Chosen for more than one roster name.</p>}
                  </td>
                </tr>
              );
            })}
          </Table>
        </Section>
      ))}
      <Section title="Confirm the import (Owner)">
        <div className="grid gap-3 md:grid-cols-[12rem_1fr] md:items-end">
          <Field label="Memberships effective from" hint="Default: the first day of the current business month (the whole month counts).">
            <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} data-testid="import-from" />
          </Field>
          <p className="text-sm text-text-muted">
            {chosen.length} of {pv.summary.total} roster members have a chosen identity; the rest stay unassigned. Teams, memberships and designations are
            written in one transaction and audited. No sale, bonus or spin record is touched.
          </p>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} data-testid="import-confirm" /> I checked every chosen identity against the roster.
        </label>
        <PrimaryButton className="mt-3" disabled={!confirm || busy || dupes.size > 0 || !chosen.length} onClick={() => void apply()} data-testid="import-apply">
          <ShieldCheck className="h-4 w-4" /> Import {chosen.length} confirmed member(s)
        </PrimaryButton>
        {result && <div className="mt-3"><Notice kind={result.kind}>{result.text}</Notice></div>}
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------ history

function HistoryTab() {
  const [rows, setRows] = useState<Array<{ id: number; name: string; userCode: string; team: string; effectiveFrom: string; effectiveTo: string | null; note: string | null; assignedBy: string | null; endedBy: string | null; createdAt: string }> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await adminApi<{ history: NonNullable<typeof rows> }>("/api/admin/teams/history?limit=300");
      if (r.ok) setRows(r.data.history);
      else setErr(r.error);
    }, 0);
    return () => clearTimeout(t);
  }, []);
  if (err) return <Notice kind="error">{err}</Notice>;
  if (!rows) return <p className="text-sm text-text-muted">Loading…</p>;
  return (
    <Table head={["Agent", "Team", "From", "Until", "Note", "By", "Recorded"]} empty={!rows.length} testId="team-history">
      {rows.map((r) => (
        <tr key={r.id}>
          <td className={td}><span className="font-medium text-white">{r.name}</span><div className="font-mono text-[10px] text-text-muted">{r.userCode}</div></td>
          <td className={td}>{r.team}</td>
          <td className={td}>{r.effectiveFrom}</td>
          <td className={td}>{r.effectiveTo ?? <span className="text-emerald-300">current</span>}</td>
          <td className={cn(td, "max-w-[16rem] text-xs text-text-muted")}>{r.note ?? ""}</td>
          <td className={cn(td, "text-xs text-text-muted")}>{r.assignedBy ?? "—"}{r.endedBy ? ` / ended by ${r.endedBy}` : ""}</td>
          <td className={cn(td, "text-xs text-text-muted")}>{fmtDate(r.createdAt)}</td>
        </tr>
      ))}
    </Table>
  );
}
