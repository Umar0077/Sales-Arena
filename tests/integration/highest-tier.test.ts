import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { ingestValidatedSale } from "@/lib/server/sales/ingest";
import { POST as createProgramRoute } from "@/app/api/admin/programs/route";
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
 * Highest-achieved-tier bonuses. Tier values below are TEST FIXTURES mirroring the business configuration;
 * the application reads them only from reward_programs.
 */
const DAILY = [[2, 2000], [3, 3000], [4, 5000], [5, 7000]] as const;
const WEEKLY = [[8, 8000], [10, 12000], [12, 16000], [15, 23000]] as const;
const ALL_ON = { daily: { active: true, showOnArena: true }, weekly: { active: true, showOnArena: true }, monthly: { active: true, showOnArena: true } };
let owner: { cookie: string; csrf: string };
let staff: { cookie: string; csrf: string };
let events: ArenaBroadcastEvent[] = [];
let off = () => {};
let seq = 0;
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000);
const today = () => new Date().toISOString().slice(0, 10);
const sale = (u: string, at: Date) => ({ caseId: `HT-${Date.now()}-${seq++}`, userCode: u, closerName: `Agent ${u}`, validatedAt: at.toISOString(), premium: 1 });
const as = (s = owner) => ({ cookie: s.cookie, csrf: s.csrf });
const program = async (body: Record<string, unknown>, activeMinsAgo = 600) => {
  const r = await createProgramRoute(req("/api/admin/programs", { method: "POST", body: { rewardType: "cash", currency: "PKR", enabled: true, maxAwards: 1, ...body }, ...as() }));
  const j = await r.json();
  expect(r.status, j.error).toBe(201);
  await pool().query(`UPDATE reward_programs SET active_since = $2 WHERE id = $1`, [j.program.id, minsAgo(activeMinsAgo)]);
  return j.program as { id: string; tierPolicy: string };
};
const tiers = async (kind: string, list: readonly (readonly [number, number])[], extra: Record<string, unknown> = {}, activeMinsAgo = 600) => {
  const out = [];
  for (const [n, amt] of list) out.push(await program({ kind, name: `${kind} ${n}`, salesRequired: n, amount: amt, ...extra }, activeMinsAgo));
  return out;
};
const chain = async (u: string, kind = "daily") =>
  (await pool().query(`SELECT * FROM bonus_awards WHERE user_code = $1 AND kind = $2 ORDER BY sales_required`, [u, kind])).rows;
const effective = async (u: string, kind = "daily") => (await chain(u, kind)).filter((r) => !r.superseded_by && !["cancelled", "reversed"].includes(r.status));
const agentBonus = async () => (await (await publicAwards(req("/api/arena/awards"))).json()).agentBonus.byAgent;
async function rawSale(u: string, at: Date) {
  await pool().query(`INSERT INTO agents (id, user_code, name, initials) VALUES ($1, $2, $3, 'AG') ON CONFLICT DO NOTHING`, [`agt_${u}`, u, `Agent ${u}`]);
  const caseId = `RAW-${Date.now()}-${seq++}`;
  await pool().query(
    `INSERT INTO validated_sales (id, case_id, user_code, agent_id, validated_at, premium, raw_payload, reward_processed, source, reward_eligible, closer_name, status)
     VALUES ($1, $2, $3, $4, $5, 0, '{}'::jsonb, TRUE, 'sse', FALSE, $6, 'validated')`,
    [`sale_${caseId}`, caseId, u, `agt_${u}`, at, `Agent ${u}`],
  );
  return caseId;
}
const preview = async (body: Record<string, unknown>, s = owner) => {
  const r = await previewRoute(req("/api/admin/awards/recovery/preview", { method: "POST", body, ...as(s) }));
  return { status: r.status, body: await r.json() };
};
const apply = async (body: Record<string, unknown>, s = owner) => {
  const r = await applyRoute(req("/api/admin/awards/recovery", { method: "POST", body: { reason: "Owner-approved bonus correction", confirm: true, ...body }, ...as(s) }));
  return { status: r.status, body: await r.json() };
};
const scan = async (s = owner) => {
  const r = await scanRoute(req("/api/admin/awards/recovery/scan", { method: "POST", body: { from: today(), to: today() }, ...as(s) }));
  return { status: r.status, body: await r.json() };
};

