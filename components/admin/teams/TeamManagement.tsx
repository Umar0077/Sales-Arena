"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Crown, Plus, RefreshCw, Upload, UserMinus, ArrowRightLeft, ShieldCheck, Archive, RotateCcw, Search, History, Users, X, ArrowRight } from "lucide-react";
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
/** One row of the agent directory: a member of a team (active or archived) or an unassigned agent. */
interface Agent {
  userCode: string;
  name: string;
  active: boolean;
  designation: Designation | null;
  teamId: string | null;
  since: string | null;
}

const TABS = ["Teams", "Members", "Initial roster import", "History"] as const;
type Tab = (typeof TABS)[number];
const today = () => new Date().toISOString().slice(0, 10);
const DES: Record<Designation, string> = { senior: "Senior (SR)", junior: "Junior (Jr)" };

export function TeamManagement() {
  const [tab, setTab] = useState<Tab>("Teams");
  const [view, setView] = useState<View | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [agentFilter, setAgentFilter] = useState<{ team: string }>({ team: "all" });
  const [historyFilter, setHistoryFilter] = useState<{ teamId?: string; userCode?: string; label?: string }>({});
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
  const showMembers = (teamId: string) => {
    setAgentFilter({ team: teamId });
    setTab("Members");
  };
  const showHistory = (f: { teamId?: string; userCode?: string; label?: string }) => {
    setHistoryFilter(f);
    setTab("History");
  };

  return (
    <div className="space-y-6" data-testid="team-management">
      <div>
        <h2 className="font-heading text-xl font-bold text-white">Team Management</h2>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">
          Teams, members and Senior / Junior designations for the Teams Arena, stored in PostgreSQL. Active teams compete on the Live Arena automatically
          (one, two, three or more). Changes take effect from the business date you choose: each day&apos;s sales count for the team the agent belonged to
          on that day, so earlier results never move. Team changes never change sales, earned bonuses or spins.
        </p>
      </div>
      <div role="tablist" aria-label="Team management" className="flex flex-wrap gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors", tab === t ? "bg-primary text-white shadow" : "text-text-secondary hover:text-white")}>
            {t === "Members" ? "Members & agents" : t}
          </button>
        ))}
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {tab === "Teams" && <TeamsTab view={view} reload={load} setMsg={setMsg} onMembers={showMembers} onHistory={showHistory} />}
      {tab === "Members" && <MembersTab view={view} reload={load} setMsg={setMsg} filter={agentFilter} setFilter={setAgentFilter} onHistory={showHistory} />}
      {tab === "Initial roster import" && <ImportTab reload={load} />}
      {tab === "History" && <HistoryTab view={view} filter={historyFilter} setFilter={setHistoryFilter} />}
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

function LogoThumb({ team, size = 64 }: { team: Pick<Team, "logoUrl" | "name" | "color">; size?: number }) {
  return team.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- official / uploaded team artwork (may be a data: upload)
    <img src={team.logoUrl} alt={`${team.name} logo`} className="shrink-0 rounded-xl object-contain" style={{ width: size, height: size, background: "rgba(11,17,34,0.6)" }} data-testid="admin-team-logo" />
  ) : (
    <div className="grid shrink-0 place-items-center rounded-xl text-[10px] text-text-muted" style={{ width: size, height: size, border: `1px dashed ${team.color}` }}>No logo</div>
  );
}

