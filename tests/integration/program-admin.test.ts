import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { ingestValidatedSale } from "@/backend/sales/ingest";
import { POST as createProgramRoute, GET as listProgramsRoute } from "@/app/api/admin/programs/route";
import { PATCH as patchProgram, DELETE as archiveRoute } from "@/app/api/admin/programs/[id]/route";
import { GET as checkRoute, POST as deleteRoute } from "@/app/api/admin/programs/[id]/permanent/route";
import { POST as extendPreviewRoute } from "@/app/api/admin/programs/extend/preview/route";
import { POST as extendRoute } from "@/app/api/admin/programs/extend/route";
import { PUT as putConfig } from "@/app/api/admin/arena-config/route";
import { GET as publicPrograms } from "@/app/api/arena/programs/route";
import { POST as login } from "@/app/api/admin/auth/login/route";
import { lastDayOfMonth } from "@/backend/rewards/program-admin";
import { arenaBroadcaster, type ArenaBroadcastEvent } from "@/backend/events/broadcaster";
import { createAdmin, pool, req, resetDatabase, sessionFrom, setSetting } from "./helpers";

let owner: { cookie: string; csrf: string };
let staff: { cookie: string; csrf: string };
let events: ArenaBroadcastEvent[] = [];
let off = () => {};
let seq = 0;
const ALL_ON = { daily: { active: true, showOnArena: true }, weekly: { active: true, showOnArena: true }, monthly: { active: true, showOnArena: true } };
const as = (s = owner) => ({ cookie: s.cookie, csrf: s.csrf });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const now = new Date();
const thisMonth = iso(now).slice(0, 7);
const monthPlus = (n: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + n, 1)).toISOString().slice(0, 7);
const sale = (u: string, at: Date) => ({ caseId: `PA-${Date.now()}-${seq++}`, userCode: u, closerName: `Agent ${u}`, validatedAt: at.toISOString(), premium: 1 });
const create = async (body: Record<string, unknown>, activeDaysAgo = 1) => {
  const r = await createProgramRoute(req("/api/admin/programs", { method: "POST", body: { rewardType: "cash", currency: "PKR", stackable: true, enabled: true, maxAwards: 1, ...body }, ...as() }));
  const j = await r.json();
  expect(r.status, j.error).toBe(201);
  if (j.program.enabled) await pool().query(`UPDATE reward_programs SET active_since = NOW() - ($2 || ' days')::interval WHERE id = $1`, [j.program.id, String(activeDaysAgo)]);
  return (await pool().query(`SELECT *, to_char(start_date, 'YYYY-MM-DD') AS s, to_char(end_date, 'YYYY-MM-DD') AS e FROM reward_programs WHERE id = $1`, [j.program.id])).rows[0];
};
const program = async (id: string) => (await pool().query(`SELECT *, to_char(start_date, 'YYYY-MM-DD') AS s, to_char(end_date, 'YYYY-MM-DD') AS e FROM reward_programs WHERE id = $1`, [id])).rows[0];
const awards = async () => (await pool().query(`SELECT * FROM bonus_awards ORDER BY created_at, id`)).rows;
const check = async (id: string, s = owner) => {
  const r = await checkRoute(req(`/api/admin/programs/${id}/permanent`, as(s)), ctx(id));
  return { status: r.status, body: await r.json() };
};
const del = async (id: string, body: Record<string, unknown> = { confirm: true }, s = owner) => {
  const r = await deleteRoute(req(`/api/admin/programs/${id}/permanent`, { method: "POST", body, ...as(s) }), ctx(id));
  return { status: r.status, body: await r.json() };
};
const preview = async (body: Record<string, unknown>, s = owner) => {
  const r = await extendPreviewRoute(req("/api/admin/programs/extend/preview", { method: "POST", body, ...as(s) }));
  return { status: r.status, body: await r.json() };
};
const extend = async (body: Record<string, unknown>, s = owner) => {
  const r = await extendRoute(req("/api/admin/programs/extend", { method: "POST", body: { confirm: true, ...body }, ...as(s) }));
  return { status: r.status, body: await r.json() };
};

