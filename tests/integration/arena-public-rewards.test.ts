import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { ingestValidatedSale } from "@/lib/server/sales/ingest";
import { POST as createProgramRoute } from "@/app/api/admin/programs/route";
import { PATCH as patchProgram } from "@/app/api/admin/programs/[id]/route";
import { PATCH as patchAward } from "@/app/api/admin/awards/[id]/route";
import { PUT as putConfig } from "@/app/api/admin/arena-config/route";
import { GET as publicPrograms } from "@/app/api/arena/programs/route";
import { GET as publicAwards } from "@/app/api/arena/awards/route";
import { POST as login } from "@/app/api/admin/auth/login/route";
import { createAdmin, pool, req, resetDatabase, sessionFrom, setSetting } from "./helpers";

/** The Live Arena's reward display: only real, visible, in-date programs; totals from bonus_awards. */
let sess: { cookie: string; csrf: string };
let seq = 0;
const DAILY = [[2, 2000], [3, 3000], [4, 5000], [5, 7000]] as const;
const WEEKLY = [[8, 8000], [10, 12000], [12, 16000], [15, 23000]] as const;

const create = async (body: Record<string, unknown>) => {
  const r = await createProgramRoute(req("/api/admin/programs", { method: "POST", body: { enabled: true, rewardType: "cash", currency: "PKR", stackable: true, ...body }, cookie: sess.cookie, csrf: sess.csrf }));
  const j = await r.json();
  expect(r.status, j.error).toBe(201);
  await pool().query(`UPDATE reward_programs SET active_since = NOW() - INTERVAL '5 hours' WHERE id = $1`, [j.program.id]);
  return j.program as { id: string };
};
const patch = (id: string, body: Record<string, unknown>) =>
  patchProgram(req(`/api/admin/programs/${id}`, { method: "PATCH", body, cookie: sess.cookie, csrf: sess.csrf }), { params: Promise.resolve({ id }) });
const config = (values: Record<string, unknown>) => putConfig(req("/api/admin/arena-config", { method: "PUT", body: { values }, cookie: sess.cookie, csrf: sess.csrf }));
const programs = async () => (await (await publicPrograms()).json()).programs as Array<Record<string, unknown>>;
const summary = async () => (await (await publicAwards(req("/api/arena/awards"))).json()).summary;
const sale = (u: string, minutesAgo: number) => ({ caseId: `PUB-${Date.now()}-${seq++}`, userCode: u, closerName: "Rehan Ali", validatedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(), premium: 50 });
const ALL_ON = { daily: { active: true, showOnArena: true }, weekly: { active: true, showOnArena: true }, monthly: { active: true, showOnArena: true } };

