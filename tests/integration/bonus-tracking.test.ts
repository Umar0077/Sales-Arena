import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { ingestValidatedSale } from "@/lib/server/sales/ingest";
import { POST as createProgramRoute, GET as listProgramsRoute } from "@/app/api/admin/programs/route";
import { PATCH as patchProgram } from "@/app/api/admin/programs/[id]/route";
import { PATCH as patchAward } from "@/app/api/admin/awards/[id]/route";
import { GET as listAwardsRoute } from "@/app/api/admin/awards/route";
import { PUT as putConfig } from "@/app/api/admin/arena-config/route";
import { GET as publicAwards } from "@/app/api/arena/awards/route";
import { POST as previewRoute } from "@/app/api/admin/awards/recovery/preview/route";
import { POST as applyRoute } from "@/app/api/admin/awards/recovery/route";
import { POST as scanRoute } from "@/app/api/admin/awards/recovery/scan/route";
import { POST as login } from "@/app/api/admin/auth/login/route";
import { arenaBroadcaster, type ArenaBroadcastEvent } from "@/lib/server/events/broadcaster";
import { createAdmin, pool, req, resetDatabase, sessionFrom, setSetting } from "./helpers";

/**
 * End-to-end bonus tracking in PostgreSQL, generic for every agent (codes below are test fixtures only).
 * Reproduces the production situation: automatic-reward (spin) cutoff NOT set, so every sale is stored
 * with reward_eligible = false.
 */
let owner: { cookie: string; csrf: string };
let staff: { cookie: string; csrf: string };
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
const today = () => new Date().toISOString().slice(0, 10);
const owned = (s = owner, ip = "192.0.2.10") => ({ cookie: s.cookie, csrf: s.csrf, headers: { "x-real-ip": ip } });
const preview = async (body: Record<string, unknown>, s = owner) => {
  const r = await previewRoute(req("/api/admin/awards/recovery/preview", { method: "POST", body, ...owned(s) }));
  return { status: r.status, body: await r.json() };
};
const apply = async (body: Record<string, unknown>, s = owner) => {
  const r = await applyRoute(req("/api/admin/awards/recovery", { method: "POST", body, ...owned(s) }));
  return { status: r.status, body: await r.json() };
};
async function rawSale(u: string, at: Date, name: string) {
  // A sale stored by the OLD code path: live, validated, processed, reward_eligible = false, no award.
  await pool().query(`INSERT INTO agents (id, user_code, name, initials) VALUES ($1, $2, $3, 'AG') ON CONFLICT DO NOTHING`, [`agt_${u}`, u, name]);
  const caseId = `RAW-${Date.now()}-${seq++}`;
  await pool().query(
    `INSERT INTO validated_sales (id, case_id, user_code, agent_id, validated_at, premium, raw_payload, reward_processed, source, reward_eligible, closer_name, status)
     VALUES ($1, $2, $3, $4, $5, 0, '{}'::jsonb, TRUE, 'sse', FALSE, $6, 'validated')`,
    [`sale_${caseId}`, caseId, u, `agt_${u}`, at, name],
  );
  return caseId;
}

