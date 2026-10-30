import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { GET as adminList, POST as adminCreate } from "@/app/api/admin/catalog/route";
import { PATCH as adminPatch, DELETE as adminDelete } from "@/app/api/admin/catalog/[id]/route";
import { POST as adminReorder } from "@/app/api/admin/catalog/reorder/route";
import { GET as publicCatalog } from "@/app/api/arena/catalog/route";
import { POST as login } from "@/app/api/admin/auth/login/route";
import { allocateManualSpins } from "@/lib/server/spins/ledger";
import { executeSpin } from "@/lib/server/spins/execute";
import { arenaBroadcaster, type ArenaBroadcastEvent } from "@/lib/server/events/broadcaster";
import { createAdmin, createAgent, pool, req, resetDatabase, restartPool, sessionFrom } from "./helpers";

let admin: { id: string };
let sess: { cookie: string; csrf: string };
let events: ArenaBroadcastEvent[] = [];
let unsubscribe: () => void = () => {};

const auth = () => ({ cookie: sess.cookie, csrf: sess.csrf });
const prize = (over: Record<string, unknown> = {}) => ({ title: "Coffee", description: "", icon: "coffee", color: "#FFC857", active: true, quantity: null, weight: 1, displayOrder: 0, ...over });
const create = async (over: Record<string, unknown> = {}) => (await (await adminCreate(req("/api/admin/catalog", { method: "POST", body: prize(over), ...auth() }))).json()).id as string;
const wheel = async () => (await (await publicCatalog()).json()) as { revision: string; prizes: Array<{ id: string; title: string; color: string }> };
const key = () => `test-${Math.random().toString(36).slice(2, 12)}`;

