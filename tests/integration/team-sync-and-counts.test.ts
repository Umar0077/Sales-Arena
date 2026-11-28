import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createAdmin, pool, req, resetDatabase, sessionFrom, setSetting } from "./helpers";
import { POST as login } from "@/app/api/admin/auth/login/route";
import { GET as arenaTeamsGet } from "@/app/api/arena/teams/route";
import { GET as weeklyTopTeamGet, POST as weeklyTopTeamPost } from "@/app/api/admin/celebrations/weekly-top-team/route";
import { GET as adminAgentsGet } from "@/app/api/admin/spins/agents/route";
import { GET as adminTeamsGet } from "@/app/api/admin/teams/route";
import { POST as adminTeamMembersPost } from "@/app/api/admin/teams/members/route";
import { ingestValidatedSale } from "@/backend/sales/ingest";
import { discoverTodaySales, reconcileRecentSales } from "@/backend/sales/sync";
import { __resetStandingsMemo } from "@/backend/teams/standings";
import { __resetAgentSyncThrottle } from "@/backend/safequote/agent-sync";
import { SafeQuoteCloserItemSchema, SafeQuoteSaleItemSchema, SafeQuoteSummarySchema } from "@/backend/safequote/schemas";

const sqState = vi.hoisted(() => ({
  closers: [] as Array<Record<string, unknown>>,
  recentSales: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/backend/safequote/client", () => ({
  getSafeQuoteClient: () => ({
    isConfigured: () => true,
    getClosers: async () => ({
      closers: sqState.closers.map((c) => SafeQuoteCloserItemSchema.parse(c)),
    }),
    getRecentSales: async () => ({
      sales: sqState.recentSales.map((s) => SafeQuoteSaleItemSchema.parse(s)),
    }),
    getSummary: async () => SafeQuoteSummarySchema.parse({ submitted: 60, validated: 60, closeRate: 100 }),
  }),
}));