describe("public Live Arena reward display", () => {
  beforeAll(async () => {
    await resetDatabase();
    await createAdmin();
    sess = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" } })));
  });
  beforeEach(async () => {
    await pool().query(`TRUNCATE reward_program_history, bonus_awards, spin_credit_transactions, automatic_spin_awards, spin_credits, sale_status_history, sales_events_inbox, validated_sales, agents, reward_programs RESTART IDENTITY CASCADE`);
    await pool().query(`DELETE FROM admin_settings WHERE key = 'arena.config'`);
    await setSetting("auto_spins_enabled", false);
    await setSetting("reward_activation_cutoff", new Date(Date.now() - 6 * 3600_000).toISOString());
    await config({ businessTimezone: "UTC", rewardCategories: ALL_ON });
  });

  it("lists exactly the configured Daily and Weekly tiers, sorted, with no hard-coded program and no agent codes", async () => {
    for (const [n, amt] of DAILY) await create({ kind: "daily", name: `FE Senior Daily ${n}`, salesRequired: n, amount: amt });
    for (const [n, amt] of WEEKLY) await create({ kind: "weekly", name: `FE Senior Weekly ${n}`, salesRequired: n, amount: amt });
    await create({ kind: "daily", name: "Selected only", salesRequired: 9, amount: 900, scopeType: "agents", scopeIds: ["SECRET01"] });
    const list = await programs();
    const tiers = (k: string) => list.filter((p) => p.kind === k).map((p) => [p.salesRequired, p.amount, p.currency, p.stackable]);
    expect(tiers("daily")).toEqual([...DAILY.map(([n, a]) => [n, a, "PKR", true]), [9, 900, "PKR", true]]);
    expect(tiers("weekly")).toEqual(WEEKLY.map(([n, a]) => [n, a, "PKR", true]));
    expect(tiers("monthly")).toEqual([]); // nothing invented
    expect(list.find((p) => p.name === "Selected only")!.limitedEligibility).toBe(true);
    const json = JSON.stringify(list);
    expect(json).not.toContain("SECRET01");
    expect(json).not.toContain("scopeIds");
    expect(json).not.toMatch(/"salesRequired":1,"/);
  });

  it("respects every Admin switch: program enabled / visible / archived, category active / visible, date range", async () => {
    const a = await create({ kind: "daily", name: "Two", salesRequired: 2, amount: 2000 });
    const b = await create({ kind: "daily", name: "Three", salesRequired: 3, amount: 3000 });
    const names = async () => (await programs()).map((p) => p.name);
    expect(await names()).toEqual(["Two", "Three"]);
    await patch(a.id, { showOnArena: false });
    expect(await names()).toEqual(["Three"]);
    await patch(a.id, { showOnArena: true });
    await patch(b.id, { enabled: false });
    expect(await names()).toEqual(["Two"]);
    await patch(b.id, { enabled: true, amount: 3500 }); // an edited amount is what the arena shows
    expect((await programs()).find((p) => p.name === "Three")!.amount).toBe(3500);
    await config({ rewardCategories: { ...ALL_ON, daily: { active: false, showOnArena: true } } });
    expect(await names()).toEqual([]); // category paused → not "currently available"
    await config({ rewardCategories: { ...ALL_ON, daily: { active: true, showOnArena: false } } });
    expect(await names()).toEqual([]);
    await config({ rewardCategories: ALL_ON });
    const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    await patch(a.id, { startDate: tomorrow });
    await patch(b.id, { endDate: yesterday });
    expect(await names()).toEqual([]); // outside their date ranges (business timezone)
    await patch(a.id, { archived: true });
    expect((await programs()).some((p) => p.name === "Two")).toBe(false);
  });

  it("earned totals come from bonus_awards: only the highest tier counts, cancelled excluded, earned ≠ paid", async () => {
    for (const [n, amt] of DAILY) await create({ kind: "daily", name: `D${n}`, salesRequired: n, amount: amt });
    const weekly8 = await create({ kind: "weekly", name: "W8", salesRequired: 8, amount: 8000 });
    const single = await create({ kind: "monthly", name: "M1", salesRequired: 1, amount: 500 });
    expect(await summary()).toMatchObject({ daily: { earned: 0, count: 0 }, weekly: { earned: 0 }, monthly: { earned: 0 } }); // a genuine zero
    for (let i = 0; i < 3; i++) await ingestValidatedSale(pool(), sale("RA01", 30 - i), "sse");
    let s = await summary();
    expect(s.daily).toMatchObject({ earned: 3000, paid: 0, count: 1, currency: "PKR" }); // 3 sales: 3,000 supersedes 2,000 (never 5,000)
    expect(s.daily.periodKey).toMatch(/^D:\d{4}-\d{2}-\d{2}$/);
    // Re-delivered sales never double count.
    const dup = (await pool().query(`SELECT case_id FROM validated_sales LIMIT 1`)).rows[0].case_id;
    await ingestValidatedSale(pool(), { ...sale("RA01", 1), caseId: dup }, "reconciliation");
    expect((await summary()).daily.earned).toBe(3000);

    const top = (await pool().query(`SELECT id FROM bonus_awards WHERE kind = 'daily' AND superseded_by IS NULL`)).rows[0].id;
    const setStatus = (id: string, status: string, note?: string) =>
      patchAward(req(`/api/admin/awards/x`, { method: "PATCH", body: { status, note }, cookie: sess.cookie, csrf: sess.csrf }), { params: Promise.resolve({ id: encodeURIComponent(id) }) });
    await setStatus(top, "approved");
    await setStatus(top, "paid");
    s = await summary();
    expect(s.daily).toMatchObject({ earned: 3000, paid: 3000 });
    // Cancelled awards are excluded (a single, un-chained award can be cancelled).
    const m1 = (await pool().query(`SELECT id FROM bonus_awards WHERE program_id = $1`, [single.id])).rows[0].id;
    expect((await summary()).monthly.earned).toBe(500);
    await setStatus(m1, "cancelled", "Test cancel");
    expect((await summary()).monthly).toMatchObject({ earned: 0, count: 0 });
    // Hidden programs are not counted publicly either.
    await patch(weekly8.id, { showOnArena: false });
    expect((await summary()).weekly.earned).toBe(0);
  });
});
