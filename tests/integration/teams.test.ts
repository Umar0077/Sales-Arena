import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { ingestValidatedSale } from "@/lib/server/sales/ingest";
import { assignMember, createTeam, designationOn, removeMember, setDesignation, teamHistory, updateTeam, TeamError, type Actor } from "@/lib/server/teams/repo";
import { computeStandings } from "@/lib/server/teams/standings";
import { __resetSyncState, readSyncState } from "@/lib/server/live/sync-state";
import { GET as previewRoute, POST as importRoute } from "@/app/api/admin/teams/import/route";
import { GET as teamsRoute, POST as createTeamRoute } from "@/app/api/admin/teams/route";
import { POST as membersRoute } from "@/app/api/admin/teams/members/route";
import { GET as audiencePreviewRoute, POST as audienceApplyRoute } from "@/app/api/admin/programs/audience/route";
import { GET as standingsRoute } from "@/app/api/arena/teams/route";
import { POST as createProgramRoute } from "@/app/api/admin/programs/route";
import { PATCH as patchProgramRoute } from "@/app/api/admin/programs/[id]/route";
import { GET as listAwardsRoute } from "@/app/api/admin/awards/route";
import { PATCH as patchAwardRoute } from "@/app/api/admin/awards/[id]/route";
import { POST as scanRoute } from "@/app/api/admin/awards/recovery/scan/route";
import { POST as recoveryApplyRoute } from "@/app/api/admin/awards/recovery/route";
import { PUT as putConfig } from "@/app/api/admin/arena-config/route";
import { POST as login } from "@/app/api/admin/auth/login/route";
import { arenaBroadcaster, type ArenaBroadcastEvent } from "@/lib/server/events/broadcaster";
import { INITIAL_ROSTER } from "@/lib/teams/initial-roster";
import { NextRequest } from "next/server";
import { createAdmin, createAgent, pool, req, resetDatabase, sessionFrom, setSetting } from "./helpers";

/**
 * Teams Arena + Senior / Junior reward audience, on the TEST database only. Safe Quote is a local fake
 * (closer list and per-range figures); bonus tiers are test fixtures, read only from reward_programs.
 */
let owner: { cookie: string; csrf: string };
let staff: { cookie: string; csrf: string };
let actor: Actor;
let upstream: http.Server;
/** Fake Safe Quote: all-time closer list, and per-range closer figures keyed "from|to" (default: zeros). */
let closerList: Array<{ userCode: string; name: string }> = [];
let rangeFigures: Record<string, Array<{ userCode: string; name: string; submitted: number; validated: number; closeRate: number }>> = {};
let closerCalls: string[] = [];
let events: ArenaBroadcastEvent[] = [];
let off = () => {};
let seq = 0;
const ALL_ON = { daily: { active: true, showOnArena: true }, weekly: { active: true, showOnArena: true }, monthly: { active: true, showOnArena: true } };
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000);
const as = (s = owner) => ({ cookie: s.cookie, csrf: s.csrf });
const count = async (table: string) => Number((await pool().query(`SELECT COUNT(*)::int n FROM ${table}`)).rows[0].n);
const json = async (r: Response) => ({ status: r.status, body: await r.json() });
const sale = (u: string, at: Date) => ({ caseId: `TM-${Date.now()}-${seq++}`, userCode: u, closerName: `Agent ${u}`, validatedAt: at.toISOString(), premium: 1 });

/** The real figures fetcher contract, fed from the fake: one call per date range. */
const fakeClosers = async (from: string, to: string) => {
  closerCalls.push(`${from}|${to}`);
  return new Map((rangeFigures[`${from}|${to}`] ?? rangeFigures["*"] ?? []).map((c) => [c.userCode.toUpperCase(), { submitted: c.submitted, validated: c.validated, closeRate: c.closeRate }]));
};

async function program(body: Record<string, unknown>, activeMinsAgo = 600) {
  const r = await createProgramRoute(req("/api/admin/programs", { method: "POST", body: { rewardType: "cash", currency: "PKR", enabled: true, maxAwards: 1, kind: "daily", ...body }, ...as() }));
  const j = await r.json();
  expect(r.status, j.error).toBe(201);
  await pool().query(`UPDATE reward_programs SET active_since = $2 WHERE id = $1`, [j.program.id, minsAgo(activeMinsAgo)]);
  return j.program as { id: string; audience: string; rewardGroup: string };
}
const awardsOf = async (u: string) => (await pool().query(`SELECT program_id, amount, reward_group, superseded_by, status FROM bonus_awards WHERE user_code = $1 ORDER BY created_at`, [u])).rows;