describe("reward program delete and extend (Owner)", () => {
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
    await setSetting("auto_spins_enabled", false);
    await setSetting("reward_activation_cutoff", null);
    await putConfig(req("/api/admin/arena-config", { method: "PUT", body: { values: { businessTimezone: "UTC", weekStartDay: 1, rewardCategories: ALL_ON } }, ...as() }));
    events = [];
    off = arenaBroadcaster.subscribe((e) => events.push(e));
  });
  afterEach(() => off());

  it("Owner permanently deletes an unused program; it is logged, gone everywhere and never awards", async () => {
    const p = await create({ kind: "daily", name: "Unused 2", salesRequired: 2, amount: 2000 });
    await patchProgram(req(`/api/admin/programs/${p.id}`, { method: "PATCH", body: { amount: 2500 }, ...as() }), ctx(p.id));
    const c = await check(p.id);
    expect(c.body).toMatchObject({ canDelete: true, awards: { total: 0 }, program: { name: "Unused 2", kind: "daily", salesRequired: 2, amount: 2500 } });
    expect((await del(p.id, { confirm: false })).status).toBe(428);
    expect((await del(p.id, { confirm: true, revision: 1 })).status).toBe(409); // stale dialog
    const d = await del(p.id, { confirm: true, revision: c.body.program.revision });
    expect(d.status, d.body.error).toBe(200);
    expect(await program(p.id)).toBeUndefined();
    expect((await pool().query(`SELECT 1 FROM reward_program_history WHERE program_id = $1`, [p.id])).rowCount).toBe(0);
    const audit = (await pool().query(`SELECT a.details, u.email FROM audit_logs a JOIN admin_users u ON u.id = a.admin_id WHERE a.action = 'reward_program.deleted'`)).rows[0];
    expect(audit.email).toBe("owner@example.com");
    expect(audit.details.program).toMatchObject({ id: p.id, name: "Unused 2", amount: 2500 });
    expect(audit.details.history.map((h: { action: string }) => h.action)).toEqual(["edited", "created"]); // history preserved in the audit log
    expect(events.at(-1)).toMatchObject({ type: "rewards.program.updated", payload: { programId: p.id, action: "deleted" } });
    const list = await (await listProgramsRoute(req("/api/admin/programs?archived=1", as()))).json();
    expect(list.programs).toHaveLength(0);
    expect((await (await publicPrograms()).json()).programs).toHaveLength(0);
    for (let i = 0; i < 2; i++) await ingestValidatedSale(pool(), sale("AG1", new Date(Date.now() - (10 - i) * 60_000)), "sse");
    expect(await awards()).toHaveLength(0);
    expect((await del(p.id)).status).toBe(404); // nothing to (re)activate
  });

  it("non-Owners cannot check or delete; programs with award history can only be archived", async () => {
    const p = await create({ kind: "daily", name: "Paid one", salesRequired: 1, amount: 1000 });
    expect((await check(p.id, staff)).status).toBe(403);
    expect((await del(p.id, { confirm: true }, staff)).status).toBe(403);
    expect((await deleteRoute(req(`/api/admin/programs/${p.id}/permanent`, { method: "POST", body: { confirm: true } }), ctx(p.id))).status).toBe(401);
    await ingestValidatedSale(pool(), sale("AG2", new Date(Date.now() - 60_000)), "sse");
    const before = await awards();
    expect(before).toHaveLength(1);
    const c = await check(p.id);
    expect(c.body).toMatchObject({ canDelete: false, awards: { total: 1, cash: 1000 } });
    const d = await del(p.id, { confirm: true });
    expect(d.status).toBe(409);
    expect(d.body.error).toBe("This reward has existing award history and cannot be permanently deleted. You can archive it instead.");
    expect(await program(p.id)).toBeDefined();
    expect(await awards()).toEqual(before); // financial history untouched
    // Even a raw delete is blocked by the foreign key.
    await expect(pool().query(`DELETE FROM reward_programs WHERE id = $1`, [p.id])).rejects.toThrow();
    const arch = await archiveRoute(req(`/api/admin/programs/${p.id}`, { method: "DELETE", ...as() }), ctx(p.id));
    expect((await arch.json()).program.status).toBe("archived");
  });

  it("duplicates: the dialog says which one awards; deleting the non-awarding copy leaves the original awarding", async () => {
    const a = await create({ kind: "monthly", name: "M70 original", salesRequired: 2, amount: 70000 }, 5);
    const b = await create({ kind: "monthly", name: "M70 copy", salesRequired: 3, amount: 70000 }, 2);
    await pool().query(`UPDATE reward_programs SET sales_required = 2 WHERE id = $1`, [b.id]); // legacy duplicate
    const cb = await check(b.id);
    expect(cb.body.duplicate).toMatchObject({ awarding: false, others: [{ id: a.id, awarding: true }] });
    expect((await check(a.id)).body.duplicate).toMatchObject({ awarding: true });
    expect((await del(b.id, { confirm: true })).status).toBe(200);
    expect((await program(a.id)).enabled).toBe(true);
    const list = await (await listProgramsRoute(req("/api/admin/programs", as()))).json();
    expect(list.duplicates).toHaveLength(0);
    for (let i = 0; i < 2; i++) await ingestValidatedSale(pool(), sale("AG3", new Date(Date.now() - (5 - i) * 60_000)), "sse");
    expect((await awards()).map((r) => r.program_id)).toEqual([a.id]);
  });

  it("extends to the end of a chosen future month (month lengths computed), preserving everything else; idempotent", async () => {
    expect(["2027-02", "2028-02", "2026-12", "2027-01", "2026-04"].map(lastDayOfMonth)).toEqual(["2027-02-28", "2028-02-29", "2026-12-31", "2027-01-31", "2026-04-30"]);
    const end = lastDayOfMonth(thisMonth);
    const p = await create({ kind: "weekly", name: "Weekly 8", salesRequired: 8, amount: 8000, startDate: `${thisMonth}-01`, endDate: end, stackable: false, scopeType: "agents", scopeIds: ["AG9"] });
    const before = await program(p.id);
    const rng = await preview({});
    expect(rng.body).toMatchObject({ currentMonth: thisMonth, earliestMonth: monthPlus(1), items: [] });
    expect((await preview({ targetMonth: thisMonth })).status).toBe(400); // must be a future month
    expect((await preview({ targetMonth: monthPlus(1) }, staff)).status).toBe(403);
    const pv = await preview({ targetMonth: monthPlus(1), kinds: ["weekly"] });
    expect(pv.body.items).toEqual([expect.objectContaining({ id: p.id, status: "will_extend", startDate: `${thisMonth}-01`, endDate: end, newEndDate: lastDayOfMonth(monthPlus(1)) })]);
    expect(pv.body.affected).toBe(1);
    const r = await extend({ targetMonth: monthPlus(1), programIds: [p.id], revisions: { [p.id]: pv.body.items[0].revision } });
    expect(r.status, r.body.error).toBe(200);
    expect(r.body.extended).toEqual([p.id]);
    const after = await program(p.id);
    expect(after.e).toBe(lastDayOfMonth(monthPlus(1)));
    for (const k of ["s", "active_since", "sales_required", "amount", "stackable", "scope_type", "scope_ids", "show_on_arena", "enabled", "created_at"]) expect(after[k], k).toEqual(before[k]);
    expect(after.revision).toBe(before.revision + 1);
    expect((await pool().query(`SELECT action FROM reward_program_history WHERE program_id = $1 ORDER BY revision DESC LIMIT 1`, [p.id])).rows[0].action).toBe("extended");
    const audit = (await pool().query(`SELECT details FROM audit_logs WHERE action = 'reward_program.extended'`)).rows[0].details;
    expect(audit.endDate).toEqual({ from: end, to: lastDayOfMonth(monthPlus(1)) });
    expect(events.filter((e) => e.type === "rewards.program.updated").at(-1)?.payload).toMatchObject({ programId: p.id, action: "extended" });
    // Same month again: already covered, no revision bump. Stale revision is refused.
    const again = await extend({ targetMonth: monthPlus(1), programIds: [p.id] });
    expect(again.body).toMatchObject({ extended: [], skipped: [{ id: p.id }] });
    expect((await program(p.id)).revision).toBe(after.revision);
    expect((await extend({ targetMonth: monthPlus(3), programIds: [p.id], revisions: { [p.id]: before.revision } })).status).toBe(409);
  });

  it("an expired program is only reactivated by explicit Owner choice, then earns from that moment (nothing retroactive)", async () => {
    const yesterday = iso(new Date(Date.now() - 86400_000));
    const p = await create({ kind: "daily", name: "Daily 2", salesRequired: 2, amount: 2000, endDate: yesterday }, 10);
    for (let i = 0; i < 3; i++) await ingestValidatedSale(pool(), sale("AG4", new Date(Date.now() - (30 - i) * 60_000)), "sse");
    expect(await awards()).toHaveLength(0); // expired: today is outside its dates
    const pv = await preview({ targetMonth: monthPlus(1), programIds: [p.id] });
    expect(pv.body.items[0]).toMatchObject({ status: "needs_reactivation", effectiveStart: "On reactivation (from that moment)" });
    const skipped = await extend({ targetMonth: monthPlus(1), programIds: [p.id] });
    expect(skipped.body).toMatchObject({ extended: [], skipped: [{ id: p.id }] });
    expect((await program(p.id)).e).toBe(yesterday);
    const t0 = Date.now();
    const ok = await extend({ targetMonth: monthPlus(1), programIds: [p.id], reactivateIds: [p.id] });
    expect(ok.body.extended).toEqual([p.id]);
    const after = await program(p.id);
    expect(new Date(after.active_since).getTime()).toBeGreaterThanOrEqual(t0 - 1000);
    expect(await awards()).toHaveLength(0); // the 3 earlier sales are not awarded retroactively
    await ingestValidatedSale(pool(), sale("AG4", new Date()), "sse");
    expect(await awards()).toHaveLength(0); // 1 sale since reactivation
    await ingestValidatedSale(pool(), sale("AG4", new Date(Date.now() + 1000)), "sse");
    expect(await awards()).toHaveLength(1);
  });

  it("extended programs keep counting per business day, week and month (periods never combine); awards untouched", async () => {
    await create({ kind: "daily", name: "D2", salesRequired: 2, amount: 2000 }, 70);
    await create({ kind: "weekly", name: "W2", salesRequired: 2, amount: 8000 }, 70);
    await create({ kind: "monthly", name: "M2", salesRequired: 2, amount: 20000 }, 70);
    const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12));
    const lastMonth = new Date(firstOfMonth.getTime() - 2 * 86400_000); // previous month, previous week, previous day
    await ingestValidatedSale(pool(), sale("AG5", lastMonth), "sse");
    await ingestValidatedSale(pool(), sale("AG5", new Date()), "sse");
    expect(await awards()).toHaveLength(0); // 1 sale in each period: no milestone reached
    const awarded = await create({ kind: "daily", name: "D1", salesRequired: 1, amount: 100 }, 70);
    await ingestValidatedSale(pool(), sale("AG6", new Date()), "sse");
    const before = await awards();
    expect(before).toHaveLength(1);
    await extend({ targetMonth: monthPlus(2), programIds: [awarded.id] });
    expect(await awards()).toEqual(before);
  });
});