function TeamsTab({
  view,
  reload,
  setMsg,
  onMembers,
  onHistory,
}: {
  view: View | null;
  reload: () => Promise<void>;
  setMsg: (m: Msg) => void;
  onMembers: (teamId: string) => void;
  onHistory: (f: { teamId?: string; label?: string }) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const patch = async (t: Team, body: Record<string, unknown>, label: string) => {
    setBusy(t.id);
    const r = await adminApi(`/api/admin/teams/${encodeURIComponent(t.id)}`, { method: "PATCH", body });
    setBusy(null);
    setMsg(r.ok ? { kind: "ok", text: `${t.name}: ${label}.` } : { kind: "error", text: r.error });
    if (r.ok) await reload();
  };
  if (!view) return <p className="text-sm text-text-muted">Loading…</p>;
  const active = view.teams.filter((t) => t.active);
  const archived = view.teams.filter((t) => !t.active);
  const agents = [...view.members.map((m) => ({ userCode: m.userCode, name: m.name })), ...view.unassigned].sort((a, b) => a.name.localeCompare(b.name));
  const layout = active.length === 0 ? "nothing to show" : active.length === 1 ? "a single-team spotlight" : active.length === 2 ? "head-to-head" : active.length === 3 ? "three ranked cards" : `a ${active.length}-team grid`;
  return (
    <div className="space-y-6">
      {view.teams.length === 0 && <Notice kind="info">No teams yet. Create one below, or use “Initial roster import” (Owner).</Notice>}
      <Section
        title={`In the competition · ${active.length} active`}
        description={`The Live Arena shows ${layout}. Archiving a team removes it from the live competition only: its members stay assigned to it (reassign them individually), and its history, sales and awards are kept. It can be reactivated at any time.`}
      >
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3" data-testid="admin-team-list">
          {active.map((t) => (
            <TeamEditor key={t.id} team={t} members={view.members.filter((m) => m.teamId === t.id)} busy={busy === t.id} onPatch={(b, l) => void patch(t, b, l)} setMsg={setMsg} onMembers={() => onMembers(t.id)} onHistory={() => onHistory({ teamId: t.id, label: t.name })} />
          ))}
          {!active.length && <p className="text-sm text-text-muted">No active teams: the Teams Arena shows an empty state.</p>}
        </div>
      </Section>
      {archived.length > 0 && (
        <Section title={`Archived · ${archived.length}`} description="Not in the live competition. Members and history are preserved; reactivate to bring a team back.">
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3" data-testid="admin-archived-teams">
            {archived.map((t) => (
              <TeamEditor key={t.id} team={t} members={view.members.filter((m) => m.teamId === t.id)} busy={busy === t.id} onPatch={(b, l) => void patch(t, b, l)} setMsg={setMsg} onMembers={() => onMembers(t.id)} onHistory={() => onHistory({ teamId: t.id, label: t.name })} />
            ))}
          </div>
        </Section>
      )}
      <CreateTeamForm agents={agents} reload={reload} setMsg={setMsg} />
    </div>
  );
}

/** New team: name, official logo (with preview), colours, leader and status. Validated again on the server. */
function CreateTeamForm({ agents, reload, setMsg }: { agents: Array<{ userCode: string; name: string }>; reload: () => Promise<void>; setMsg: (m: Msg) => void }) {
  const blank = { name: "", color: "#22D3FF", useSecondary: false, accentSecondary: "#F5C451", logoUrl: null as string | null, leaderUserCode: "", active: true };
  const [d, setD] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    const r = await adminApi("/api/admin/teams", {
      method: "POST",
      body: { name: d.name, color: d.color, accentSecondary: d.useSecondary ? d.accentSecondary : undefined, logoUrl: d.logoUrl ?? undefined, leaderUserCode: d.leaderUserCode || undefined, active: d.active },
    });
    setBusy(false);
    setMsg(r.ok ? { kind: "ok", text: `Team “${d.name}” created${d.active ? " and added to the live competition" : " (inactive)"}. Assign members on the Members tab.` } : { kind: "error", text: r.error });
    if (r.ok) {
      setD(blank);
      await reload();
    }
  };
  return (
    <Section title="Create a team" description="Teams are display / analytics groups: winning a team competition never creates a cash reward. An active team appears on the Teams Arena automatically.">
      <div className="grid gap-5 lg:grid-cols-[auto_1fr]" data-testid="create-team-form">
        <div className="flex flex-col items-center gap-2">
          <div className="grid h-36 w-36 place-items-center rounded-2xl border border-white/10 p-2" style={{ background: `radial-gradient(circle, ${d.color}33, rgba(11,17,34,0.9) 70%)` }} data-testid="new-team-logo-preview">
            {d.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen upload
              <img src={d.logoUrl} alt="Logo preview" className="h-full w-full object-contain" />
            ) : (
              <span className="text-xs text-text-muted">Logo preview</span>
            )}
          </div>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-white">
            <Upload className="h-3.5 w-3.5" /> {d.logoUrl ? "Replace logo" : "Upload logo"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              data-testid="new-team-logo"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  setLogoError(null);
                  setD((x) => ({ ...x, logoUrl: null }));
                  const url = await readLogo(f);
                  setD((x) => ({ ...x, logoUrl: url }));
                } catch (err) {
                  setLogoError(err instanceof Error ? err.message : "Logo not accepted.");
                }
              }}
            />
          </label>
          <p className="max-w-[10rem] text-center text-[10px] text-text-muted">PNG, JPEG or WebP, under 300 KB. Transparent PNG / WebP looks best.</p>
          {logoError && <p className="max-w-[12rem] text-center text-xs text-rose-300" data-testid="new-team-logo-error">{logoError}</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Team name">
            <input className={inputClass} value={d.name} maxLength={60} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Team Falcons" data-testid="new-team-name" />
          </Field>
          <Field label="Team leader (optional)">
            <select className={inputClass} value={d.leaderUserCode} onChange={(e) => setD({ ...d, leaderUserCode: e.target.value })} data-testid="new-team-leader">
              <option value="" className="bg-[#0D1426]">No leader</option>
              {agents.map((a) => (
                <option key={a.userCode} value={a.userCode} className="bg-[#0D1426]">{a.name} · {a.userCode}</option>
              ))}
            </select>
          </Field>
          <Field label="Primary accent colour">
            <div className="flex items-center gap-2">
              <input type="color" className="h-10 w-14 cursor-pointer rounded-lg border border-white/10 bg-transparent" value={d.color} onChange={(e) => setD({ ...d, color: e.target.value })} data-testid="new-team-color" />
              <span className="font-mono text-xs text-text-muted">{d.color}</span>
            </div>
          </Field>
          <Field label="Secondary accent (optional)">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={d.useSecondary} onChange={(e) => setD({ ...d, useSecondary: e.target.checked })} aria-label="Use a secondary accent" />
              <input type="color" disabled={!d.useSecondary} className="h-10 w-14 cursor-pointer rounded-lg border border-white/10 bg-transparent disabled:opacity-40" value={d.accentSecondary} onChange={(e) => setD({ ...d, accentSecondary: e.target.value })} data-testid="new-team-color2" />
            </div>
          </Field>
          <label className="flex items-center gap-2 text-sm text-text-secondary sm:col-span-2">
            <input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} data-testid="new-team-active" />
            Active: show it on the Teams Arena right away (otherwise it is created archived).
          </label>
          <div className="sm:col-span-2">
            <PrimaryButton onClick={() => void create()} disabled={busy || d.name.trim().length < 2} data-testid="create-team">
              <Plus className="h-4 w-4" /> Create team
            </PrimaryButton>
          </div>
        </div>
      </div>
    </Section>
  );
}

