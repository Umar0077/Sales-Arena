import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { ingestValidatedSale } from "@/lib/server/sales/ingest";
import { POST as createProgramRoute, GET as listProgramsRoute } from "@/app/api/admin/programs/route";
import { PATCH as patchProgram } from "@/app/api/admin/programs/[id]/route";
import { PATCH as patchAward } from "@/app/api/admin/awards/[id]/route";
import { GET as listAwardsRoute } from "@/app/api/admin/awards/route";
import { PUT as putConfig } from "@/app/api/admin/arena-config/route";
import { GET as publicAwards } from "@/app/api/arena/awards/route";
import { POST as login } from "@/app/api/admin/auth/login/route";
import { arenaBroadcaster, type ArenaBroadcastEvent } from "@/lib/server/events/broadcaster";
import { createAdmin, pool, req, resetDatabase, sessionFrom, setSetting } from "./helpers";

/**
 * End-to-end bonus tracking in PostgreSQL, generic for every agent (codes below are test fixtures only).
 * Reproduces the production situation: automatic-reward (spin) cutoff NOT set, so every sale is stored
 * with reward_eligible = false.
 */
let owner: { cookie: string; csrf: string };
let events: ArenaBroadcastEvent[] = [];
let off = () => {};
let seq = 0;
const ALL_ON = { daily: { active: true, showOnArena: true }, weekly: { active: true, showOnArena: true }, monthly: { active: true, showOnArena: true } };
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000);
const sale = (u: string, at: Date, name = `Agent ${u}`) => ({ caseId: `BT-${Date.now()}-${seq++}`, userCode: u, closerName: name, validatedAt: at.toISOString(), premium: 10 });
const program = async (body: Record<string, unknown>, activeMinsAgo = 300) => {
  const r = await createProgramRoute(req("/api/admin/programs", { method: "POST", body: { enabled: true, rewardType: "cash", currency: "PKR", stackable: true, maxAwards: 1, ...body }, cookie: owner.cookie, csrf: owner.csrf }));
  const j = await r.json();
  expect(r.status, j.error).toBe(201);
  await pool().query(`UPDATE reward_programs SET active_since = $2 WHERE id = $1`, [j.program.id, minsAgo(activeMinsAgo)]);
  return j.program as { id: string };
};
const awards = async (where = "") => (await pool().query(`SELECT * FROM bonus_awards ${where} ORDER BY created_at, id`)).rows;

