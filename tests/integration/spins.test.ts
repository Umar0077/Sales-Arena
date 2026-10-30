import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { allocateManualSpins, SpinError } from "@/lib/server/spins/ledger";
import { executeSpin } from "@/lib/server/spins/execute";
import { POST as spinApi } from "@/app/api/arena/spin/route";
import { POST as pairApi } from "@/app/api/arena/device/pair/route";
import { POST as createDevice } from "@/app/api/admin/devices/route";
import { DELETE as revokeDevice } from "@/app/api/admin/devices/[id]/route";
import { POST as allocateApi } from "@/app/api/admin/spins/allocate/route";
import { POST as login } from "@/app/api/admin/auth/login/route";
import { deviceCookieName } from "@/lib/server/auth/arena-device";
import { createAdmin, createAgent, pool, req, resetDatabase, sessionFrom } from "./helpers";

let admin: { id: string };
const key = (s: string) => `test-key-${s}-${Math.random().toString(36).slice(2, 10)}`;
const balance = async (u: string) => (await pool().query(`SELECT available FROM spin_credits WHERE user_code = $1`, [u])).rows[0]?.available ?? 0;

async function addPrize(id: string, quantity: number | null = null, weight = 1) {
  await pool().query(
    `INSERT INTO rewards_catalog (id, title, icon, color, active, quantity, weight, display_order) VALUES ($1, $1, 'gift', '#FFC857', TRUE, $2, $3, 0)`,
    [id, quantity, weight],
  );
}