describe("bonus tracking for every agent (PostgreSQL is the only source)", () => {
  beforeAll(async () => {
    await resetDatabase();
    await createAdmin();
    await createAdmin("staff@example.com");
    await pool().query(`UPDATE admin_users SET role = 'admin' WHERE email = 'staff@example.com'`);
    owner = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" } })));
    staff = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "staff@example.com", password: "Correct-Horse-Battery-9" } })));
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
      ["AG-ONE", "Daily 3", 3000, "earned", "automatic"], // stackable: 2 + 3 sales
      ["AG-TWO", "Daily 2", 2000, "earned", "automatic"],
    ]);
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
    expect(pub.agentBonus.byAgent["AG-A"]).toMatchObject({ currency: "PKR", day: { earned: 2000, count: 1 }, week: { earned: 10000, count: 2 }, month: { earned: 20000, count: 3 } });
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

  it("RECOVERY (sales before program activation): Owner-only preview → approve → one earned award; idempotent; engine stays consistent", async () => {
    const p = await program({ kind: "daily", name: "FE Sr Daily — 2 Sales Bonus", salesRequired: 2, amount: 2000, maxAwards: 5 }, 30); // activated 30 min ago
    for (const m of [120, 110]) await ingestValidatedSale(pool(), sale("AG-REC", minsAgo(m), "Recovery Agent"), "sse"); // before activation
    expect(await awards()).toHaveLength(0); // correctly not automatic
    const q = { userCode: "ag-rec", programId: p.id, periodDate: today() };
    expect((await preview(q, staff)).status).toBe(403); // Owner only
    expect((await previewRoute(req("/api/admin/awards/recovery/preview", { method: "POST", body: q }))).status).toBe(401);
    const pv = (await preview(q)).body.preview;
    expect(pv.sales.map((s: { class: string }) => s.class)).toEqual(["recoverable", "recoverable"]);
    expect(pv.toCreate).toHaveLength(1);
    expect(pv.toCreate[0]).toMatchObject({ n: 1, amount: 2000, currency: "PKR" });
    expect(await awards()).toHaveLength(0); // preview writes nothing
    expect((await apply({ mode: "recover", ...q, reason: "short", confirm: true })).status).toBe(400);
    expect((await apply({ mode: "recover", ...q, reason: "Sales validated before activation", confirm: false })).status).toBe(428);
    expect((await apply({ mode: "recover", ...q, reason: "Sales validated before activation", confirm: true }, staff)).status).toBe(403);
    const ok = await apply({ mode: "recover", ...q, reason: "Sales validated before activation", confirm: true });
    expect(ok.status, ok.body.error).toBe(201);
    const rows = await awards();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_code: "AG-REC", agent_name: "Recovery Agent", status: "earned", source: "recovery", recovery_reason: "Sales validated before activation", amount: "2000.00" });
    expect(events.filter((e) => e.type === "rewards.award.created")).toHaveLength(1);
    // Repeat → nothing more.
    expect((await apply({ mode: "recover", ...q, reason: "Sales validated before activation", confirm: true })).status).toBe(409);
    expect((await pool().query(`SELECT action FROM audit_logs WHERE action = 'bonus_award.recovered'`)).rowCount).toBe(1);
    // Two NEW sales after activation earn the next award automatically (no double count of the recovered ones).
    for (const m of [10, 5]) await ingestValidatedSale(pool(), sale("AG-REC", minsAgo(m), "Recovery Agent"), "sse");
    expect((await awards()).map((r) => [r.n, r.source])).toEqual([[1, "recovery"], [2, "automatic"]]);
    // Sales and processing flags untouched.
    expect((await pool().query(`SELECT COUNT(*)::int AS n FROM validated_sales WHERE reward_processed AND NOT reward_eligible`)).rows[0].n).toBe(4);
  });

  it("CATCH-UP (sales after activation never awarded by the old rule): Owner approves once, engine creates it, idempotent", async () => {
    const p = await program({ kind: "daily", name: "Daily 2", salesRequired: 2, amount: 2000 }, 60);
    await rawSale("AG-CAT", minsAgo(30), "Catch Agent");
    await rawSale("AG-CAT", minsAgo(20), "Catch Agent");
    const q = { userCode: "AG-CAT", programId: p.id, periodDate: today() };
    const pv = (await preview(q)).body.preview;
    expect(pv.sales.map((s: { class: string }) => s.class)).toEqual(["counted_automatically", "counted_automatically"]);
    expect(pv.toCreate).toHaveLength(0); // not "recovery": the automatic rule counts these
    expect(pv.catchUp.due).toBe(1);
    const ok = await apply({ mode: "catchup", ...q, reason: "Missed by the old eligibility rule", confirm: true });
    expect(ok.status, ok.body.error).toBe(201);
    const rows = await awards();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "automatic", status: "earned", recovery_reason: "Missed by the old eligibility rule", amount: "2000.00" });
    expect((await apply({ mode: "catchup", ...q, reason: "Missed by the old eligibility rule", confirm: true })).status).toBe(409);
    // A third live sale does not re-award the same milestone.
    await ingestValidatedSale(pool(), sale("AG-CAT", minsAgo(5), "Catch Agent"), "sse");
    expect(await awards()).toHaveLength(1);
  });

  it("range scan (e.g. November): read-only, limited to the approved range, lists both kinds for every agent", async () => {
    const p = await program({ kind: "daily", name: "Daily 2", salesRequired: 2, amount: 2000 }, 45);
    for (const m of [120, 110]) await ingestValidatedSale(pool(), sale("AG-R", minsAgo(m), "R"), "sse"); // before activation
    await rawSale("AG-C", minsAgo(30), "C");
    await rawSale("AG-C", minsAgo(20), "C");
    const r = await scanRoute(req("/api/admin/awards/recovery/scan", { method: "POST", body: { from: today(), to: today() }, ...owned() }));
    const j = await r.json();
    expect(r.status, j.error).toBe(200);
    const byAgent = Object.fromEntries(j.items.map((i: { userCode: string }) => [i.userCode, i]));
    expect(byAgent["AG-R"]).toMatchObject({ programId: p.id, recover: { awards: 1, amount: 2000 }, catchUp: null });
    expect(byAgent["AG-C"]).toMatchObject({ programId: p.id, recover: null, catchUp: { awards: 1, amount: 2000 } });
    expect(await awards()).toHaveLength(0); // scanning never writes
    // A range that ends before these sales finds nothing to award (nothing outside the approved range counts).
    const y = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
    const none = await (await scanRoute(req("/api/admin/awards/recovery/scan", { method: "POST", body: { from: y, to: y }, ...owned() }))).json();
    expect(none.items).toHaveLength(0);
    expect((await scanRoute(req("/api/admin/awards/recovery/scan", { method: "POST", body: { from: today(), to: today() }, ...owned(staff) }))).status).toBe(403);
  });
});