function TeamEditor({
  team,
  members,
  busy,
  onPatch,
  setMsg,
  onMembers,
  onHistory,
}: {
  team: Team;
  members: Member[];
  busy: boolean;
  onPatch: (b: Record<string, unknown>, label: string) => void;
  setMsg: (m: Msg) => void;
  onMembers: () => void;
  onHistory: () => void;
}) {
  const [name, setName] = useState(team.name);
  const archive = () => {
    if (
      window.confirm(
        `Archive ${team.name}?\n\n• It leaves the live Teams Arena now.\n• Its ${members.length} member(s) stay assigned to it (nobody is moved): reassign them individually on the Members tab.\n• Its history, sales and awards are kept.\n• You can reactivate it at any time.`,
      )
    )
      onPatch({ active: false }, "deactivated (archived, hidden from the Teams Arena; members and history kept)");
  };
  return (
    <section className={cn("space-y-3 rounded-2xl border bg-white/[0.02] p-4", !team.active && "opacity-90")} style={{ borderColor: `${team.color}55` }} data-testid="admin-team" data-team={team.slug ?? team.id} data-active={team.active ? "true" : "false"}>
      <div className="flex items-center gap-3">
        <LogoThumb team={team} />
        <div className="min-w-0">
          <p className="truncate font-heading text-lg font-bold text-white">{team.name}</p>
          <p className="text-xs text-text-muted">
            {team.memberCount} members · order {team.displayOrder} · {team.active ? <span className="text-emerald-300">active</span> : <span className="text-amber-200">archived</span>}
          </p>
          {team.leaderName && <p className="flex items-center gap-1 text-xs text-gold"><Crown className="h-3 w-3" /> {team.leaderName}</p>}
        </div>
      </div>
      {!team.active && members.length > 0 && (
        <p className="rounded-lg border border-amber-300/25 bg-amber-300/[0.06] px-3 py-2 text-xs text-amber-100" data-testid="archived-members-note">
          {members.length} member(s) are still assigned to this archived team and are not in the live competition. Move them on the Members tab.
        </p>
      )}
      <div className="flex gap-2">
        <input className={inputClass} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="Team name" />
        <GhostButton disabled={busy || name.trim() === team.name} onClick={() => onPatch({ name }, "renamed")}>Save</GhostButton>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
          Accent <input type="color" value={team.color} onChange={(e) => onPatch({ color: e.target.value }, "accent colour saved")} className="h-8 w-10 cursor-pointer rounded border border-white/10 bg-transparent" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
          2nd <input type="color" value={team.accentSecondary ?? team.color} onChange={(e) => onPatch({ accentSecondary: e.target.value }, "secondary accent saved")} className="h-8 w-10 cursor-pointer rounded border border-white/10 bg-transparent" data-testid="team-color2" />
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
      </div>
      <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-3">
        <GhostButton className="px-3 py-1.5 text-xs" onClick={onMembers} data-testid="team-view-members"><Users className="h-3.5 w-3.5" /> Members ({members.length})</GhostButton>
        <GhostButton className="px-3 py-1.5 text-xs" onClick={onHistory} data-testid="team-view-history"><History className="h-3.5 w-3.5" /> History</GhostButton>
        {team.active ? (
          <GhostButton className="ml-auto border-amber-300/30 px-3 py-1.5 text-xs text-amber-200" disabled={busy} onClick={archive} data-testid="team-active">
            <Archive className="h-3.5 w-3.5" /> Archive (deactivate)
          </GhostButton>
        ) : (
          <GhostButton className="ml-auto border-emerald-400/30 px-3 py-1.5 text-xs text-emerald-300" disabled={busy} onClick={() => onPatch({ active: true }, "reactivated (back in the Teams Arena)")} data-testid="team-active">
            <RotateCcw className="h-3.5 w-3.5" /> Reactivate
          </GhostButton>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ members & agents

function MembersTab({
  view,
  reload,
  setMsg,
  filter,
  setFilter,
  onHistory,
}: {
  view: View | null;
  reload: () => Promise<void>;
  setMsg: (m: Msg) => void;
  filter: { team: string };
  setFilter: (f: { team: string }) => void;
  onHistory: (f: { userCode?: string; label?: string }) => void;
}) {
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [des, setDes] = useState<"all" | Designation | "none">("all");
  const [moving, setMoving] = useState<Agent | null>(null);
  const [assign, setAssign] = useState<{ userCode: string; teamId: string; designation: Designation | "" }>({ userCode: "", teamId: "", designation: "" });
  const act = async (key: string, url: string, method: "POST" | "DELETE", body: Record<string, unknown>, ok: string) => {
    setBusy(key);
    const r = await adminApi(url, { method, body: { effectiveFrom: date, ...body } });
    setBusy(null);
    setMsg(r.ok ? { kind: "ok", text: ok } : { kind: "error", text: r.error });
    if (r.ok) await reload();
    return r.ok;
  };
  const agents = useMemo<Agent[]>(() => {
    if (!view) return [];
    return [
      ...view.members.map((m) => ({ userCode: m.userCode, name: m.name, active: m.agentActive, designation: m.designation, teamId: m.teamId, since: m.effectiveFrom })),
      ...view.unassigned.map((u) => ({ userCode: u.userCode, name: u.name, active: u.active, designation: u.designation, teamId: null, since: null })),
    ].sort((a, b) => a.name.localeCompare(b.name));
  }, [view]);
  if (!view) return <p className="text-sm text-text-muted">Loading…</p>;
  const teamOf = (id: string | null) => view.teams.find((t) => t.id === id) ?? null;
  const needle = q.trim().toLowerCase();
  const rows = agents.filter(
    (a) =>
      (!needle || a.name.toLowerCase().includes(needle) || a.userCode.toLowerCase().includes(needle)) &&
      (filter.team === "all" || (filter.team === "unassigned" ? a.teamId === null : a.teamId === filter.team)) &&
      (des === "all" || (des === "none" ? a.designation === null : a.designation === des)),
  );
  const activeTeams = view.teams.filter((t) => t.active);
  return (
    <div className="space-y-6">
      <Section title={`Agents · ${agents.length}`} description="Every verified agent (stored Safe Quote user code): team members, members of archived teams and unassigned agents. Nobody is moved automatically.">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto] md:items-end" data-testid="agent-filters">
          <Field label="Search name or user code">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input className={cn(inputClass, "pl-9")} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Hamna or CLS-536D6AA1" data-testid="agent-search" />
            </div>
          </Field>
          <Field label="Team">
            <select className={inputClass} value={filter.team} onChange={(e) => setFilter({ team: e.target.value })} data-testid="agent-team-filter">
              <option value="all" className="bg-[#0D1426]">All agents</option>
              <option value="unassigned" className="bg-[#0D1426]">Unassigned</option>
              {view.teams.map((t) => (
                <option key={t.id} value={t.id} className="bg-[#0D1426]">{t.name}{t.active ? "" : " (archived)"}</option>
              ))}
            </select>
          </Field>
          <Field label="Designation">
            <select className={inputClass} value={des} onChange={(e) => setDes(e.target.value as typeof des)} data-testid="agent-designation-filter">
              <option value="all" className="bg-[#0D1426]">All</option>
              <option value="senior" className="bg-[#0D1426]">Senior</option>
              <option value="junior" className="bg-[#0D1426]">Junior</option>
              <option value="none" className="bg-[#0D1426]">Not set</option>
            </select>
          </Field>
          <Field label="Effective from">
            <input type="date" className={cn(inputClass, "w-[10.5rem]")} value={date} onChange={(e) => setDate(e.target.value)} data-testid="member-date" />
          </Field>
        </div>
        <p className="text-xs text-text-muted" data-testid="agent-count">{rows.length} shown. Changes apply from the effective business date; earlier days stay with the previous team.</p>
        <Table head={["Agent", "Team", "Designation", "Member since", "Actions"]} empty={!rows.length} testId="agent-directory">
          {rows.map((a) => {
            const t = teamOf(a.teamId);
            return (
              <tr key={a.userCode} data-testid="admin-member" data-user={a.userCode} data-team={t?.slug ?? t?.id ?? "unassigned"}>
                <td className={td}>
                  <span className="font-medium text-white">{a.name}</span>
                  {!a.active && <span className="ml-2 rounded bg-amber-400/10 px-1.5 text-[10px] text-amber-200">inactive agent</span>}
                  <div className="font-mono text-[10px] text-text-muted">{a.userCode}</div>
                </td>
                <td className={td}>
                  {t ? (
                    <span className="inline-flex items-center gap-2">
                      <LogoThumb team={t} size={24} />
                      <span style={{ color: t.color }}>{t.name}</span>
                      {!t.active && <span className="rounded bg-amber-400/10 px-1.5 text-[10px] text-amber-200">archived</span>}
                    </span>
                  ) : (
                    <span className="text-text-muted">Unassigned</span>
                  )}
                </td>
                <td className={td}>
                  <select
                    className={cn(inputClass, "h-8 w-auto py-0 text-xs")}
                    value={a.designation ?? ""}
                    disabled={busy === a.userCode}
                    onChange={(e) => e.target.value && void act(a.userCode, "/api/admin/teams/designations", "POST", { userCode: a.userCode, designation: e.target.value }, `${a.name} is now ${DES[e.target.value as Designation]} from ${date}.`)}
                    aria-label={`Designation of ${a.name}`}
                    data-testid="member-designation"
                  >
                    <option value="" disabled className="bg-[#0D1426]">Not set</option>
                    <option value="senior" className="bg-[#0D1426]">{DES.senior}</option>
                    <option value="junior" className="bg-[#0D1426]">{DES.junior}</option>
                  </select>
                </td>
                <td className={cn(td, "text-text-muted")}>{a.since ?? "—"}</td>
                <td className={td}>
                  <div className="flex flex-wrap gap-1.5">
                    <GhostButton className="px-2.5 py-1 text-xs" disabled={busy === a.userCode || !activeTeams.some((x) => x.id !== a.teamId)} onClick={() => setMoving(a)} data-testid="member-transfer">
                      <ArrowRightLeft className="h-3.5 w-3.5" /> {a.teamId ? "Move" : "Assign"}
                    </GhostButton>
                    {t && (
                      <GhostButton
                        className="px-2.5 py-1 text-xs"
                        disabled={busy === a.userCode}
                        onClick={() => window.confirm(`Remove ${a.name} from ${t.name} from ${date}? Their earlier days stay with ${t.name}.`) && void act(a.userCode, "/api/admin/teams/members", "DELETE", { userCode: a.userCode }, `${a.name} removed from ${t.name} from ${date}.`)}
                        data-testid="member-remove"
                      >
                        <UserMinus className="h-3.5 w-3.5" /> Remove
                      </GhostButton>
                    )}
                    <GhostButton className="px-2.5 py-1 text-xs" onClick={() => onHistory({ userCode: a.userCode, label: a.name })} data-testid="member-history">
                      <History className="h-3.5 w-3.5" />
                    </GhostButton>
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      </Section>

      <Section title={`Quick assign · ${view.unassigned.length} unassigned`} description="Assign an unassigned verified agent with a designation.">
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

      {moving && (
        <TransferDialog
          agent={moving}
          from={teamOf(moving.teamId)}
          teams={activeTeams.filter((t) => t.id !== moving.teamId)}
          initialDate={date}
          onClose={() => setMoving(null)}
          onConfirm={async (teamId, effectiveFrom, designation) => {
            const to = view.teams.find((t) => t.id === teamId)!;
            setBusy(moving.userCode);
            const r = await adminApi("/api/admin/teams/members", { method: "POST", body: { userCode: moving.userCode, teamId, effectiveFrom, designation: designation || undefined, note: "Admin transfer" } });
            setBusy(null);
            if (!r.ok) return r.error;
            setMsg({ kind: "ok", text: `${moving.name} ${moving.teamId ? "moves" : "is assigned"} to ${to.name} from ${effectiveFrom}.` });
            setMoving(null);
            await reload();
            return null;
          }}
        />
      )}
    </div>
  );
}

/** Assign / transfer with a confirmation preview of exactly what will be written. */
function TransferDialog({
  agent,
  from,
  teams,
  initialDate,
  onClose,
  onConfirm,
}: {
  agent: Agent;
  from: Team | null;
  teams: Team[];
  initialDate: string;
  onClose: () => void;
  onConfirm: (teamId: string, effectiveFrom: string, designation: Designation | "") => Promise<string | null>;
}) {
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [date, setDate] = useState(initialDate);
  const [designation, setDesignation] = useState<Designation | "">("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const to = teams.find((t) => t.id === teamId) ?? null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Move ${agent.name}`} data-testid="transfer-dialog">
      <div className="w-full max-w-lg space-y-4 rounded-2xl border border-white/10 bg-[#0D1426] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-secondary">{from ? "Transfer agent" : "Assign agent"}</p>
            <h3 className="font-heading text-xl font-bold text-white">{agent.name}</h3>
            <p className="font-mono text-xs text-text-muted">{agent.userCode}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-text-muted hover:text-white" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Destination team">
            <select className={inputClass} value={teamId} onChange={(e) => setTeamId(e.target.value)} data-testid="transfer-team">
              {teams.map((t) => (
                <option key={t.id} value={t.id} className="bg-[#0D1426]">{t.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Effective business date">
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} data-testid="transfer-date" />
          </Field>
          <Field label="Designation">
            <select className={inputClass} value={designation} onChange={(e) => setDesignation(e.target.value as Designation | "")} data-testid="transfer-designation">
              <option value="" className="bg-[#0D1426]">Keep {agent.designation ? DES[agent.designation] : "not set"}</option>
              <option value="senior" className="bg-[#0D1426]">{DES.senior}</option>
              <option value="junior" className="bg-[#0D1426]">{DES.junior}</option>
            </select>
          </Field>
        </div>
        {/* Preview of what will be written. */}
        <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm" data-testid="transfer-preview">
          <div className="flex items-center gap-2 font-semibold">
            <span style={{ color: from?.color }}>{from ? from.name : "Unassigned"}</span>
            <ArrowRight className="h-4 w-4 text-text-muted" />
            <span style={{ color: to?.color }}>{to?.name ?? "—"}</span>
            <span className="ml-auto text-xs text-text-muted">from {date}</span>
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-text-secondary">
            {from && <li>{from.name} membership ends on {date} and stays in history (its earlier days keep counting for {from.name}).</li>}
            <li>New {to?.name ?? ""} membership starts {date}. Never two teams at once.</li>
            {designation && <li>Designation becomes {DES[designation]} from {date} (earlier designation kept in history).</li>}
            <li>Sales, cash awards and spins are not changed. The Teams Arena updates live.</li>
          </ul>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton
            disabled={!to || busy}
            onClick={async () => {
              setBusy(true);
              setError(await onConfirm(teamId, date, designation));
              setBusy(false);
            }}
            data-testid="transfer-confirm"
          >
            <ShieldCheck className="h-4 w-4" /> Confirm {from ? "transfer" : "assignment"}
          </PrimaryButton>
        </div>
      </div>
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

function HistoryTab({
  view,
  filter,
  setFilter,
}: {
  view: View | null;
  filter: { teamId?: string; userCode?: string; label?: string };
  setFilter: (f: { teamId?: string; userCode?: string; label?: string }) => void;
}) {
  const [rows, setRows] = useState<Array<{ id: number; name: string; userCode: string; team: string; teamId: string; effectiveFrom: string; effectiveTo: string | null; note: string | null; assignedBy: string | null; endedBy: string | null; createdAt: string }> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(async () => {
      const q = new URLSearchParams({ limit: "300" });
      if (filter.teamId) q.set("teamId", filter.teamId);
      if (filter.userCode) q.set("userCode", filter.userCode);
      const r = await adminApi<{ history: NonNullable<typeof rows> }>(`/api/admin/teams/history?${q}`);
      if (r.ok) setRows(r.data.history);
      else setErr(r.error);
    }, 0);
    return () => clearTimeout(t);
  }, [filter.teamId, filter.userCode]);
  if (err) return <Notice kind="error">{err}</Notice>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Team">
          <select className={cn(inputClass, "w-56")} value={filter.teamId ?? ""} onChange={(e) => setFilter({ teamId: e.target.value || undefined, label: view?.teams.find((t) => t.id === e.target.value)?.name })} data-testid="history-team-filter">
            <option value="" className="bg-[#0D1426]">All teams</option>
            {view?.teams.map((t) => (
              <option key={t.id} value={t.id} className="bg-[#0D1426]">{t.name}{t.active ? "" : " (archived)"}</option>
            ))}
          </select>
        </Field>
        {filter.userCode && (
          <GhostButton className="px-3 py-2 text-xs" onClick={() => setFilter({})} data-testid="history-clear">
            Agent: {filter.label ?? filter.userCode} <X className="h-3.5 w-3.5" />
          </GhostButton>
        )}
      </div>
      {!rows ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : (
        <Table head={["Agent", "Team", "From", "Until", "Note", "By", "Recorded"]} empty={!rows.length} testId="team-history">
          {rows.map((r) => (
            <tr key={r.id} data-testid="history-row" data-user={r.userCode} data-team-id={r.teamId}>
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
      )}
    </div>
  );
}