describe("production data sync, team raw sales counts, tie handling & SafeQuote closer discovery", () => {
  let owner: { cookie: string; csrf: string };
  let adminId: string;

  beforeAll(async () => {
    await resetDatabase();
    const a = await createAdmin();
    adminId = a.id;
    owner = sessionFrom(
      await login(
        req("/api/admin/auth/login", {
          method: "POST",
          body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" },
        }),
      ),
    );
  });

  beforeEach(async () => {
    __resetStandingsMemo();
    __resetAgentSyncThrottle();
    sqState.closers = [];
    sqState.recentSales = [];
    await pool().query(
      `TRUNCATE team_memberships, agent_designations, bonus_awards, reward_programs,
                spin_credit_transactions, automatic_spin_awards, manual_spin_allocations, spin_results, spin_credits,
                sale_status_history, sales_events_inbox, validated_sales, agents, teams RESTART IDENTITY CASCADE`,
    );
    await pool().query(`DELETE FROM admin_settings WHERE key IN ('recognition.weekly_top_team', 'arena.config')`);
    await setSetting("arena.config", { values: { businessTimezone: "America/New_York", weekStartDay: 1 } });
  });

  it("Issue 1 & 3: Panthers (30 raw / 27 weighted) vs Sigma (30 raw / 27 weighted) with NULL agents.team_id match in Teams Arena and Celebration Settings, handle ties, and never double-count transfers or duplicates", async () => {
    // Seed Team Panthers (10 members) & Team Sigma (9 members) + 1 unassigned registered agent = 20 agents, all agents.team_id = NULL.
    await pool().query(
      `INSERT INTO teams (id, name, slug, logo_url, color, display_order, active, lead_name) VALUES
         ('team_panthers', 'Team Panthers', 'panthers', '/teams/team-panthers.webp', '#A855F7', 1, TRUE, 'Unassigned'),
         ('team_sigma', 'Team Sigma', 'sigma', '/teams/team-sigma.webp', '#8B5CF6', 2, TRUE, 'Unassigned')`,
    );

    for (let i = 1; i <= 10; i++) {
      const code = `CLS-P${i}`;
      await pool().query(
        `INSERT INTO agents (id, user_code, name, initials, team_id, active) VALUES ($1, $2, $3, 'TP', NULL, TRUE)`,
        [`agt_${code}`, code, `Panther ${i}`],
      );
      await pool().query(
        `INSERT INTO team_memberships (team_id, user_code, effective_from) VALUES ('team_panthers', $1, '2026-11-01')`,
        [code],
      );
    }
    for (let i = 1; i <= 9; i++) {
      const code = `CLS-S${i}`;
      await pool().query(
        `INSERT INTO agents (id, user_code, name, initials, team_id, active) VALUES ($1, $2, $3, 'TS', NULL, TRUE)`,
        [`agt_${code}`, code, `Sigma ${i}`],
      );
      await pool().query(
        `INSERT INTO team_memberships (team_id, user_code, effective_from) VALUES ('team_sigma', $1, '2026-11-01')`,
        [code],
      );
    }
    await pool().query(
      `INSERT INTO agents (id, user_code, name, initials, team_id, active) VALUES ('agt_CLS-U1', 'CLS-U1', 'Unassigned Twenty', 'UT', NULL, TRUE)`,
    );

    // Confirm production invariant: 20 agents, ALL agents.team_id IS NULL, Panthers = 10, Sigma = 9.
    expect((await pool().query(`SELECT COUNT(*)::int AS n FROM agents WHERE team_id IS NULL`)).rows[0].n).toBe(20);

    // Mid-week transfer test: CLS-P10 transferred from Panthers to Sigma effective 2026-11-26.
    // Sales on Nov 25 count for Panthers; sales on Nov 26+ count for Sigma; never double-counted.
    await pool().query(`UPDATE team_memberships SET effective_to = '2026-11-26' WHERE user_code = 'CLS-P10'`);
    await pool().query(`INSERT INTO team_memberships (team_id, user_code, effective_from) VALUES ('team_sigma', 'CLS-P10', '2026-11-26')`);

    sqState.closers = [
      ...Array.from({ length: 10 }, (_, i) => ({ userCode: `CLS-P${i + 1}`, name: `Panther ${i + 1}`, submitted: 12, validated: 3, closeRate: 25 })),
      ...Array.from({ length: 9 }, (_, i) => ({ userCode: `CLS-S${i + 1}`, name: `Sigma ${i + 1}`, submitted: 11, validated: 3, closeRate: 27 })),
    ];

    // Current week (Mon Nov 23 – Sat Nov 28, 2026 America/New_York):
    // Panthers: 29 sales by CLS-P1..P9 (6 Corebridge Financial @ 0.5 = -3.0 weighted) + 1 pre-transfer sale by CLS-P10 on Nov 25 = 30 raw, 27 weighted!
    for (let k = 0; k < 29; k++) {
      const carrier = k < 6 ? "Corebridge Financial" : "Aetna";
      await ingestValidatedSale(
        pool(),
        {
          caseId: `PAN-WK-${k}`,
          userCode: `CLS-P${(k % 9) + 1}`,
          closerName: `Panther ${(k % 9) + 1}`,
          carrier,
          validatedAt: "2026-11-25T16:00:00.000Z",
        },
        "sse",
      );
    }
    await ingestValidatedSale(
      pool(),
      { caseId: "PAN-XFER-BEFORE", userCode: "CLS-P10", closerName: "Panther 10", carrier: "Aetna", validatedAt: "2026-11-25T18:00:00.000Z" },
      "sse",
    );
    // Duplicate case replay must never double-count.
    await ingestValidatedSale(
      pool(),
      { caseId: "PAN-WK-0", userCode: "CLS-P1", closerName: "Panther 1", carrier: "Corebridge Financial", validatedAt: "2026-11-25T16:00:00.000Z" },
      "reconciliation",
    );

    // Sigma: 29 sales by CLS-S1..S9 (6 Corebridge Financial @ 0.5 = -3.0 weighted) + 1 post-transfer sale by CLS-P10 on Nov 26 = 30 raw, 27 weighted!
    for (let k = 0; k < 29; k++) {
      const carrier = k < 6 ? "Corebridge Financial" : "Aetna";
      await ingestValidatedSale(
        pool(),
        {
          caseId: `SIG-WK-${k}`,
          userCode: `CLS-S${(k % 9) + 1}`,
          closerName: `Sigma ${(k % 9) + 1}`,
          carrier,
          validatedAt: "2026-11-26T16:00:00.000Z",
        },
        "sse",
      );
    }
    await ingestValidatedSale(
      pool(),
      { caseId: "SIG-XFER-AFTER", userCode: "CLS-P10", closerName: "Panther 10", carrier: "Aetna", validatedAt: "2026-11-26T18:00:00.000Z" },
      "sse",
    );

    // 1. Teams Arena API (?period=week) shows 30 raw sales for BOTH Panthers and Sigma, preserves 27 weighted credits, and reports a tie (leaderTeamId = null).
    const arenaRes = await (await arenaTeamsGet(new NextRequest("http://arena.test/api/arena/teams?period=week"))).json();
    expect(arenaRes.ok).toBe(true);
    const pTeam = arenaRes.teams.find((t: { id: string }) => t.id === "team_panthers");
    const sTeam = arenaRes.teams.find((t: { id: string }) => t.id === "team_sigma");
    expect(pTeam).toMatchObject({ rawValidated: 30, validated: 27, rank: 1, tied: true });
    expect(sTeam).toMatchObject({ rawValidated: 30, validated: 27, rank: 1, tied: true });
    expect(arenaRes.leaderTeamId).toBeNull();

    // 2. Admin Celebration Settings API shows the EXACT SAME 30 raw sales (never 27!) and reports a tie rather than a misleading winner.
    const celebRes = await (
      await weeklyTopTeamGet(req("/api/admin/celebrations/weekly-top-team", { cookie: owner.cookie }))
    ).json();
    expect(celebRes.ok).toBe(true);
    expect(celebRes.isTie).toBe(true);
    expect(celebRes.topTeam).toBeNull();
    expect(celebRes.tiedTeams.map((t: { name: string; validated: number; creditedValidated: number }) => [t.name, t.validated, t.creditedValidated])).toEqual([
      ["Team Panthers", 30, 27],
      ["Team Sigma", 30, 27],
    ]);

    // Attempting to broadcast a sole winner while tied is refused with 409.
    const tiePost = await weeklyTopTeamPost(
      req("/api/admin/celebrations/weekly-top-team", { method: "POST", cookie: owner.cookie, csrf: owner.csrf }),
    );
    expect(tiePost.status).toBe(409);

    // 3. Issue 4: Fallback discovery stores a 31st missed sale for Panthers → cache invalidates immediately and both APIs show Panthers 31 vs Sigma 30!
    sqState.recentSales = [
      {
        caseId: "PAN-FALLBACK-31",
        closer: { userCode: "CLS-P1", name: "Panther 1" },
        state: "TX",
        carrier: "Corebridge Financial",
        premium: 85,
        validatedAt: new Date().toISOString(),
      },
    ];
    const disc = await discoverTodaySales(pool());
    expect(disc.inserted).toBe(1);
    // Re-running fallback discovery is strictly idempotent.
    const disc2 = await discoverTodaySales(pool());
    expect(disc2.inserted).toBe(0);
    expect(disc2.duplicates).toBe(1);

    const arenaAfter = await (await arenaTeamsGet(new NextRequest("http://arena.test/api/arena/teams?period=week"))).json();
    expect(arenaAfter.leaderTeamId).toBe("team_panthers");
    expect(arenaAfter.teams[0]).toMatchObject({ id: "team_panthers", rawValidated: 31, validated: 27.5, rank: 1, tied: false });

    const celebAfter = await (
      await weeklyTopTeamGet(req("/api/admin/celebrations/weekly-top-team", { cookie: owner.cookie }))
    ).json();
    expect(celebAfter.isTie).toBe(false);
    expect(celebAfter.topTeam).toMatchObject({ id: "team_panthers", name: "Team Panthers", validated: 31, creditedValidated: 27.5 });
  });

  it("Issue 2 & 3: discovers Mahnoor Ali and Zeeshan Habib from SafeQuote by stable user_code, shows them in Agent & Team Management without auto-assigning teams, and allows assigning to Panthers or Sigma", async () => {
    await pool().query(
      `INSERT INTO teams (id, name, slug, color, display_order, active, lead_name) VALUES
         ('team_panthers', 'Team Panthers', 'panthers', '#A855F7', 1, TRUE, 'Unassigned'),
         ('team_sigma', 'Team Sigma', 'sigma', '#8B5CF6', 2, TRUE, 'Unassigned')`,
    );
    await pool().query(
      `INSERT INTO agents (id, user_code, name, initials, spin_eligible, active) VALUES
         ('agt_CLS-HAMNA', 'CLS-HAMNA', 'Hamna Nasir', 'HN', FALSE, TRUE)`,
    );
    await pool().query(
      `INSERT INTO team_memberships (team_id, user_code, effective_from) VALUES ('team_panthers', 'CLS-HAMNA', '2026-11-01')`,
    );

    // SafeQuote /closers includes existing Hamna Nasir + missing Mahnoor Ali & Zeeshan Habib + unverified blank-code row + synthetic test row.
    sqState.closers = [
      { userCode: "CLS-HAMNA", name: "Hamna Nasir", submitted: 15, validated: 6, closeRate: 40 },
      { userCode: "CLS-MAHNOOR", name: "Mahnoor Ali", submitted: 8, validated: 0, closeRate: 0 },
      { userCode: "CLS-ZEESHAN", name: "Zeeshan Habib", submitted: 5, validated: 0, closeRate: 0 },
      { userCode: "", name: "Unverified NoCode", submitted: 2, validated: 0, closeRate: 0 },
      { userCode: "CLS-TEST99", name: "Test Bot", submitted: 1, validated: 0, closeRate: 0 },
    ];

    // 1. Admin Agent Management syncs verified closers once, preserves existing Hamna (spin_eligible = FALSE, Panthers membership), and skips unverified/test rows.
    const agentsRes1 = await (await adminAgentsGet(req("/api/admin/spins/agents?limit=200&fresh=true", { cookie: owner.cookie }))).json();
    expect(agentsRes1.ok).toBe(true);
    expect(agentsRes1.agents.map((a: { user_code: string; name: string }) => [a.user_code, a.name])).toEqual([
      ["CLS-HAMNA", "Hamna Nasir"],
      ["CLS-MAHNOOR", "Mahnoor Ali"],
      ["CLS-ZEESHAN", "Zeeshan Habib"],
    ]);
    // Existing Hamna settings & membership preserved; newly synced closers have no unverified team assignment.
    const hamna = agentsRes1.agents.find((a: { user_code: string }) => a.user_code === "CLS-HAMNA");
    const mahnoor = agentsRes1.agents.find((a: { user_code: string }) => a.user_code === "CLS-MAHNOOR");
    expect(hamna).toMatchObject({ spin_eligible: false, team_name: "Team Panthers" });
    expect(mahnoor).toMatchObject({ spin_eligible: true, team_name: null });

    // Repeated sync & reconciliation never create duplicate users.
    await reconcileRecentSales(pool());
    const agentsRes2 = await (await adminAgentsGet(req("/api/admin/spins/agents?limit=200&fresh=true", { cookie: owner.cookie }))).json();
    expect(agentsRes2.agents).toHaveLength(3);
    expect((await pool().query(`SELECT COUNT(*)::int AS n FROM team_memberships`)).rows[0].n).toBe(1);

    // 2. Admin Team Management lists Mahnoor Ali and Zeeshan Habib as unassigned and allows assigning them to Panthers or Sigma.
    const teamsView = await (await adminTeamsGet(req("/api/admin/teams", { cookie: owner.cookie }))).json();
    expect(teamsView.unassigned.map((u: { userCode: string }) => u.userCode)).toEqual(["CLS-MAHNOOR", "CLS-ZEESHAN"]);

    const assign1 = await adminTeamMembersPost(
      req("/api/admin/teams/members", {
        method: "POST",
        cookie: owner.cookie,
        csrf: owner.csrf,
        body: { userCode: "CLS-MAHNOOR", teamId: "team_panthers", designation: "junior" },
      }),
    );
    const assign2 = await adminTeamMembersPost(
      req("/api/admin/teams/members", {
        method: "POST",
        cookie: owner.cookie,
        csrf: owner.csrf,
        body: { userCode: "CLS-ZEESHAN", teamId: "team_sigma", designation: "senior" },
      }),
    );
    expect(assign1.status).toBe(200);
    expect(assign2.status).toBe(200);

    const teamsAfter = await (await adminTeamsGet(req("/api/admin/teams", { cookie: owner.cookie }))).json();
    expect(teamsAfter.unassigned).toEqual([]);
    expect(teamsAfter.teams.find((t: { id: string }) => t.id === "team_panthers").memberCount).toBe(2);
    expect(teamsAfter.teams.find((t: { id: string }) => t.id === "team_sigma").memberCount).toBe(1);
    // Historical Hamna membership effective_from ('2026-11-01') is untouched.
    expect(
      (await pool().query(`SELECT effective_from::text AS f FROM team_memberships WHERE user_code = 'CLS-HAMNA'`)).rows[0].f,
    ).toBe("2026-11-01");
    void adminId;
  });
});