describe("Teams Arena: PostgreSQL model, roster import, standings, Senior / Junior rewards", () => {
  beforeAll(async () => {
    await resetDatabase();
    await createAdmin();
    await createAdmin("staff@example.com");
    await pool().query(`UPDATE admin_users SET role = 'admin' WHERE email = 'staff@example.com'`);
    owner = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" } })));
    staff = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "staff@example.com", password: "Correct-Horse-Battery-9" } })));
    actor = { adminId: (await pool().query(`SELECT id FROM admin_users WHERE email = 'owner@example.com'`)).rows[0].id, ip: null, userAgent: null };
    upstream = http.createServer((rq, res) => {
      const u = new URL(rq.url ?? "/", "http://x");
      if (u.pathname !== "/closers") return res.writeHead(404).end();
      const from = u.searchParams.get("from");
      const to = u.searchParams.get("to");
      const list = from && to ? (rangeFigures[`${from}|${to}`] ?? rangeFigures["*"] ?? []) : closerList.map((c) => ({ ...c, submitted: 1, validated: 0, closeRate: 0 }));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ closers: list }));
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    process.env.SALES_ARENA_API_URL = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    process.env.SALES_ARENA_API_TOKEN = "test-token-not-real";
  });
  afterAll(async () => {
    await new Promise((r) => upstream.close(r));
    delete process.env.SALES_ARENA_API_TOKEN;
  });
  beforeEach(async () => {
    await pool().query(
      `TRUNCATE team_memberships, agent_designations, bonus_sale_approvals, reward_program_history, bonus_awards, spin_credit_transactions, automatic_spin_awards, spin_credits,
                sale_status_history, sales_events_inbox, validated_sales, reward_programs RESTART IDENTITY CASCADE`,
    );
    await pool().query(`UPDATE teams SET leader_user_code = NULL`);
    await pool().query(`DELETE FROM teams`);
    await pool().query(`DELETE FROM agents`);
    await pool().query(`DELETE FROM admin_settings WHERE key = 'arena.config'`);
    await setSetting("auto_spins_enabled", false);
    await setSetting("reward_activation_cutoff", null);
    await putConfig(req("/api/admin/arena-config", { method: "PUT", body: { values: { businessTimezone: "UTC", weekStartDay: 1, rewardCategories: ALL_ON } }, ...as() }));
    closerList = [];
    rangeFigures = {};
    closerCalls = [];
    events = [];
    off = arenaBroadcaster.subscribe((e) => events.push(e));
  });
  afterEach(() => off());

  // ------------------------------------------------------------------ 1–6: model

  it("migration 010: tables, constraints and the reward audience column (existing programmes default to all)", async () => {
    const cols = (await pool().query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'reward_programs' AND column_name = 'audience'`)).rowCount;
    expect(cols).toBe(1);
    for (const t of ["team_memberships", "agent_designations"]) expect((await pool().query(`SELECT to_regclass($1) AS t`, [t])).rows[0].t).toBe(t);
    // A Junior audience requires a junior reward group (database-level guard as well as the API).
    await pool().query(`INSERT INTO reward_programs (id, kind, name, headline, message, reward_line, audience, reward_group) VALUES ('px', 'daily', 'x', '', '', '', 'senior', 'default')`);
    await expect(pool().query(`UPDATE reward_programs SET audience = 'junior' WHERE id = 'px'`)).rejects.toThrow(/chk_reward_programs_audience/);
    await expect(pool().query(`UPDATE reward_programs SET reward_group = 'junior' WHERE id = 'px'`)).rejects.toThrow(/chk_reward_programs_audience/);
    expect((await pool().query(`SELECT audience FROM reward_programs WHERE id = 'px'`)).rows[0].audience).toBe("senior");
  });

  it("team creation, logo association, unique names, safe logo validation; Admin API needs a session (+ CSRF)", async () => {
    const t = await createTeam(pool(), { name: "Team Alpha", slug: "alpha", logoUrl: "/teams/team-alpha.webp", color: "#22D3FF" }, actor);
    expect(t).toMatchObject({ id: "team_alpha", slug: "alpha", logoUrl: "/teams/team-alpha.webp", active: true, memberCount: 0 });
    await expect(createTeam(pool(), { name: "team alpha" }, actor)).rejects.toMatchObject({ status: 409 });
    await expect(updateTeam(pool(), t.id, { logoUrl: "data:image/svg+xml;base64,PHN2Zz4=" }, actor)).rejects.toThrow(/PNG, JPEG or WebP/);
    await expect(updateTeam(pool(), t.id, { logoUrl: "https://evil.example/x.png" }, actor)).rejects.toThrow(/PNG, JPEG or WebP/);
    await expect(updateTeam(pool(), t.id, { logoUrl: `data:image/png;base64,${"A".repeat(400_100)}` }, actor)).rejects.toThrow(/300 KB/);
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    expect((await updateTeam(pool(), t.id, { logoUrl: png }, actor)).logoUrl).toBe(png);
    expect(events.some((e) => e.type === "teams.updated")).toBe(true);
    expect((await createTeamRoute(req("/api/admin/teams", { method: "POST", body: { name: "Team X" } }))).status).toBe(401);
    expect((await createTeamRoute(req("/api/admin/teams", { method: "POST", body: { name: "Team X" }, cookie: owner.cookie }))).status).toBe(403); // no CSRF
    const audit = (await pool().query(`SELECT action FROM audit_logs WHERE target_type = 'team' ORDER BY id`)).rows.map((r) => r.action);
    expect(audit).toEqual(["team.created", "team.updated"]);
  });

  it("assignment, duplicate prevention, effective-dated transfer, same-day correction, removal and history", async () => {
    const a = await createTeam(pool(), { name: "Team Alpha", slug: "alpha" }, actor);
    const b = await createTeam(pool(), { name: "Team Panthers", slug: "panthers" }, actor);
    await createAgent("CLS-T1", "Tess One");
    const d0 = addDays(today(), -10);
    expect((await assignMember(pool(), { userCode: "cls-t1", teamId: a.id, effectiveFrom: d0, designation: "senior" }, actor)).action).toBe("assigned");
    await expect(assignMember(pool(), { userCode: "CLS-T1", teamId: a.id, effectiveFrom: d0 }, actor)).rejects.toMatchObject({ status: 409 }); // already in Alpha
    await expect(assignMember(pool(), { userCode: "CLS-NOPE", teamId: a.id }, actor)).rejects.toMatchObject({ status: 404 }); // no invented identities
    await expect(assignMember(pool(), { userCode: "CLS-T1", teamId: b.id, effectiveFrom: addDays(d0, -1) }, actor)).rejects.toThrow(/starts on/); // before the current membership
    const d1 = addDays(today(), -3);
    expect((await assignMember(pool(), { userCode: "CLS-T1", teamId: b.id, effectiveFrom: d1 }, actor)).action).toBe("transferred");
    const rows = (await pool().query(`SELECT team_id, effective_from::text f, effective_to::text t FROM team_memberships WHERE user_code = 'CLS-T1' ORDER BY id`)).rows;
    expect(rows).toEqual([{ team_id: a.id, f: d0, t: d1 }, { team_id: b.id, f: d1, t: null }]); // history kept, ranges contiguous
    await expect(assignMember(pool(), { userCode: "CLS-T1", teamId: a.id, effectiveFrom: addDays(d1, -1) }, actor)).rejects.toThrow(/starts on|overlaps/);
    // Same-day change = correction of that day's assignment (not a zero-length membership).
    await createAgent("CLS-T2", "Tom Two");
    await assignMember(pool(), { userCode: "CLS-T2", teamId: a.id }, actor);
    expect((await assignMember(pool(), { userCode: "CLS-T2", teamId: b.id }, actor)).action).toBe("corrected");
    expect(await count("team_memberships")).toBe(3);
    // Removal from a date keeps the earlier days; removing a same-day assignment deletes it (it never counted).
    await removeMember(pool(), { userCode: "CLS-T1", effectiveFrom: today() }, actor);
    expect((await pool().query(`SELECT effective_to::text t FROM team_memberships WHERE user_code = 'CLS-T1' AND team_id = $1`, [b.id])).rows[0].t).toBe(today());
    await removeMember(pool(), { userCode: "CLS-T2" }, actor);
    expect((await pool().query(`SELECT COUNT(*)::int n FROM team_memberships WHERE user_code = 'CLS-T2'`)).rows[0].n).toBe(0);
    await expect(removeMember(pool(), { userCode: "CLS-T2" }, actor)).rejects.toMatchObject({ status: 404 });
    // Inactive teams take no new members; the database refuses a second open membership outright.
    await updateTeam(pool(), a.id, { active: false }, actor);
    await expect(assignMember(pool(), { userCode: "CLS-T2", teamId: a.id }, actor)).rejects.toThrow(/inactive/);
    await expect(pool().query(`INSERT INTO team_memberships (team_id, user_code, effective_from) VALUES ($1, 'CLS-T1', $2), ($1, 'CLS-T1', $2)`, [b.id, addDays(today(), 1)])).rejects.toThrow(/uq_team_memberships_open/);
    expect((await teamHistory(pool(), { userCode: "CLS-T1" })).map((h) => h.team)).toEqual(["Team Panthers", "Team Alpha"]);
    const actions = (await pool().query(`SELECT action FROM audit_logs WHERE target_type = 'agent' ORDER BY id`)).rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["team.member_assigned", "team.member_transferred", "team.member_corrected", "team.member_removed", "agent.designation_set"]));
  });

  it("Senior / Junior designation is effective-dated and read by business date", async () => {
    await createAgent("CLS-D1", "Dee");
    await setDesignation(pool(), { userCode: "CLS-D1", designation: "junior", effectiveFrom: addDays(today(), -20) }, actor);
    await setDesignation(pool(), { userCode: "CLS-D1", designation: "senior", effectiveFrom: addDays(today(), -5) }, actor);
    expect(await designationOn(pool(), "CLS-D1", addDays(today(), -21))).toBeNull();
    expect(await designationOn(pool(), "CLS-D1", addDays(today(), -10))).toBe("junior");
    expect(await designationOn(pool(), "CLS-D1", today())).toBe("senior");
    await expect(setDesignation(pool(), { userCode: "CLS-D1", designation: "senior" }, actor)).rejects.toMatchObject({ status: 409 });
    await expect(setDesignation(pool(), { userCode: "CLS-D1", designation: "manager" }, actor)).rejects.toBeInstanceOf(TeamError);
  });

  // ------------------------------------------------------------------ 7–9 & 14: roster import

  it("read-only preview classifies real identities; the Owner's import writes once, never invents codes, never duplicates", async () => {
    // Safe Quote knows most (not all) roster names, some under longer names; one name is shared by two people.
    closerList = [
      { userCode: "CLS-REHAN", name: "Rehan Ali" },
      { userCode: "CLS-ADEEL", name: "Muhammad Adeel Afzal" },
      { userCode: "CLS-USWA", name: "Uswa E Husna" },
      { userCode: "CLS-URWAH", name: "Urwah Malik" },
      { userCode: "CLS-ISMAIL", name: "Ismail Khan" },
    ];
    await createAgent("CLS-HAMNA", "Hamna Nasir"); // only in PostgreSQL
    const before = { teams: await count("teams"), m: await count("team_memberships"), d: await count("agent_designations"), a: await count("agents") };
    expect((await previewRoute(new NextRequest(new URL("http://arena.test/api/admin/teams/import"), { headers: { cookie: staff.cookie } }))).status).toBe(403); // Owner only
    const pv = await json(await previewRoute(new NextRequest(new URL("http://arena.test/api/admin/teams/import"), { headers: { cookie: owner.cookie } })));
    expect(pv.status).toBe(200);
    const row = (n: string) => pv.body.teams.flatMap((t: { members: unknown[] }) => t.members).find((m: { rosterName: string }) => m.rosterName === n);
    expect(row("Rehan Ali")).toMatchObject({ status: "exact", candidates: [{ userCode: "CLS-REHAN" }] });
    expect(row("Hamna Nasir")).toMatchObject({ status: "exact", candidates: [{ userCode: "CLS-HAMNA", sources: ["agents"] }] });
    expect(row("Adeel Afzal")).toMatchObject({ status: "possible", candidates: [{ userCode: "CLS-ADEEL" }] });
    expect(row("Uswah").status).toBe("multiple"); // Urwah / Uswa: a person decides
    expect(row("Roger Robinson")).toMatchObject({ status: "unmatched", candidates: [] });
    expect(pv.body.teams[1].leaderCandidates[0]).toMatchObject({ userCode: "CLS-ISMAIL" }); // header-row name: leader candidate only
    expect({ teams: await count("teams"), m: await count("team_memberships"), d: await count("agent_designations"), a: await count("agents") }).toEqual(before); // preview wrote nothing

    const post = (body: unknown, s = owner) => importRoute(req("/api/admin/teams/import", { method: "POST", body, ...as(s) }));
    const members = [
      { teamSlug: "alpha", rosterName: "Rehan Ali", userCode: "CLS-REHAN" },
      { teamSlug: "alpha", rosterName: "Uswah", userCode: "CLS-USWA" },
      { teamSlug: "panthers", rosterName: "Hamna Nasir", userCode: "CLS-HAMNA" },
      { teamSlug: "sigma", rosterName: "Adeel Afzal", userCode: "CLS-ADEEL" },
      { teamSlug: "alpha", rosterName: "Roger Robinson", userCode: null },
    ];
    expect((await post({ confirm: true, members }, staff)).status).toBe(403);
    expect((await post({ members })).status).toBe(400); // explicit confirmation required
    expect((await json(await post({ confirm: true, members: [...members.slice(0, 4), { teamSlug: "alpha", rosterName: "Hina Javed", userCode: "CLS-INVENTED" }] }))).body.error).toMatch(/never invented/);
    expect((await json(await post({ confirm: true, members: [...members.slice(0, 4), { teamSlug: "alpha", rosterName: "Hina Javed", userCode: "CLS-REHAN" }] }))).body.error).toMatch(/more than one/);
    expect((await post({ confirm: true, members: [{ teamSlug: "alpha", rosterName: "Imad Tariq", userCode: "CLS-REHAN" }] })).status).toBe(400); // a leader row is not a member
    expect(await count("team_memberships")).toBe(0); // every refused import wrote nothing

    const ok = await json(await post({ confirm: true, effectiveFrom: addDays(today(), -3), members, leaders: { panthers: "CLS-ISMAIL" } }));
    expect(ok.status, ok.body.error).toBe(201);
    expect(ok.body).toMatchObject({ teamsCreated: 3, assigned: 4, agentsAdded: 4, skipped: [{ rosterName: "Roger Robinson" }] });
    const teams = (await pool().query(`SELECT slug, name, logo_url, leader_user_code FROM teams ORDER BY display_order`)).rows;
    expect(teams.map((t) => [t.slug, t.name, t.logo_url])).toEqual([["alpha", "Team Alpha", "/teams/team-alpha.webp"], ["panthers", "Team Panthers", "/teams/team-panthers.webp"], ["sigma", "Team Sigma", "/teams/team-sigma.webp"]]);
    expect(teams[1].leader_user_code).toBe("CLS-ISMAIL");
    expect((await pool().query(`SELECT COUNT(*)::int n FROM team_memberships WHERE user_code = 'CLS-ISMAIL'`)).rows[0].n).toBe(0); // leader ≠ member
    expect(await designationOn(pool(), "CLS-USWA", today())).toBe("senior");
    // Real Safe Quote closers got agents rows under their authoritative codes (same id scheme as ingestion).
    expect((await pool().query(`SELECT id, name FROM agents WHERE user_code = 'CLS-ADEEL'`)).rows[0]).toEqual({ id: "agt_CLS-ADEEL", name: "Muhammad Adeel Afzal" });
    const again = await json(await post({ confirm: true, effectiveFrom: addDays(today(), -3), members }));
    expect(again.body).toMatchObject({ teamsCreated: 0, assigned: 0, unchanged: 4 }); // idempotent
    expect((await pool().query(`SELECT action FROM audit_logs WHERE action = 'teams.roster_imported'`)).rowCount).toBe(2);
  });

  it("all 30 roster members appear (10 per team, zero-sale included) once all identities are verified", async () => {
    closerList = INITIAL_ROSTER.flatMap((t) => t.members.map((m) => ({ userCode: `CLS-${m.name.toUpperCase().replace(/[^A-Z]/g, "")}`, name: m.name })));
    const pv = await json(await previewRoute(new NextRequest(new URL("http://arena.test/api/admin/teams/import"), { headers: { cookie: owner.cookie } })));
    expect(pv.body.summary).toMatchObject({ total: 30, exact: 30 });
    const members = pv.body.teams.flatMap((t: { slug: string; members: Array<{ rosterName: string; candidates: Array<{ userCode: string }> }> }) => t.members.map((m) => ({ teamSlug: t.slug, rosterName: m.rosterName, userCode: m.candidates[0].userCode })));
    expect((await importRoute(req("/api/admin/teams/import", { method: "POST", body: { confirm: true, members }, ...as() }))).status).toBe(201);
    rangeFigures = { "*": [{ userCode: "CLS-REHANALI", name: "Rehan Ali", submitted: 4, validated: 2, closeRate: 50 }] };
    const s = await computeStandings(pool(), "month", { closers: fakeClosers });
    expect(s.teams.map((t) => [t.name, t.members.length])).toEqual([["Team Alpha", 10], ["Team Panthers", 10], ["Team Sigma", 10]]);
    expect(s.teams.flatMap((t) => t.members).filter((m) => m.validated === 0)).toHaveLength(29);
    expect(s.teams[0].members[0]).toMatchObject({ name: "Rehan Ali", rank: 1, validated: 2, designation: "senior" });
    expect(s.teams.flatMap((t) => t.members).filter((m) => m.designation === "junior")).toHaveLength(15);
    expect(closerCalls).toHaveLength(1); // one Safe Quote request for 30 agents (no per-agent queries)
  });

  // ------------------------------------------------------------------ 10–20: standings

  it("standings: team and member ranking, ties broken by submitted leads, Safe Quote's own figures, top 3", async () => {
    const a = await createTeam(pool(), { name: "Team Alpha", slug: "alpha" }, actor);
    const b = await createTeam(pool(), { name: "Team Panthers", slug: "panthers" }, actor);
    for (const [code, team] of [["A1", a], ["A2", a], ["B1", b], ["B2", b]] as const) {
      await createAgent(`CLS-${code}`, `Agent ${code}`);
      await assignMember(pool(), { userCode: `CLS-${code}`, teamId: team.id, effectiveFrom: addDays(today(), -40), designation: code.endsWith("2") ? "junior" : "senior" }, actor);
    }
    rangeFigures = {
      "*": [
        { userCode: "CLS-A1", name: "x", submitted: 6, validated: 3, closeRate: 50 },
        { userCode: "CLS-B1", name: "x", submitted: 5, validated: 2, closeRate: 40 },
        { userCode: "CLS-B2", name: "x", submitted: 4, validated: 1, closeRate: 25 },
        { userCode: "CLS-ZZ", name: "not on a team", submitted: 50, validated: 40, closeRate: 80 },
      ],
    };
    const s = await computeStandings(pool(), "day", { closers: fakeClosers });
    // Tied on validated (3 vs 3): Panthers has more submitted leads (9 vs 6).
    expect(s.teams.map((t) => [t.name, t.rank, t.validated, t.submitted])).toEqual([["Team Panthers", 1, 3, 9], ["Team Alpha", 2, 3, 6]]);
    expect(s.leaderTeamId).toBe(b.id);
    expect(s.teams[1].members.map((m) => [m.userCode, m.rank, m.validated, m.closeRate])).toEqual([["CLS-A1", 1, 3, 50], ["CLS-A2", 2, 0, null]]);
    expect(s.top.map((p) => p.userCode)).toEqual(["CLS-A1", "CLS-B1", "CLS-B2"]); // only team members
    // The public API serves the same thing; bad periods are refused.
    const api = await json(await standingsRoute(new NextRequest(new URL("http://arena.test/api/arena/teams?period=day"))));
    expect(api.body.teams.map((t: { name: string }) => t.name)).toEqual(["Team Panthers", "Team Alpha"]);
    expect((await standingsRoute(new NextRequest(new URL("http://arena.test/api/arena/teams?period=year")))).status).toBe(400);
  });

  it("business periods: Today / This Week / This Month follow the business timezone and week start", async () => {
    await putConfig(req("/api/admin/arena-config", { method: "PUT", body: { values: { businessTimezone: "Asia/Karachi", weekStartDay: 1 } }, ...as() }));
    const now = new Date("2026-11-04T20:30:00Z"); // Thu 5 Nov 01:30 in Karachi
    const day = await computeStandings(pool(), "day", { closers: fakeClosers, now });
    const week = await computeStandings(pool(), "week", { closers: fakeClosers, now });
    const month = await computeStandings(pool(), "month", { closers: fakeClosers, now });
    expect([day.from, day.to]).toEqual(["2026-11-05", "2026-11-05"]);
    expect([week.from, week.to]).toEqual(["2026-11-02", "2026-11-05"]); // Monday start
    expect([month.from, month.to]).toEqual(["2026-11-01", "2026-11-05"]);
    const monthRollover = await computeStandings(pool(), "month", { closers: fakeClosers, now: new Date("2026-11-30T19:30:00Z") }); // Dec 1, 00:30 Karachi
    expect([monthRollover.from, monthRollover.to]).toEqual(["2026-12-01", "2026-12-01"]);
  });

  it("a transfer inside the period splits the agent's figures by business day (past days stay with the old team)", async () => {
    const a = await createTeam(pool(), { name: "Team Alpha", slug: "alpha" }, actor);
    const b = await createTeam(pool(), { name: "Team Sigma", slug: "sigma" }, actor);
    await createAgent("CLS-MOVER", "Mo Ver");
    const now = new Date("2026-11-05T12:00:00Z"); // Thursday; week Mon 2 – Thu 5 (UTC)
    await assignMember(pool(), { userCode: "CLS-MOVER", teamId: a.id, effectiveFrom: addDays(today(), -60) }, actor);
    await pool().query(`UPDATE team_memberships SET effective_from = '2026-09-01'`);
    await pool().query(`UPDATE team_memberships SET effective_to = '2026-11-04' WHERE user_code = 'CLS-MOVER'`);
    await pool().query(`INSERT INTO team_memberships (team_id, user_code, effective_from) VALUES ($1, 'CLS-MOVER', '2026-11-04')`, [b.id]);
    rangeFigures = {
      "2026-11-02|2026-11-05": [{ userCode: "CLS-MOVER", name: "x", submitted: 7, validated: 5, closeRate: 71.4 }],
      "2026-11-02|2026-11-03": [{ userCode: "CLS-MOVER", name: "x", submitted: 4, validated: 3, closeRate: 75 }],
      "2026-11-04|2026-11-05": [{ userCode: "CLS-MOVER", name: "x", submitted: 3, validated: 2, closeRate: 66.7 }],
    };
    const s = await computeStandings(pool(), "week", { closers: fakeClosers, now });
    const of = (id: string) => s.teams.find((t) => t.id === id)!;
    expect(of(a.id).members[0]).toMatchObject({ userCode: "CLS-MOVER", validated: 3, submitted: 4, former: true });
    expect(of(b.id).members[0]).toMatchObject({ userCode: "CLS-MOVER", validated: 2, submitted: 3, former: false });
    expect(of(a.id).memberCount).toBe(0); // a former member is listed for their days but not counted as a member
    expect(closerCalls.sort()).toEqual(["2026-11-02|2026-11-03", "2026-11-02|2026-11-05", "2026-11-04|2026-11-05"]);
    // Today only: the agent is simply in Sigma.
    const d = await computeStandings(pool(), "day", { closers: fakeClosers, now });
    expect(d.teams.find((t) => t.id === a.id)!.members).toEqual([]);
  });

  // ------------------------------------------------------------------ 21–30: real time

  it("a genuine sale through the real pipeline updates the right agent and team, broadcasts once, and the background check sees team changes", async () => {
    const a = await createTeam(pool(), { name: "Team Alpha", slug: "alpha" }, actor);
    const s = await createTeam(pool(), { name: "Team Sigma", slug: "sigma" }, actor);
    await createAgent("CLS-RT1", "Real Time");
    await createAgent("CLS-RT2", "Other Guy");
    await assignMember(pool(), { userCode: "CLS-RT1", teamId: s.id, effectiveFrom: addDays(today(), -5) }, actor);
    await assignMember(pool(), { userCode: "CLS-RT2", teamId: a.id, effectiveFrom: addDays(today(), -5) }, actor);
    rangeFigures = { "*": [{ userCode: "CLS-RT2", name: "x", submitted: 2, validated: 1, closeRate: 50 }] };
    const before = await computeStandings(pool(), "day", { closers: fakeClosers });
    expect(before.leaderTeamId).toBe(a.id);
    __resetSyncState();
    const fp0 = (await readSyncState(pool())).fp;
    // The sale: stored, committed and broadcast by the existing pipeline; Safe Quote now counts it.
    await ingestValidatedSale(pool(), sale("CLS-RT1", minsAgo(1)), "sse");
    await ingestValidatedSale(pool(), sale("CLS-RT1", minsAgo(1)), "sse"); // a different case: two sales
    rangeFigures = { "*": [{ userCode: "CLS-RT1", name: "x", submitted: 2, validated: 2, closeRate: 100 }, { userCode: "CLS-RT2", name: "x", submitted: 2, validated: 1, closeRate: 50 }] };
    const after = await computeStandings(pool(), "day", { closers: fakeClosers });
    expect(after.leaderTeamId).toBe(s.id); // Sigma takes the lead
    expect(after.teams.find((t) => t.id === s.id)!.members[0]).toMatchObject({ userCode: "CLS-RT1", validated: 2 });
    expect(after.teams.find((t) => t.id === a.id)!.validated).toBe(1);
    expect(events.filter((e) => e.type === "sale.validated").map((e) => (e.payload as { userCode: string }).userCode)).toEqual(["CLS-RT1", "CLS-RT1"]);
    // Team changes reach displays by the stream event and by the 15 s background check fingerprint.
    await removeMember(pool(), { userCode: "CLS-RT2" }, actor);
    expect(events.filter((e) => e.type === "teams.updated").length).toBeGreaterThanOrEqual(1);
    __resetSyncState();
    const fp1 = (await readSyncState(pool())).fp;
    expect(fp1.teams).not.toBe(fp0.teams);
    expect(fp1.sales).not.toBe(fp0.sales);
    // Team competition never touches money: no award, no programme, no spin was created by any of this.
    expect(await count("bonus_awards")).toBe(0);
    expect(await count("spin_credit_transactions")).toBe(0);
  });

  // ------------------------------------------------------------------ 31–41: rewards

  it("existing all-agent programmes are unchanged (Senior and Junior both earn) until the Owner's audience change", async () => {
    await program({ name: "Daily 2", salesRequired: 2, amount: 2000 });
    for (const [u, d] of [["CLS-SR", "senior"], ["CLS-JR", "junior"]] as const) {
      await createAgent(u);
      await setDesignation(pool(), { userCode: u, designation: d, effectiveFrom: addDays(today(), -10) }, actor);
      for (const m of [30, 20]) await ingestValidatedSale(pool(), sale(u, minsAgo(m)), "sse");
    }
    expect((await awardsOf("CLS-SR")).map((r) => Number(r.amount))).toEqual([2000]);
    expect((await awardsOf("CLS-JR")).map((r) => Number(r.amount))).toEqual([2000]); // today's behaviour, unchanged
  });

  it("Owner audience review: read-only preview, Owner-only apply, existing awards untouched, Juniors stop earning Senior-only programmes", async () => {
    const p2 = await program({ name: "FE Senior Daily 2", salesRequired: 2, amount: 2000 });
    const p3 = await program({ name: "FE Senior Daily 3", salesRequired: 3, amount: 3000 });
    for (const [u, d] of [["CLS-SR", "senior"], ["CLS-JR", "junior"]] as const) {
      await createAgent(u);
      await setDesignation(pool(), { userCode: u, designation: d, effectiveFrom: addDays(today(), -10) }, actor);
      for (const m of [60, 50]) await ingestValidatedSale(pool(), sale(u, minsAgo(m)), "sse");
    }
    await createAgent("CLS-NONE", "No Designation");
    // Earlier history: the Junior's 2,000 award was paid.
    const jrAward = (await awardsOf("CLS-JR"))[0];
    await patchAwardRoute(req(`/api/admin/awards/x`, { method: "PATCH", body: { status: "approved" }, ...as() }), { params: Promise.resolve({ id: (await pool().query(`SELECT id FROM bonus_awards WHERE user_code = 'CLS-JR'`)).rows[0].id }) });
    const snapshot = async () => (await pool().query(`SELECT id, amount, status, superseded_by, payable_amount FROM bonus_awards ORDER BY id`)).rows;
    const history = await snapshot();

    const get = (s = owner) => audiencePreviewRoute(new NextRequest(new URL("http://arena.test/api/admin/programs/audience"), { headers: { cookie: s.cookie } }));
    expect((await get(staff)).status).toBe(403);
    const pv = await json(await get());
    expect(pv.body.programs.filter((p: { proposedAudience: string }) => p.proposedAudience === "senior").map((p: { id: string }) => p.id).sort()).toEqual([p2.id, p3.id].sort());
    expect(pv.body.impact.juniorsWhoStopQualifying.map((a: { userCode: string }) => a.userCode)).toEqual(["CLS-JR"]);
    expect(pv.body.impact.undesignatedWhoStopQualifying.map((a: { userCode: string }) => a.userCode)).toEqual(["CLS-NONE"]);
    expect(await snapshot()).toEqual(history); // read-only

    const apply = (body: unknown, s = owner) => audienceApplyRoute(req("/api/admin/programs/audience", { method: "POST", body, ...as(s) }));
    expect((await apply({ confirm: true, programIds: [p2.id, p3.id], reason: "Senior-only bonuses" }, staff)).status).toBe(403);
    expect((await apply({ programIds: [p2.id], reason: "Senior-only bonuses" })).status).toBe(400);
    expect((await apply({ confirm: true, programIds: [p2.id, p3.id], reason: "x" })).status).toBe(400); // reason required
    const ok = await json(await apply({ confirm: true, programIds: [p2.id, p3.id], reason: "Senior-only bonuses (owner approved)" }));
    expect(ok.status, ok.body.error).toBe(200);
    expect((await pool().query(`SELECT audience FROM reward_programs ORDER BY sales_required`)).rows.map((r) => r.audience)).toEqual(["senior", "senior"]);
    expect(await snapshot()).toEqual(history); // paid / earned awards unchanged
    expect((await apply({ confirm: true, programIds: [p2.id], reason: "again please" })).status).toBe(409);
    expect((await pool().query(`SELECT action FROM audit_logs WHERE action = 'reward_program.audience_changed'`)).rowCount).toBe(2);
    // An ordinary programme edit cannot flip the audience back.
    expect((await patchProgramRoute(req(`/api/admin/programs/${p2.id}`, { method: "PATCH", body: { audience: "all" }, ...as() }), { params: Promise.resolve({ id: p2.id }) })).status).toBe(409);

    // Third sale: the Senior upgrades to 3,000 (+1,000, never 5,000); the Junior does not.
    await ingestValidatedSale(pool(), sale("CLS-SR", minsAgo(5)), "sse");
    await ingestValidatedSale(pool(), sale("CLS-JR", minsAgo(5)), "sse");
    expect((await awardsOf("CLS-SR")).map((r) => [Number(r.amount), !!r.superseded_by])).toEqual([[2000, true], [3000, false]]);
    expect((await awardsOf("CLS-JR")).map((r) => [Number(r.amount), r.status])).toEqual([[2000, jrAward.status === "earned" ? "approved" : "approved"]]);
    for (const m of [3, 2]) await ingestValidatedSale(pool(), sale("CLS-NONE", minsAgo(m)), "sse");
    expect(await awardsOf("CLS-NONE")).toEqual([]); // no designation: no Senior-only bonus
  });

  it("Junior programmes: empty → nothing; blocked next to all-agent ones; when configured they award, upgrade, show in history and never supersede Senior tiers", async () => {
    await createAgent("CLS-J1", "Junior One");
    await setDesignation(pool(), { userCode: "CLS-J1", designation: "junior", effectiveFrom: addDays(today(), -10) }, actor);
    const sr = await program({ name: "Senior Daily 2", salesRequired: 2, amount: 2000 });
    // No Junior programme yet: nothing is ever created for Juniors (the all-agent one still applies to everyone).
    const scanJr = async () => json(await scanRoute(req("/api/admin/awards/recovery/scan", { method: "POST", body: { from: today(), to: today(), audience: "junior" }, ...as() })));
    expect((await scanJr()).body).toMatchObject({ audience: "junior", programGroups: 0, items: [] });
    // A Junior programme cannot start while an all-agent one of that period is active (a Junior would earn both).
    const blocked = await createProgramRoute(req("/api/admin/programs", { method: "POST", body: { kind: "daily", name: "Jr Daily 1", rewardType: "cash", currency: "PKR", amount: 500, salesRequired: 1, enabled: true, audience: "junior" }, ...as() }));
    expect(blocked.status).toBe(409);
    await audienceApplyRoute(req("/api/admin/programs/audience", { method: "POST", body: { confirm: true, programIds: [sr.id], reason: "Senior-only bonuses" }, ...as() }));
    const j1 = await program({ name: "Jr Daily 1", salesRequired: 1, amount: 500, audience: "junior" });
    const j2 = await program({ name: "Jr Daily 2", salesRequired: 2, amount: 1200, audience: "junior" });
    expect([j1.audience, j1.rewardGroup, j2.rewardGroup]).toEqual(["junior", "junior", "junior"]);
    await ingestValidatedSale(pool(), sale("CLS-J1", minsAgo(30)), "sse");
    await ingestValidatedSale(pool(), sale("CLS-J1", minsAgo(20)), "sse");
    const rows = await awardsOf("CLS-J1");
    expect(rows.map((r) => [Number(r.amount), r.reward_group, !!r.superseded_by])).toEqual([[500, "junior", true], [1200, "junior", false]]); // 1,200 total, never 1,700
    const popup = events.filter((e) => e.type === "rewards.award.created").at(-1)!.payload as { award: { amount: number; incrementAmount: number; upgrade: boolean } };
    expect(popup.award).toMatchObject({ amount: 1200, incrementAmount: 700, upgrade: true });
    // Award History filters by audience.
    const list = async (audience: string) => (await json(await listAwardsRoute(new NextRequest(new URL(`http://arena.test/api/admin/awards?audience=${audience}`), { headers: { cookie: owner.cookie } })))).body.awards.length;
    expect([await list("junior"), await list("senior")]).toEqual([2, 0]);
    // The same agent becomes Senior tomorrow-style (today, later sale): the Senior chain is separate; nothing Junior is superseded.
    await setDesignation(pool(), { userCode: "CLS-J1", designation: "senior", effectiveFrom: today() }, actor).catch(() => pool().query(`UPDATE agent_designations SET designation = 'senior' WHERE user_code = 'CLS-J1'`));
    await ingestValidatedSale(pool(), sale("CLS-J1", minsAgo(1)), "sse");
    const after = await awardsOf("CLS-J1");
    expect(after.filter((r) => r.reward_group === "junior").map((r) => [Number(r.amount), !!r.superseded_by])).toEqual([[500, true], [1200, false]]);
    expect(after.filter((r) => r.reward_group === "default").map((r) => Number(r.amount))).toEqual([2000]);
  });

  it("a missed Junior award is found by the Owner's Junior scan and recovered through the existing workflow", async () => {
    await createAgent("CLS-J2", "Junior Two");
    await setDesignation(pool(), { userCode: "CLS-J2", designation: "junior", effectiveFrom: addDays(today(), -10) }, actor);
    const j = await program({ name: "Jr Daily 2", salesRequired: 2, amount: 1000, audience: "junior" }, 600);
    // Two sales stored without evaluation (e.g. by an older release): genuinely missed.
    for (const m of [40, 30]) {
      const caseId = `MISS-${seq++}`;
      await pool().query(
        `INSERT INTO validated_sales (id, case_id, user_code, agent_id, validated_at, premium, raw_payload, reward_processed, source, reward_eligible, closer_name, status)
         VALUES ($1, $2, 'CLS-J2', (SELECT id FROM agents WHERE user_code = 'CLS-J2'), $3, 0, '{}'::jsonb, TRUE, 'sse', FALSE, 'Junior Two', 'validated')`,
        [`sale_${caseId}`, caseId, minsAgo(m)],
      );
    }
    const scan = await json(await scanRoute(req("/api/admin/awards/recovery/scan", { method: "POST", body: { from: today(), to: today(), audience: "junior" }, ...as() })));
    expect(scan.body.items).toHaveLength(1);
    expect(scan.body.items[0]).toMatchObject({ userCode: "CLS-J2", rewardGroup: "junior", audience: "junior", proposed: { amount: 1000 } });
    expect(await awardsOf("CLS-J2")).toEqual([]); // scanning wrote nothing
    const seniorScan = await json(await scanRoute(req("/api/admin/awards/recovery/scan", { method: "POST", body: { from: today(), to: today(), audience: "senior" }, ...as() })));
    expect(seniorScan.body.items).toEqual([]);
    const ok = await recoveryApplyRoute(
      req("/api/admin/awards/recovery", { method: "POST", body: { userCode: "CLS-J2", kind: "daily", rewardGroup: "junior", periodDate: today(), expectProgramId: j.id, reason: "Owner-approved Junior catch-up", confirm: true }, ...as() }),
    );
    expect(ok.status, (await ok.clone().json()).error).toBe(201);
    expect((await awardsOf("CLS-J2")).map((r) => [Number(r.amount), r.reward_group])).toEqual([[1000, "junior"]]);
    expect((await recoveryApplyRoute(req("/api/admin/awards/recovery", { method: "POST", body: { userCode: "CLS-J2", kind: "daily", rewardGroup: "junior", periodDate: today(), reason: "Owner-approved Junior catch-up again", confirm: true }, ...as() }))).status).toBe(409);
  });

  it("Team Management API: list, assign through the API, admin (non-owner) may manage members", async () => {
    const t = await createTeam(pool(), { name: "Team Alpha", slug: "alpha" }, actor);
    await createAgent("CLS-API", "Api Agent");
    const r = await membersRoute(req("/api/admin/teams/members", { method: "POST", body: { userCode: "CLS-API", teamId: t.id, designation: "junior" }, ...as(staff) }));
    expect(r.status, (await r.clone().json()).error).toBe(200);
    const v = await json(await teamsRoute(new NextRequest(new URL("http://arena.test/api/admin/teams"), { headers: { cookie: staff.cookie } })));
    expect(v.body.members).toEqual([expect.objectContaining({ userCode: "CLS-API", teamId: t.id, designation: "junior" })]);
    expect(v.body.unassigned).toEqual([]);
  });

  it("archiving a team (Team Alpha) is reversible: out of the live competition, nobody moved, history / sales / awards untouched; members can be transferred out one by one", async () => {
    const alpha = await createTeam(pool(), { name: "Team Alpha", slug: "alpha", color: "#22D3FF" }, actor);
    const panthers = await createTeam(pool(), { name: "Team Panthers", slug: "panthers", color: "#A855F7" }, actor);
    const sigma = await createTeam(pool(), { name: "Team Sigma", slug: "sigma", color: "#8B5CF6" }, actor);
    const from = addDays(today(), -10);
    for (const [code, team] of [["CLS-AL1", alpha], ["CLS-AL2", alpha], ["CLS-PA1", panthers], ["CLS-SI1", sigma]] as const) {
      await createAgent(code, `Agent ${code}`);
      await assignMember(pool(), { userCode: code, teamId: team.id, effectiveFrom: from, designation: "senior" }, actor);
    }
    await program({ name: "Daily 1", salesRequired: 1, amount: 1000 });
    await ingestValidatedSale(pool(), sale("CLS-AL1", minsAgo(30)), "sse"); // an Alpha member already earned a sale + award
    const snap = async () => ({
      memberships: (await pool().query(`SELECT id, team_id, user_code, effective_from::text f, effective_to::text t FROM team_memberships ORDER BY id`)).rows,
      sales: (await pool().query(`SELECT case_id, user_code, status FROM validated_sales ORDER BY case_id`)).rows,
      awards: (await pool().query(`SELECT id, amount, status, superseded_by FROM bonus_awards ORDER BY id`)).rows,
    });
    const before = await snap();
    rangeFigures = { "*": [{ userCode: "CLS-AL1", name: "x", submitted: 9, validated: 9, closeRate: 100 }, { userCode: "CLS-PA1", name: "x", submitted: 3, validated: 2, closeRate: 66.7 }, { userCode: "CLS-SI1", name: "x", submitted: 2, validated: 1, closeRate: 50 }] };
    expect((await computeStandings(pool(), "day", { closers: fakeClosers })).teams.map((t) => t.name)).toEqual(["Team Alpha", "Team Panthers", "Team Sigma"]);

    // Archive Alpha (the existing deactivation; Owner / Admin action, audited, broadcast).
    events = [];
    await updateTeam(pool(), alpha.id, { active: false }, actor);
    const s2 = await computeStandings(pool(), "day", { closers: fakeClosers });
    expect(s2.teams.map((t) => t.name)).toEqual(["Team Panthers", "Team Sigma"]); // head-to-head; Alpha gone from the live competition
    expect(s2.top.map((p) => p.userCode)).toEqual(["CLS-PA1", "CLS-SI1"]); // never an archived member as a current performer
    expect(s2.leaderTeamId).toBe(panthers.id);
    expect(await snap()).toEqual(before); // memberships, sales and awards untouched; nobody relocated
    expect(events.some((e) => e.type === "teams.updated")).toBe(true);
    expect((await teamHistory(pool(), { teamId: alpha.id })).map((h) => h.userCode).sort()).toEqual(["CLS-AL1", "CLS-AL2"]);
    await expect(assignMember(pool(), { userCode: "CLS-PA1", teamId: alpha.id }, actor)).rejects.toThrow(/inactive/); // no new members while archived

    // Owner moves ONE Alpha member to Sigma from today: old membership closed, new one opened, never overlapping.
    expect((await assignMember(pool(), { userCode: "CLS-AL1", teamId: sigma.id, effectiveFrom: today() }, actor)).action).toBe("transferred");
    const al1 = (await pool().query(`SELECT team_id, effective_from::text f, effective_to::text t FROM team_memberships WHERE user_code = CLS-AL1 ORDER BY id`)).rows;
    expect(al1).toEqual([{ team_id: alpha.id, f: from, t: today() }, { team_id: sigma.id, f: today(), t: null }]);
    expect((await pool().query(`SELECT COUNT(*)::int n FROM team_memberships WHERE effective_to IS NULL AND user_code = CLS-AL1`)).rows[0].n).toBe(1);
    const s3 = await computeStandings(pool(), "day", { closers: fakeClosers });
    expect(s3.teams.find((t) => t.id === sigma.id)!.members.map((m) => m.userCode).sort()).toEqual(["CLS-AL1", "CLS-SI1"]); // legitimately transferred: now a Sigma performer
    expect((await pool().query(`SELECT team_id FROM team_memberships WHERE user_code = CLS-AL2 AND effective_to IS NULL`)).rows[0].team_id).toBe(alpha.id); // the other stays put
    expect((await snap()).awards).toEqual(before.awards); // the transfer changed no award
    expect((await snap()).sales).toEqual(before.sales);

    // Reactivate: Alpha is back in the competition with its remaining member.
    await updateTeam(pool(), alpha.id, { active: true }, actor);
    expect((await computeStandings(pool(), "day", { closers: fakeClosers })).teams.map((t) => t.name).sort()).toEqual(["Team Alpha", "Team Panthers", "Team Sigma"]);
    const audit = (await pool().query(`SELECT details FROM audit_logs WHERE action = team.updated AND target_id = $1 ORDER BY id`, [alpha.id])).rows.map((r) => r.details.to.active);
    expect(audit).toEqual([false, true]);
  });

  it("a new team (name, logo, colours, leader, active) joins the competition automatically; with one active team the arena still works", async () => {
    await createAgent("CLS-LEAD", "Lead Agent");
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const r = await json(await createTeamRoute(req("/api/admin/teams", { method: "POST", body: { name: "Team Falcons", color: "#34D399", accentSecondary: "#F5C451", logoUrl: png, leaderUserCode: "CLS-LEAD", active: true }, ...as(staff) })));
    expect(r.status, r.body.error).toBe(201);
    expect(r.body.team).toMatchObject({ name: "Team Falcons", slug: "falcons", logoUrl: png, color: "#34D399", accentSecondary: "#F5C451", leaderUserCode: "CLS-LEAD", active: true });
    await assignMember(pool(), { userCode: "CLS-LEAD", teamId: r.body.team.id, designation: "junior" }, actor);
    const s = await computeStandings(pool(), "week", { closers: fakeClosers });
    expect(s.teams.map((t) => [t.name, t.logoUrl, t.members.length])).toEqual([["Team Falcons", png, 1]]);
    expect((await json(await createTeamRoute(req("/api/admin/teams", { method: "POST", body: { name: "Team X", logoUrl: "data:image/svg+xml;base64,PHN2Zz4=" }, ...as(staff) })))).status).toBe(400); // SVG refused
    const inactive = await json(await createTeamRoute(req("/api/admin/teams", { method: "POST", body: { name: "Team Hawks", active: false }, ...as(staff) })));
    expect(inactive.body.team.active).toBe(false);
    expect((await computeStandings(pool(), "week", { closers: fakeClosers })).teams.map((t) => t.name)).toEqual(["Team Falcons"]);
  });
  // ------------------------------------------------------------------ Teams Arena sale celebrations: attribution

  it("celebration attribution: by user_code and the sale's America/New_York business day (transfer, duplicate names, unassigned, archived)", async () => {
    const sg = await createTeam(pool(), { name: "Team Sigma", slug: "sigma", logoUrl: "/teams/team-sigma.webp" }, actor);
    const pn = await createTeam(pool(), { name: "Team Panthers", slug: "panthers" }, actor);
    const al = await createTeam(pool(), { name: "Team Alpha", slug: "alpha" }, actor);
    for (const [c, n] of [["CLS-MV", "Mover"], ["CLS-D1", "Ali Khan"], ["CLS-D2", "Ali Khan"], ["CLS-UN", "Nobody"], ["CLS-AL", "Archived Member"]]) await createAgent(c, n);
    // Mover: Sigma until (not incl.) 2026-11-05, Panthers from 2026-11-05.
    await pool().query(`INSERT INTO team_memberships (team_id, user_code, effective_from, effective_to) VALUES ($1, 'CLS-MV', '2026-10-01', '2026-11-05'), ($2, 'CLS-MV', '2026-11-05', NULL)`, [sg.id, pn.id]);
    await pool().query(`INSERT INTO team_memberships (team_id, user_code, effective_from) VALUES ($1, 'CLS-D1', '2026-10-01'), ($2, 'CLS-D2', '2026-10-01'), ($3, 'CLS-AL', '2026-10-01')`, [sg.id, pn.id, al.id]);
    await updateTeam(pool(), al.id, { active: false }, actor); // archived (members stay assigned)
    const { teamForSale, teamsForSales } = await import("@/lib/server/teams/attribution");
    // 03:30 UTC on Nov 5 is still Nov 4 in New York: the sale belongs to the team of Nov 4 (Sigma), never "current".
    expect((await teamForSale(pool(), "CLS-MV", "2026-11-05T03:30:00Z"))).toMatchObject({ id: sg.id, slug: "sigma", businessDate: "2026-11-04", active: true, logoUrl: "/teams/team-sigma.webp", hasLogo: true });
    expect((await teamForSale(pool(), "cls-mv", "2026-11-05T15:00:00Z"))).toMatchObject({ id: pn.id, slug: "panthers", businessDate: "2026-11-05" });
    expect((await teamForSale(pool(), "CLS-MV", "2026-09-15T15:00:00Z"))).toBeNull(); // before any membership
    // Same display name, different user codes: each sale goes to its own code's team.
    const [d1, d2, un, ar] = await teamsForSales(pool(), [
      { userCode: "CLS-D1", validatedAt: "2026-11-05T15:00:00Z" },
      { userCode: "CLS-D2", validatedAt: "2026-11-05T15:00:00Z" },
      { userCode: "CLS-UN", validatedAt: "2026-11-05T15:00:00Z" },
      { userCode: "CLS-AL", validatedAt: "2026-11-05T15:00:00Z" },
    ]);
    expect([d1?.slug, d2?.slug]).toEqual(["sigma", "panthers"]);
    expect(un).toBeNull(); // unassigned
    expect(ar).toMatchObject({ id: al.id, active: false }); // archived: reported as inactive, never moved to another team
  });

  it("celebration attribution travels on the live sale event and the background-sync recovery list; it changes no money and no data", async () => {
    const sg = await createTeam(pool(), { name: "Team Sigma", slug: "sigma", logoUrl: `data:image/png;base64,${"A".repeat(400)}` }, actor);
    await createAgent("CLS-EV", "Event Agent");
    await createAgent("CLS-EV0", "No Team");
    await assignMember(pool(), { userCode: "CLS-EV", teamId: sg.id, effectiveFrom: addDays(today(), -5) }, actor);
    const before = { awards: await count("bonus_awards"), spins: await count("spin_credit_transactions"), memberships: await count("team_memberships") };
    const s1 = sale("CLS-EV", minsAgo(1));
    const s2 = sale("CLS-EV0", minsAgo(1));
    await ingestValidatedSale(pool(), s1, "sse");
    await ingestValidatedSale(pool(), s2, "sse");
    await ingestValidatedSale(pool(), s1, "sse"); // duplicate delivery: no second event
    const sales = events.filter((e) => e.type === "sale.validated").map((e) => e.payload as { caseId: string; team?: unknown; storedAt: string; broadcastAt: string });
    expect(sales.map((p) => p.caseId)).toEqual([s1.caseId, s2.caseId]);
    // The uploaded (data URL) logo is never pushed on every sale event: displays use their standings copy.
    expect(sales[0].team).toMatchObject({ id: sg.id, slug: "sigma", name: "Team Sigma", active: true, logoUrl: null, hasLogo: true });
    expect(sales[1].team).toBeNull();
    expect(Date.parse(sales[0].broadcastAt)).toBeGreaterThanOrEqual(Date.parse(sales[0].storedAt)); // commit → broadcast measured
    __resetSyncState();
    const recent = (await readSyncState(pool())).recentSales;
    expect(recent.find((r) => r.caseId === s1.caseId)?.team).toMatchObject({ id: sg.id, slug: "sigma" });
    expect(recent.find((r) => r.caseId === s2.caseId)?.team).toBeNull();
    expect({ awards: await count("bonus_awards"), spins: await count("spin_credit_transactions"), memberships: await count("team_memberships") }).toEqual(before);
  });
});