describe("bonus tracking for every agent (PostgreSQL is the only source)", () => {
  beforeAll(async () => {
    await resetDatabase();
    await createAdmin();
    owner = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" } })));

  });
  beforeEach(async () => {
    await pool().query(`TRUNCATE reward_program_history, bonus_awards, spin_credit_transactions, automatic_spin_awards, spin_credits, sale_status_history, sales_events_inbox, validated_sales, agents, reward_programs RESTART IDENTITY CASCADE`);
    await pool().query(`DELETE FROM admin_settings WHERE key = 'arena.config'`);
    await setSetting("auto_spins_enabled", true);
    await setSetting("reward_activation_cutoff", null); // production: never set → every sale reward_eligible = false
    await putConfig(req("/api/admin/arena-config", { method: "PUT", body: { values: { businessTimezone: "UTC", weekStartDay: 1, rewardCategories: ALL_ON } }, cookie: owner.cookie, csrf: owner.csrf }));
    events = [];
    off = arenaBroadcaster.subscribe((e) => events.push(e));
  });
  afterEach(() => off());

  it("root cause fixed: with no spin cutoff, live sales of ANY agent earn their bonuses (spins stay gated)", async () => {
    const d2 = await program({ kind: "daily", name: "Daily 2", salesRequired: 2, amount: 2000 });
    await program({ kind: "daily", name: "Daily 3", salesRequired: 3, amount: 3000 });
    for (const [u, n] of [["AG-ONE", 3], ["AG-TWO", 2], ["AG-THREE", 1]] as const)
      for (let i = 0; i < n; i++) await ingestValidatedSale(pool(), sale(u, minsAgo(60 - i)), "sse");
    expect((await pool().query(`SELECT COUNT(*)::int AS n FROM validated_sales WHERE reward_eligible`)).rows[0].n).toBe(0); // flag unchanged
    const rows = await awards();
    expect(rows.map((r) => [r.user_code, r.program_name, Number(r.amount), r.status, r.source])).toEqual([
      ["AG-ONE", "Daily 2", 2000, "earned", "automatic"],
      ["AG-ONE", "Daily 3", 3000, "earned", "automatic"], // highest tier: 3,000 supersedes 2,000 (never 5,000)
      ["AG-TWO", "Daily 2", 2000, "earned", "automatic"],
    ]);
    expect((await awards(`WHERE user_code = 'AG-ONE' AND superseded_by IS NULL`)).map((r) => Number(r.amount))).toEqual([3000]);
    expect((await pool().query(`SELECT COUNT(*)::int AS n FROM spin_credit_transactions`)).rows[0].n).toBe(0); // spins still need the cutoff
    // Real popup payloads, one per committed award.
    const payloads = events.filter((e) => e.type === "rewards.award.created").map((e) => (e.payload as { award: Record<string, unknown> }).award);
    expect(payloads.map((a) => [a.agentName, a.amount, a.currency, a.validatedAtAward, a.kind, a.announce])).toEqual([
      ["Agent AG-ONE", 2000, "PKR", 2, "daily", true],
      ["Agent AG-ONE", 3000, "PKR", 3, "daily", true],
      ["Agent AG-TWO", 2000, "PKR", 2, "daily", true],
    ]);
    // Duplicate deliveries never award twice.
    const dup = (await pool().query(`SELECT case_id FROM validated_sales WHERE user_code = 'AG-TWO' LIMIT 1`)).rows[0].case_id;
    await ingestValidatedSale(pool(), { ...sale("AG-TWO", minsAgo(1)), caseId: dup }, "reconciliation");
    expect(await awards(`WHERE program_id = '${d2.id}'`)).toHaveLength(2);
    // Historical imports never award.
    for (let i = 0; i < 2; i++) await ingestValidatedSale(pool(), sale("AG-FOUR", minsAgo(30 - i)), "backfill");
    expect(await awards(`WHERE user_code = 'AG-FOUR'`)).toHaveLength(0);
  });

  it("weekly and monthly thresholds, per-agent leaderboard totals, cancelled excluded, announcements respected", async () => {
    await program({ kind: "daily", name: "D2", salesRequired: 2, amount: 2000 });
    await program({ kind: "weekly", name: "W2", salesRequired: 2, amount: 8000 });
    await program({ kind: "monthly", name: "M3", salesRequired: 3, amount: 10000 });
    for (let i = 0; i < 3; i++) await ingestValidatedSale(pool(), sale("AG-A", minsAgo(20 - i)), "sse");
    await ingestValidatedSale(pool(), sale("AG-B", minsAgo(5)), "sse");
    const pub = await (await publicAwards(req("/api/arena/awards"))).json();
    // Week = daily 2,000 + weekly 8,000 + the monthly increase reached this week (10,000).
    expect(pub.agentBonus.byAgent["AG-A"]).toMatchObject({ currency: "PKR", day: { earned: 2000, count: 1 }, week: { earned: 20000, count: 3 }, month: { earned: 20000, count: 3 } });
    expect(pub.agentBonus.byAgent["AG-B"]).toBeUndefined(); // no award → nothing shown (never inferred from sales)
    const m3 = (await awards(`WHERE program_name = 'M3'`))[0];
    await patchAward(req("/api/admin/awards/x", { method: "PATCH", body: { status: "cancelled", note: "test cancel" }, cookie: owner.cookie, csrf: owner.csrf }), { params: Promise.resolve({ id: encodeURIComponent(m3.id) }) });
    expect((await (await publicAwards(req("/api/arena/awards"))).json()).agentBonus.byAgent["AG-A"].month.earned).toBe(10000);
    // Announcements off: still earned and stored, popup flag false.
    await putConfig(req("/api/admin/arena-config", { method: "PUT", body: { values: { announceCash: false } }, cookie: owner.cookie, csrf: owner.csrf }));
    for (let i = 0; i < 2; i++) await ingestValidatedSale(pool(), sale("AG-C", minsAgo(10 - i)), "sse");
    expect((await awards(`WHERE user_code = 'AG-C' AND kind = 'daily'`))[0].announce).toBe(false);
    // Award History (Admin) lists the real rows with their source.
    const hist = await (await listAwardsRoute(req("/api/admin/awards", { cookie: owner.cookie }))).json();
    expect(hist.awards.every((a: { source: string }) => a.source === "automatic")).toBe(true);
    expect(hist.totals.count).toBe((await awards()).length);
  });

  it("duplicate programs: only the oldest of identical active programs awards; new duplicates are refused", async () => {
    const a = await program({ kind: "monthly", name: "Monthly 70 A", salesRequired: 2, amount: 70000 });
    const b = await program({ kind: "monthly", name: "Monthly 70 B", salesRequired: 3, amount: 70000 });
    await pool().query(`UPDATE reward_programs SET sales_required = 2 WHERE id = $1`, [b.id]); // a duplicate created before this protection existed
    const list = await (await listProgramsRoute(req("/api/admin/programs", { cookie: owner.cookie }))).json();
    expect(list.duplicates).toHaveLength(1);
    expect(list.duplicates[0].map((p: { id: string }) => p.id)).toEqual([a.id, b.id]);
    for (let i = 0; i < 2; i++) await ingestValidatedSale(pool(), sale("AG-D", minsAgo(10 - i)), "sse");
    expect((await awards()).map((r) => r.program_id)).toEqual([a.id]); // never paid twice
    const r = await createProgramRoute(req("/api/admin/programs", { method: "POST", body: { kind: "monthly", name: "Monthly 70 C", rewardType: "cash", currency: "PKR", amount: 70000, salesRequired: 2, enabled: true }, cookie: owner.cookie, csrf: owner.csrf }));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain("Monthly 70 A");
    const pause = await patchProgram(req(`/api/admin/programs/${b.id}`, { method: "PATCH", body: { enabled: false }, cookie: owner.cookie, csrf: owner.csrf }), { params: Promise.resolve({ id: b.id }) });
    expect(pause.status).toBe(200);
    const reenable = await patchProgram(req(`/api/admin/programs/${b.id}`, { method: "PATCH", body: { enabled: true }, cookie: owner.cookie, csrf: owner.csrf }), { params: Promise.resolve({ id: b.id }) });
    expect(reenable.status).toBe(409);
  });

});