describe("highest achieved tier only (PostgreSQL supersession, no additive totals)", () => {
  beforeAll(async () => {
    await resetDatabase();
    await createAdmin();
    await createAdmin("staff@example.com");
    await pool().query(`UPDATE admin_users SET role = 'admin' WHERE email = 'staff@example.com'`);
    owner = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" } })));
    staff = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "staff@example.com", password: "Correct-Horse-Battery-9" } })));
  });
  beforeEach(async () => {
    await pool().query(`TRUNCATE bonus_sale_approvals, reward_program_history, bonus_awards, spin_credit_transactions, automatic_spin_awards, spin_credits, sale_status_history, sales_events_inbox, validated_sales, agents, reward_programs RESTART IDENTITY CASCADE`);
    await pool().query(`DELETE FROM admin_settings WHERE key = 'arena.config'`);
    await pool().query(`DROP TRIGGER IF EXISTS fail_awards ON bonus_awards`);
    await setSetting("auto_spins_enabled", false);
    await setSetting("reward_activation_cutoff", null);
    await putConfig(req("/api/admin/arena-config", { method: "PUT", body: { values: { businessTimezone: "UTC", weekStartDay: 1, rewardCategories: ALL_ON } }, ...as() }));
    events = [];
    off = arenaBroadcaster.subscribe((e) => events.push(e));
  });
  afterEach(() => off());

  it("Daily 2 → 3 → 4 → 5 sales: effective 2,000 → 3,000 → 5,000 → 7,000 (never 5,000 / 10,000 / 17,000)", async () => {
    const created = await tiers("daily", DAILY);
    expect(created.every((p) => p.tierPolicy === "highest_tier")).toBe(true); // the default policy
    const expected = [null, 2000, 3000, 5000, 7000];
    for (let i = 0; i < 5; i++) {
      await ingestValidatedSale(pool(), sale("AG1", minsAgo(50 - i)), "sse");
      const eff = await effective("AG1");
      if (expected[i] === null) expect(eff).toHaveLength(0);
      else {
        expect(eff.map((r) => Number(r.amount))).toEqual([expected[i]]);
        expect((await agentBonus())["AG1"].day.earned).toBe(expected[i]);
      }
    }
    const rows = await chain("AG1");
    expect(rows.map((r) => [r.sales_required, Number(r.amount), !!r.superseded_by, Number(r.previous_amount), Number(r.increment_amount), Number(r.payable_amount)])).toEqual([
      [2, 2000, true, 0, 2000, 0], // superseded, unpaid → folded into the next tier
      [3, 3000, true, 2000, 1000, 0],
      [4, 5000, true, 3000, 2000, 0],
      [5, 7000, false, 5000, 2000, 7000],
    ]);
    expect(rows[1].supersedes_id).toBe(rows[0].id);
    expect(rows[0].superseded_by).toBe(rows[1].id);
    // Popup payloads: real totals and increases.
    const pays = events.filter((e) => e.type === "rewards.award.created").map((e) => (e.payload as { award: Record<string, unknown> }).award);
    expect(pays.map((a) => [a.amount, a.upgrade, a.incrementAmount, a.validatedAtAward])).toEqual([
      [2000, false, 2000, 2],
      [3000, true, 1000, 3],
      [5000, true, 2000, 4],
      [7000, true, 2000, 5],
    ]);
    // Admin totals: effective 7,000, nothing paid, 7,000 outstanding; audit trail for each supersession.
    const hist = await (await listAwardsRoute(req("/api/admin/awards", as()))).json();
    expect(hist.totals).toMatchObject({ count: 4, cash: 7000, paid: 0, outstanding: 7000, superseded: 3 });
    expect((await pool().query(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'bonus_award.superseded'`)).rows[0].n).toBe(3);
    // Public feed shows only the effective award.
    const pub = await (await publicAwards(req("/api/arena/awards"))).json();
    expect(pub.awards.map((a: { amount: number }) => a.amount)).toEqual([7000]);
    expect(pub.summary.daily).toMatchObject({ earned: 7000, count: 1 });
    // A 6th sale changes nothing (no tier above 5).
    await ingestValidatedSale(pool(), sale("AG1", minsAgo(1)), "sse");
    expect(await chain("AG1")).toHaveLength(4);
  });

  it("Weekly 8 → 10 → 12 → 15 and Monthly tiers replace lower tiers; daily stays independent", async () => {
    await tiers("weekly", WEEKLY);
    await tiers("monthly", [[20, 250000], [25, 300000]]);
    await tiers("daily", [[2, 2000]]);
    for (let i = 0; i < 25; i++) await ingestValidatedSale(pool(), sale("AG2", minsAgo(200 - i)), "sse");
    expect((await effective("AG2", "weekly")).map((r) => Number(r.amount))).toEqual([23000]); // not 59,000
    expect((await chain("AG2", "weekly")).map((r) => r.sales_required)).toEqual([8, 10, 12, 15]);
    expect((await effective("AG2", "monthly")).map((r) => Number(r.amount))).toEqual([300000]); // not 550,000
    expect((await effective("AG2", "daily")).map((r) => Number(r.amount))).toEqual([2000]); // untouched by weekly/monthly
    const b = (await agentBonus())["AG2"];
    expect(b.day.earned).toBe(2000);
    expect(b.month.earned).toBe(2000 + 23000 + 300000);
    // This week: daily 2,000 + weekly 23,000 + monthly increases reached this week (250,000 + 50,000).
    expect(b.week.earned).toBe(2000 + 23000 + 300000);
  });

  it("skipped milestones: sales arriving late jump straight to the highest tier (no lower tiers summed)", async () => {
    await tiers("daily", DAILY);
    for (const m of [40, 30, 20]) await rawSale("AG3", minsAgo(m)); // stored, never evaluated (old code path)
    await ingestValidatedSale(pool(), sale("AG3", minsAgo(10)), "reconciliation");
    const rows = await chain("AG3");
    expect(rows.map((r) => [r.sales_required, Number(r.amount), Number(r.previous_amount), Number(r.increment_amount)])).toEqual([[4, 5000, 0, 5000]]);
  });

  it("concurrent and duplicate deliveries keep exactly one effective tier", async () => {
    await tiers("daily", DAILY);
    const sales = Array.from({ length: 5 }, (_, i) => sale("AG4", minsAgo(30 - i)));
    await Promise.all(sales.map((s) => ingestValidatedSale(pool(), s, "sse")));
    await Promise.all(sales.map((s) => ingestValidatedSale(pool(), s, "reconciliation")));
    const eff = await effective("AG4");
    expect(eff.map((r) => Number(r.amount))).toEqual([7000]);
    expect(new Set((await chain("AG4")).map((r) => r.id)).size).toBe((await chain("AG4")).length);
  });

  it("an already-paid lower tier: the upgrade only owes the difference; superseded / upgrade awards are protected", async () => {
    await tiers("daily", DAILY);
    for (let i = 0; i < 2; i++) await ingestValidatedSale(pool(), sale("AG5", minsAgo(30 - i)), "sse");
    const t2 = (await chain("AG5"))[0];
    const status = (id: string, s: string, note?: string) =>
      patchAward(req(`/api/admin/awards/x`, { method: "PATCH", body: { status: s, note }, ...as() }), { params: Promise.resolve({ id: encodeURIComponent(id) }) });
    expect((await status(t2.id, "approved")).status).toBe(200);
    expect((await status(t2.id, "paid")).status).toBe(200);
    await ingestValidatedSale(pool(), sale("AG5", minsAgo(5)), "sse");
    const [lo, hi] = await chain("AG5");
    expect([lo.status, Number(lo.payable_amount), !!lo.superseded_by]).toEqual(["paid", 2000, true]); // the payment fact is kept
    expect([Number(hi.amount), Number(hi.increment_amount), Number(hi.payable_amount)]).toEqual([3000, 1000, 1000]);
    const hist = await (await listAwardsRoute(req("/api/admin/awards", as()))).json();
    expect(hist.totals).toMatchObject({ cash: 3000, paid: 2000, outstanding: 1000 });
    expect((await status(lo.id, "reversed", "x")).status).toBe(409); // superseded: manage the current tier
    expect((await status(hi.id, "cancelled", "mistake")).status).toBe(409); // part of an upgrade chain
    expect((await status(hi.id, "approved")).status).toBe(200);
  });

  it("selected-agent scope, paused and archived programs decide which tiers can be reached", async () => {
    const [t2, t3, t4] = await tiers("daily", DAILY.slice(0, 3));
    await patchProgram(req(`/api/admin/programs/${t3.id}`, { method: "PATCH", body: { scopeType: "agents", scopeIds: ["SOMEONE-ELSE"] }, ...as() }), { params: Promise.resolve({ id: t3.id }) });
    await patchProgram(req(`/api/admin/programs/${t4.id}`, { method: "PATCH", body: { archived: true }, ...as() }), { params: Promise.resolve({ id: t4.id }) });
    for (let i = 0; i < 4; i++) await ingestValidatedSale(pool(), sale("AG6", minsAgo(30 - i)), "sse");
    expect((await effective("AG6")).map((r) => r.program_id)).toEqual([t2.id]);
  });

  it("additive programs (explicit policy) still pay independently and never supersede", async () => {
    await program({ kind: "daily", name: "Add 1", salesRequired: 1, amount: 100, tierPolicy: "additive" });
    await program({ kind: "daily", name: "Add 2", salesRequired: 2, amount: 200, tierPolicy: "additive" });
    for (let i = 0; i < 2; i++) await ingestValidatedSale(pool(), sale("AG7", minsAgo(30 - i)), "sse");
    const rows = await chain("AG7");
    expect(rows.map((r) => [Number(r.amount), r.tier_policy, !!r.superseded_by])).toEqual([[100, "additive", false], [200, "additive", false]]);
    expect((await agentBonus())["AG7"].day.earned).toBe(300);
  });

  it("retry after a failure: the sale and its award are stored together or not at all", async () => {
    await tiers("daily", [[1, 1000]]);
    await pool().query(`CREATE OR REPLACE FUNCTION fail_awards_fn() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'simulated failure'; END $$ LANGUAGE plpgsql`);
    await pool().query(`CREATE TRIGGER fail_awards BEFORE INSERT ON bonus_awards FOR EACH ROW EXECUTE FUNCTION fail_awards_fn()`);
    const s = sale("AG8", minsAgo(5));
    await expect(ingestValidatedSale(pool(), s, "sse")).rejects.toThrow(/simulated failure/);
    expect((await pool().query(`SELECT COUNT(*)::int AS n FROM validated_sales WHERE case_id = $1`, [s.caseId])).rows[0].n).toBe(0);
    await pool().query(`DROP TRIGGER fail_awards ON bonus_awards`);
    expect((await ingestValidatedSale(pool(), s, "reconciliation")).status).toBe("inserted"); // redelivery retries everything
    expect((await chain("AG8")).map((r) => Number(r.amount))).toEqual([1000]);
  });

  it("RECOVERY then automatic upgrade: 2 pre-activation sales approved by the Owner + 1 live sale = 3,000 (+1,000)", async () => {
    await tiers("daily", DAILY, {}, 30); // activated 30 minutes ago
    for (const m of [120, 110]) await ingestValidatedSale(pool(), sale("AG9", minsAgo(m)), "sse");
    expect(await chain("AG9")).toHaveLength(0);
    const q = { userCode: "ag9", kind: "daily", rewardGroup: "default", periodDate: today() };
    expect((await preview(q, staff)).status).toBe(403);
    const pv = (await preview(q)).body.preview;
    expect(pv.sales.map((s: { class: string }) => s.class)).toEqual(["needs_approval", "needs_approval"]);
    expect(pv).toMatchObject({ source: "recovery", proposed: { salesRequired: 2, amount: 2000, incrementAmount: 2000 }, effective: null });
    const ok = await apply({ ...q, expectProgramId: pv.proposed.programId });
    expect(ok.status, ok.body.error).toBe(201);
    expect(await pool().query(`SELECT COUNT(*)::int AS n FROM bonus_sale_approvals`).then((r) => r.rows[0].n)).toBe(2);
    expect((await apply(q)).status).toBe(409); // idempotent
    // The next live sale counts the 2 approved sales too: upgrade to 3,000, never 5,000.
    await ingestValidatedSale(pool(), sale("AG9", minsAgo(1)), "sse");
    const rows = await chain("AG9");
    expect(rows.map((r) => [r.sales_required, Number(r.amount), r.source, !!r.superseded_by, Number(r.increment_amount)])).toEqual([
      [2, 2000, "recovery", true, 2000],
      [3, 3000, "automatic", false, 1000],
    ]);
    expect((await agentBonus())["AG9"].day.earned).toBe(3000);
  });

  it("missed upgrade after a recovery (third sale stored by old code): scan proposes 3,000 (+1,000), never a lower tier", async () => {
    await tiers("daily", DAILY, {}, 30);
    for (const m of [120, 110]) await ingestValidatedSale(pool(), sale("AG10", minsAgo(m)), "sse");
    const q = { userCode: "AG10", kind: "daily", rewardGroup: "default", periodDate: today() };
    expect((await apply(q)).status).toBe(201); // the earlier Owner recovery (2,000)
    await rawSale("AG10", minsAgo(5)); // after activation, but stored without evaluation
    const s1 = await scan();
    expect(s1.status, s1.body.error).toBe(200);
    expect(s1.body.items).toHaveLength(1);
    expect(s1.body.items[0]).toMatchObject({
      userCode: "AG10", kind: "daily", source: "automatic", approvalCaseIds: [],
      existing: { salesRequired: 2, amount: 2000 },
      proposed: { salesRequired: 3, amount: 3000, previousAmount: 2000, incrementAmount: 1000, payableAmount: 3000 },
    });
    expect(await chain("AG10")).toHaveLength(1); // scanning wrote nothing
    const ok = await apply({ ...q, expectProgramId: s1.body.items[0].proposed.programId, announce: false });
    expect(ok.status, ok.body.error).toBe(201);
    expect(ok.body.created).toMatchObject({ amount: 3000, incrementAmount: 1000, upgrade: true });
    expect((await effective("AG10")).map((r) => Number(r.amount))).toEqual([3000]);
    expect((await scan()).body.items).toHaveLength(0); // nothing more to do; no lower tier suggested
    const ev = events.filter((e) => e.type === "rewards.award.created").at(-1)!.payload as { award: { announce: boolean; upgrade: boolean } };
    expect(ev.award).toMatchObject({ announce: false, upgrade: true }); // Owner chose no popup
    const audit = (await pool().query(`SELECT details FROM audit_logs WHERE action = 'bonus_award.catch_up'`)).rows[0].details;
    expect(audit).toMatchObject({ from: { amount: 2000 }, to: { amount: 3000 }, incrementAmount: 1000 });
    expect((await scan(staff)).status).toBe(403); // Owner only
  });

  it("the scan is limited to the approved range: sales needing approval outside it are excluded", async () => {
    await tiers("daily", DAILY, {}, 30);
    for (const m of [120, 110]) await ingestValidatedSale(pool(), sale("AG12", minsAgo(m)), "sse"); // before activation
    const y = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
    const none = await scanRoute(req("/api/admin/awards/recovery/scan", { method: "POST", body: { from: y, to: y }, ...as() }));
    expect((await none.json()).items).toHaveLength(0);
    const pv = (await preview({ userCode: "AG12", kind: "daily", rewardGroup: "default", periodDate: today(), notBefore: new Date(Date.now() - 115 * 60_000).toISOString() })).body.preview;
    expect(pv.sales.map((s: { class: string }) => s.class)).toEqual(["outside_range", "needs_approval"]);
    expect(pv.proposed).toBeNull(); // one approvable sale does not reach the 2-sales tier
    expect(await chain("AG12")).toHaveLength(0);
  });

  it("migration backfill: an earlier recovery's approved sales count for higher tiers (creates no award)", async () => {
    await tiers("daily", DAILY, {}, 30);
    const c1 = (await ingestValidatedSale(pool(), sale("AG11", minsAgo(120)), "sse")).saleId;
    const c2 = (await ingestValidatedSale(pool(), sale("AG11", minsAgo(110)), "sse")).saleId;
    const cases = (await pool().query(`SELECT case_id FROM validated_sales WHERE id = ANY($1) ORDER BY validated_at`, [[c1, c2]])).rows.map((r) => r.case_id);
    const p2 = (await pool().query(`SELECT id FROM reward_programs WHERE sales_required = 2`)).rows[0].id;
    const key = `D:${today()}`;
    // An award recovered by the previous version (no approval rows), with its audit entry.
    await pool().query(
      `INSERT INTO bonus_awards (id, program_id, kind, user_code, agent_name, period_key, n, validated_at_award, amount, program_name, sales_required,
                                 status, reward_type, currency, source, recovery_reason, recovered_at, tier_policy, reward_group, increment_amount, payable_amount)
       VALUES ($1, $2, 'daily', 'AG11', 'Agent AG11', $3, 1, 2, 2000, 'daily 2', 2, 'earned', 'cash', 'PKR', 'recovery', 'old recovery', NOW(), 'highest_tier', 'default', 2000, 2000)`,
      [`${p2}:AG11:${key}:1`, p2, key],
    );
    await pool().query(`INSERT INTO audit_logs (action, target_type, target_id, details) VALUES ('bonus_award.recovered', 'bonus_award', $1, $2)`, [`${p2}:AG11:${key}:1`, JSON.stringify({ salesCounted: cases })]);
    const sql = readFileSync("lib/server/db/migrations/009_highest_tier_rewards.sql", "utf8");
    await pool().query(sql.slice(sql.lastIndexOf("INSERT INTO bonus_sale_approvals")));
    expect((await pool().query(`SELECT COUNT(*)::int AS n FROM bonus_sale_approvals WHERE user_code = 'AG11'`)).rows[0].n).toBe(2);
    expect(await chain("AG11")).toHaveLength(1); // no award created by the backfill
    await ingestValidatedSale(pool(), sale("AG11", minsAgo(1)), "sse");
    expect((await effective("AG11")).map((r) => Number(r.amount))).toEqual([3000]);
  });
});