describe("spin ledger", () => {
  beforeAll(async () => {
    await resetDatabase();
    admin = await createAdmin();
  });
  beforeEach(async () => {
    await pool().query(
      `TRUNCATE spin_credit_transactions, manual_spin_allocations, automatic_spin_awards, spin_results, spin_credits, rewards_catalog, arena_devices, audit_logs, admin_sessions, admin_login_attempts RESTART IDENTITY CASCADE`,
    );
    await createAgent("AL1", "Ali Khan");
    await createAgent("BO2", "Bo Lee");
  });

  it("manual allocation writes the balance, an immutable ledger row, an allocation row and an audit entry", async () => {
    const r = await allocateManualSpins(pool(), { userCode: "AL1", quantity: 3, reason: "Contest winner", idempotencyKey: key("a"), adminId: admin.id });
    expect(r).toMatchObject({ replayed: false, balanceBefore: 0, balanceAfter: 3 });
    expect(await balance("AL1")).toBe(3);
    const tx = await pool().query(`SELECT kind, quantity, balance_before, balance_after, admin_id, reason FROM spin_credit_transactions`);
    expect(tx.rows).toEqual([{ kind: "manual", quantity: 3, balance_before: 0, balance_after: 3, admin_id: admin.id, reason: "Contest winner" }]);
    expect((await pool().query(`SELECT quantity, reason FROM manual_spin_allocations`)).rows).toEqual([{ quantity: 3, reason: "Contest winner" }]);
    expect((await pool().query(`SELECT action, target_id FROM audit_logs`)).rows).toEqual([{ action: "spins.manual_allocate", target_id: "AL1" }]);
  });

  it("a retried request (same key) never grants twice; reusing a key for something else is refused", async () => {
    const k = key("retry");
    const a = await allocateManualSpins(pool(), { userCode: "AL1", quantity: 2, reason: "Retry check", idempotencyKey: k, adminId: admin.id });
    const b = await allocateManualSpins(pool(), { userCode: "AL1", quantity: 2, reason: "Retry check", idempotencyKey: k, adminId: admin.id });
    expect(b.replayed).toBe(true);
    expect(b.transactionId).toBe(a.transactionId);
    expect(await balance("AL1")).toBe(2);
    await expect(
      allocateManualSpins(pool(), { userCode: "AL1", quantity: 5, reason: "Different", idempotencyKey: k, adminId: admin.id }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("validates reason, quantity and agent", async () => {
    await expect(allocateManualSpins(pool(), { userCode: "AL1", quantity: 1, reason: " ", idempotencyKey: key("r"), adminId: admin.id })).rejects.toBeInstanceOf(SpinError);
    await expect(allocateManualSpins(pool(), { userCode: "AL1", quantity: 0, reason: "zero", idempotencyKey: key("q"), adminId: admin.id })).rejects.toBeInstanceOf(SpinError);
    await expect(allocateManualSpins(pool(), { userCode: "AL1", quantity: 51, reason: "too many", idempotencyKey: key("q"), adminId: admin.id })).rejects.toBeInstanceOf(SpinError);
    await expect(allocateManualSpins(pool(), { userCode: "NOPE", quantity: 1, reason: "nobody", idempotencyKey: key("n"), adminId: admin.id })).rejects.toMatchObject({ code: "agent_not_found" });
    expect(await balance("AL1")).toBe(0);
  });

  it("concurrent allocations: distinct keys all apply, identical keys apply once", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => allocateManualSpins(pool(), { userCode: "BO2", quantity: 1, reason: `Bulk ${i}`, idempotencyKey: key(`c${i}`), adminId: admin.id })));
    expect(await balance("BO2")).toBe(20);
    const k = key("same");
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => allocateManualSpins(pool(), { userCode: "AL1", quantity: 4, reason: "Same key", idempotencyKey: k, adminId: admin.id })));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await balance("AL1")).toBe(4);
    const ledger = await pool().query(`SELECT balance_before, balance_after FROM spin_credit_transactions WHERE user_code = 'BO2' ORDER BY id`);
    // A gap-free chain: every row starts where the previous one ended.
    ledger.rows.forEach((r, i) => expect(r).toEqual({ balance_before: i, balance_after: i + 1 }));
  });

  it("concurrent spins never overspend: 3 credits, 10 parallel attempts → exactly 3 spins", async () => {
    await addPrize("rw_a");
    await addPrize("rw_b");
    await allocateManualSpins(pool(), { userCode: "AL1", quantity: 3, reason: "Spin test", idempotencyKey: key("s"), adminId: admin.id });
    const out = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => executeSpin(pool(), { userCode: "AL1", idempotencyKey: key(`spin${i}`), actor: "test" })));
    const ok = out.filter((r) => r.status === "fulfilled");
    const denied = out.filter((r) => r.status === "rejected" && (r.reason as SpinError).code === "insufficient_credits");
    expect(ok).toHaveLength(3);
    expect(denied).toHaveLength(7);
    expect(await balance("AL1")).toBe(0);
    expect((await pool().query(`SELECT COUNT(*)::int AS n FROM spin_results`)).rows[0].n).toBe(3);
    expect((await pool().query(`SELECT COUNT(*)::int AS n FROM spin_credit_transactions WHERE kind = 'consume'`)).rows[0].n).toBe(3);
    const c = await pool().query(`SELECT consumed, manual_earned, available FROM spin_credits WHERE user_code = 'AL1'`);
    expect(c.rows[0]).toEqual({ consumed: 3, manual_earned: 3, available: 0 });
  });

  it("a retried spin returns the same result without using another credit", async () => {
    await addPrize("rw_a");
    await allocateManualSpins(pool(), { userCode: "AL1", quantity: 2, reason: "Replay", idempotencyKey: key("p"), adminId: admin.id });
    const k = key("spinretry");
    const [a, b] = await Promise.all([
      executeSpin(pool(), { userCode: "AL1", idempotencyKey: k, actor: "test" }),
      executeSpin(pool(), { userCode: "AL1", idempotencyKey: k, actor: "test" }),
    ]);
    expect(a.spinId).toBe(b.spinId);
    expect(a.segmentIndex).toBe(b.segmentIndex);
    expect(await balance("AL1")).toBe(1);
  });

  it("limited stock is never oversold and the result matches the segment the wheel shows", async () => {
    await addPrize("rw_limited", 1, 1000);
    await addPrize("rw_unlimited", null, 0.01);
    await allocateManualSpins(pool(), { userCode: "AL1", quantity: 5, reason: "Stock", idempotencyKey: key("st"), adminId: admin.id });
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => executeSpin(pool(), { userCode: "AL1", idempotencyKey: key(`st${i}`), actor: "test" })));
    expect(results.filter((r) => r.reward.id === "rw_limited").length).toBeLessThanOrEqual(1);
    for (const r of results) expect(r.segments[r.segmentIndex].id).toBe(r.reward.id);
    expect((await pool().query(`SELECT quantity FROM rewards_catalog WHERE id = 'rw_limited'`)).rows[0].quantity).toBe(0);
  });

  it("the spin API trusts only a signed-in admin or a paired display — never a bare userCode", async () => {
    await addPrize("rw_a");
    await allocateManualSpins(pool(), { userCode: "AL1", quantity: 2, reason: "API", idempotencyKey: key("api"), adminId: admin.id });
    const body = { userCode: "AL1", idempotencyKey: key("x") };

    const anon = await spinApi(req("/api/arena/spin", { method: "POST", body }));
    expect(anon.status).toBe(401);
    expect(await balance("AL1")).toBe(2);

    // Admin creates a display + one-time code; the TV redeems it.
    const sess = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" } })));
    const created = await (await createDevice(req("/api/admin/devices", { method: "POST", cookie: sess.cookie, csrf: sess.csrf, body: { label: "Floor TV" } }))).json();
    expect(created.code).toMatch(/^[A-Z2-9]{8}$/);
    const paired = await pairApi(req("/api/arena/device/pair", { method: "POST", body: { code: created.code } }));
    expect(paired.status).toBe(200);
    const devCookie = `${deviceCookieName()}=${paired.headers.get("set-cookie")!.match(new RegExp(`${deviceCookieName()}=([^;]+)`))![1]}`;
    // The code works once only.
    expect((await pairApi(req("/api/arena/device/pair", { method: "POST", body: { code: created.code } }))).status).toBe(400);

    const crossSite = await spinApi(req("/api/arena/spin", { method: "POST", body, cookie: devCookie, origin: "https://evil.example" }));
    expect(crossSite.status).toBe(403);
    const ok = await spinApi(req("/api/arena/spin", { method: "POST", body, cookie: devCookie }));
    expect(ok.status).toBe(200);
    expect(await balance("AL1")).toBe(1);

    const rev = await revokeDevice(req(`/api/admin/devices/${created.id}`, { method: "DELETE", cookie: sess.cookie, csrf: sess.csrf }), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(rev.status).toBe(200);
    const afterRevoke = await spinApi(req("/api/arena/spin", { method: "POST", body: { userCode: "AL1", idempotencyKey: key("y") }, cookie: devCookie }));
    expect(afterRevoke.status).toBe(401);
    expect(await balance("AL1")).toBe(1);

    // A signed-in admin may run a spin directly.
    const byAdmin = await spinApi(req("/api/arena/spin", { method: "POST", body: { userCode: "AL1", idempotencyKey: key("z") }, cookie: sess.cookie }));
    expect(byAdmin.status).toBe(200);
    const none = await spinApi(req("/api/arena/spin", { method: "POST", body: { userCode: "AL1", idempotencyKey: key("w") }, cookie: sess.cookie }));
    expect(none.status).toBe(409);
    expect(await balance("AL1")).toBe(0);
  });

  it("manual allocation over HTTP needs an admin session + CSRF, and records the admin", async () => {
    const sess = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" } })));
    const body = { userCode: "bo2", quantity: 2, reason: "Weekend push", idempotencyKey: key("http") };
    expect((await allocateApi(req("/api/admin/spins/allocate", { method: "POST", body }))).status).toBe(401);
    expect((await allocateApi(req("/api/admin/spins/allocate", { method: "POST", body, cookie: sess.cookie }))).status).toBe(403);
    const ok = await allocateApi(req("/api/admin/spins/allocate", { method: "POST", body, cookie: sess.cookie, csrf: sess.csrf }));
    expect(ok.status).toBe(200);
    const again = await allocateApi(req("/api/admin/spins/allocate", { method: "POST", body, cookie: sess.cookie, csrf: sess.csrf }));
    expect((await again.json()).replayed).toBe(true);
    expect(await balance("BO2")).toBe(2);
    expect((await pool().query(`SELECT admin_id FROM manual_spin_allocations`)).rows[0].admin_id).toBe(admin.id);
  });
});