describe("prize catalog (PostgreSQL is the single source of truth)", () => {
  beforeAll(async () => {
    await resetDatabase();
    admin = await createAdmin();
    sess = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" } })));
  });
  beforeEach(async () => {
    await pool().query(`TRUNCATE spin_credit_transactions, manual_spin_allocations, spin_results, spin_credits, rewards_catalog, audit_logs RESTART IDENTITY CASCADE`);
    events = [];
    unsubscribe = arenaBroadcaster.subscribe((e) => events.push(e));
  });
  afterEach(() => unsubscribe());

  it("Test A/B: create and edit save to PostgreSQL, then publish a new revision the Live Arena reads", async () => {
    const a = await create({ title: "Coffee", displayOrder: 1 });
    const b = await create({ title: "Headphones", icon: "headphones", color: "#27D5FF", displayOrder: 2 });
    const first = await wheel();
    expect(first.prizes.map((p) => p.title)).toEqual(["Coffee", "Headphones"]);
    expect(events.filter((e) => e.type === "rewards.catalog.updated")).toHaveLength(2);

    const res = await adminPatch(req(`/api/admin/catalog/${a}`, { method: "PATCH", body: prize({ title: "Large Coffee", color: "#FF7A59", displayOrder: 1 }), ...auth() }), { params: Promise.resolve({ id: a }) });
    expect(res.status).toBe(200);
    const after = await wheel();
    expect(after.prizes[0]).toMatchObject({ id: a, title: "Large Coffee", color: "#FF7A59" });
    expect(after.revision).not.toBe(first.revision);
    const last = events.at(-1)!;
    expect(last.type).toBe("rewards.catalog.updated");
    expect((last.payload as { revision: string }).revision).toBe(after.revision); // event carries the committed revision

    await restartPool(); // persists across a restart
    expect((await wheel()).prizes.map((p) => p.title)).toEqual(["Large Coffee", "Headphones"]);
    const audit = await pool().query(`SELECT action FROM audit_logs WHERE admin_id = $1 ORDER BY id`, [admin.id]);
    expect(audit.rows.map((r) => r.action).filter((x) => x.startsWith("prize."))).toEqual(["prize.created", "prize.created", "prize.updated"]);
    void b;
  });

  it("an invalid change saves nothing and publishes nothing", async () => {
    const res = await adminCreate(req("/api/admin/catalog", { method: "POST", body: prize({ color: "red" }), ...auth() }));
    expect(res.status).toBe(400);
    expect((await wheel()).prizes).toHaveLength(0);
    expect(events).toHaveLength(0);
    // and without an admin session nothing changes either
    expect((await adminCreate(req("/api/admin/catalog", { method: "POST", body: prize() }))).status).toBe(401);
  });

  it("Test D: reorder changes the clockwise order only; the server picks by weight, not position", async () => {
    const a = await create({ title: "Never", weight: 0.01, displayOrder: 1 });
    const b = await create({ title: "Almost always", weight: 1000, displayOrder: 2 });
    const r = await adminReorder(req("/api/admin/catalog/reorder", { method: "POST", body: { ids: [b, a] }, ...auth() }));
    expect(r.status).toBe(200);
    expect((await wheel()).prizes.map((p) => p.id)).toEqual([b, a]);
    expect((await adminReorder(req("/api/admin/catalog/reorder", { method: "POST", body: { ids: [a] }, ...auth() }))).status).toBe(409); // partial list refused

    await createAgent("ODD1");
    await allocateManualSpins(pool(), { userCode: "ODD1", quantity: 20, reason: "Odds check", idempotencyKey: key(), adminId: admin.id });
    const wins: string[] = [];
    for (let i = 0; i < 20; i++) wins.push((await executeSpin(pool(), { userCode: "ODD1", idempotencyKey: key(), actor: "admin:test" })).reward.id);
    expect(wins.filter((w) => w === b).length).toBeGreaterThanOrEqual(18); // weight 1000 vs 0.01
  });

  it("Test C: removing a won prize deactivates it, keeps history and its name snapshot; an unused prize is deleted", async () => {
    const won = await create({ title: "Mug", displayOrder: 1 });
    const unused = await create({ title: "Pen", displayOrder: 2 });
    await createAgent("HIS1");
    await allocateManualSpins(pool(), { userCode: "HIS1", quantity: 1, reason: "History check", idempotencyKey: key(), adminId: admin.id });
    await pool().query(`UPDATE rewards_catalog SET weight = 0.0001 WHERE id = $1`, [unused]);
    const spin = await executeSpin(pool(), { userCode: "HIS1", idempotencyKey: key(), actor: "admin:test" });
    expect(spin.reward.id).toBe(won);

    // Rename after the win: history keeps the name at the time of winning.
    await adminPatch(req(`/api/admin/catalog/${won}`, { method: "PATCH", body: prize({ title: "Renamed Mug", displayOrder: 1 }), ...auth() }), { params: Promise.resolve({ id: won }) });
    const del1 = await (await adminDelete(req(`/api/admin/catalog/${won}`, { method: "DELETE", ...auth() }), { params: Promise.resolve({ id: won }) })).json();
    const del2 = await (await adminDelete(req(`/api/admin/catalog/${unused}`, { method: "DELETE", ...auth() }), { params: Promise.resolve({ id: unused }) })).json();
    expect(del1.outcome).toBe("deactivated");
    expect(del2.outcome).toBe("deleted");
    expect((await wheel()).prizes).toHaveLength(0);
    const hist = await pool().query(`SELECT reward_id, reward_title FROM spin_results WHERE user_code = 'HIS1'`);
    expect(hist.rows).toEqual([{ reward_id: won, reward_title: "Mug" }]);
    const list = await (await adminList(req("/api/admin/catalog", auth()))).json();
    expect(list.prizes.map((p: { id: string }) => p.id)).toEqual([won]); // still listed (inactive) for history
  });

  it("Test E/F: stock never goes negative or oversubscribes under concurrent spins; sold-out prizes leave the wheel", async () => {
    const limited = await create({ title: "Last TV", quantity: 1, weight: 1000, displayOrder: 1 });
    await create({ title: "Sticker", weight: 0.01, displayOrder: 2 });
    for (const u of ["CC1", "CC2", "CC3", "CC4"]) {
      await createAgent(u);
      await allocateManualSpins(pool(), { userCode: u, quantity: 1, reason: "Stock check", idempotencyKey: key(), adminId: admin.id });
    }
    const results = await Promise.all(["CC1", "CC2", "CC3", "CC4"].map((u) => executeSpin(pool(), { userCode: u, idempotencyKey: key(), actor: "admin:test" })));
    expect(results.filter((r) => r.reward.id === limited)).toHaveLength(1);
    expect((await pool().query(`SELECT quantity FROM rewards_catalog WHERE id = $1`, [limited])).rows[0].quantity).toBe(0);
    expect((await wheel()).prizes.map((p) => p.title)).toEqual(["Sticker"]);
    const balances = await pool().query(`SELECT SUM(available)::int AS n FROM spin_credits`);
    expect(balances.rows[0].n).toBe(0); // each credit spent exactly once
  });
});
