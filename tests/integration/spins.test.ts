import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { allocateManualSpins, grantAutomaticSpins, SpinError } from "@/backend/spins/ledger";
import { completeSpin, executeSpin, recoverStaleSpins } from "@/backend/spins/execute";
import { ingestValidatedSale } from "@/backend/sales/ingest";
import { POST as spinApi } from "@/app/api/arena/spin/route";
import { POST as spinCompleteApi } from "@/app/api/arena/spin/complete/route";
import { POST as historicalPrizeApi } from "@/app/api/admin/spins/historical-prize/route";
import { GET as pendingApi } from "@/app/api/arena/spin/pending/route";
import { GET as winnersApi } from "@/app/api/arena/spin/recent-winners/route";
import { GET as reconcileApi, POST as reconcileApproveApi } from "@/app/api/admin/spins/reconcile/route";
import { GET as expirePreviewApi, POST as expireApproveApi } from "@/app/api/admin/spins/expire/route";
import { POST as pairApi } from "@/app/api/arena/device/pair/route";
import { POST as createDevice } from "@/app/api/admin/devices/route";
import { DELETE as revokeDevice } from "@/app/api/admin/devices/[id]/route";
import { POST as allocateApi } from "@/app/api/admin/spins/allocate/route";
import { POST as login } from "@/app/api/admin/auth/login/route";
import { deviceCookieName } from "@/backend/auth/arena-device";
import { createAdmin, createAgent, pool, req, resetDatabase, restartPool, sessionFrom } from "./helpers";

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

  it("automatic spins use raw validated sales count (not weighted credits) and expose pending/winners/reconcile APIs", async () => {
    const sess = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" } })));
    // Enable automatic spins with Nov 27, 2026 NY midnight cutoff and a 2-sales-per-spin global rule.
    await pool().query(
      `INSERT INTO admin_settings (key, value) VALUES
         ('auto_spins_enabled', 'true'::jsonb),
         ('reward_activation_cutoff', '"2026-11-27T05:00:00.000Z"'::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );
    await pool().query(
      `UPDATE target_rules
          SET sales_per_spin = 2, spins_per_threshold = 1, period = 'daily', enabled = TRUE, effective_from = '2026-11-27T05:00:00.000Z'
        WHERE scope_type = 'global' AND superseded_at IS NULL`,
    );

    // Ingest 2 Corebridge Financial sales (0.5 weighted each = 1.0 weighted, but 2 raw validated sales!).
    const s1 = await ingestValidatedSale(
      pool(),
      { caseId: "CB_1", userCode: "AL1", closerName: "Ali Khan", carrier: "Corebridge Financial", validatedAt: "2026-11-27T15:00:00.000Z" },
      "sse",
    );
    expect(s1.spinGrants).toHaveLength(0);
    const s2 = await ingestValidatedSale(
      pool(),
      { caseId: "CB_2", userCode: "AL1", closerName: "Ali Khan", carrier: "Corebridge Financial", validatedAt: "2026-11-27T16:00:00.000Z" },
      "sse",
    );
    expect(s2.spinGrants).toHaveLength(1);
    expect(await balance("AL1")).toBe(1);

    // Pre-cutoff sale (Nov 26 NY) never earns automatic spins.
    const pre = await ingestValidatedSale(
      pool(),
      { caseId: "PRE_1", userCode: "BO2", closerName: "Bo Lee", carrier: "Mutual of Omaha", validatedAt: "2026-11-27T04:30:00.000Z" },
      "sse",
    );
    expect(pre.rewardEligible).toBe(false);
    expect(pre.spinGrants).toHaveLength(0);

    // Manual allocation coexists independently with automatic balance.
    await allocateManualSpins(pool(), { userCode: "AL1", quantity: 1, reason: "Bonus", idempotencyKey: key("ind"), adminId: admin.id });
    expect(await balance("AL1")).toBe(2);

    // Pending API shows AL1 with 2 spins.
    const pendRes = await (await pendingApi(req("/api/arena/spin/pending"))).json();
    expect(pendRes.ok).toBe(true);
    expect(pendRes.pending).toEqual([expect.objectContaining({ user_code: "AL1", available: 2 })]);

    // Execute one spin → recent-winners API records it permanently, pending drops to 1.
    await addPrize("rw_cash", null, 1);
    await spinApi(req("/api/arena/spin", { method: "POST", body: { userCode: "AL1", idempotencyKey: key("sp1") }, cookie: sess.cookie }));
    const winRes = await (await winnersApi()).json();
    expect(winRes.ok).toBe(true);
    expect(winRes.winners).toHaveLength(1);
    expect(winRes.winners[0]).toMatchObject({ user_code: "AL1", reward_title: "rw_cash" });

    // Reconcile GET is read-only and reports 0 missing credits for AL1.
    const recRes = await (await reconcileApi(req("/api/admin/spins/reconcile", { cookie: sess.cookie }))).json();
    expect(recRes.ok).toBe(true);
    const alRow = recRes.report.find((r: { userCode: string }) => r.userCode === "AL1");
    expect(alRow).toMatchObject({ rawValidatedSales: 2, expectedCredits: 1, actualCredits: 1, missingCredits: 0 });
    void grantAutomaticSpins;
  });

  it("Nov 27 NY boundary: finds missing agents without spin_credits rows, approves idempotently, and expires only pre-campaign credits", async () => {
    const sess = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" } })));
    await createAgent("URW", "Urwah Malik");

    // Simulate production bug state: shared reward_activation_cutoff is Nov 27 10:53 PM PKT (17:53Z),
    // rule effective_from is Nov 28 1:41 AM PKT (20:41Z), and spin_campaign_start_at is Nov 27 00:00 NY (05:00Z).
    await pool().query(
      `INSERT INTO admin_settings (key, value) VALUES
         ('auto_spins_enabled', 'true'::jsonb),
         ('reward_activation_cutoff', '"2026-11-27T17:53:00.000Z"'::jsonb),
         ('spin_campaign_start_at', '"2026-11-27T05:00:00.000Z"'::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );
    await pool().query(
      `UPDATE target_rules
          SET sales_per_spin = 2, spins_per_threshold = 1, period = 'daily', enabled = TRUE, effective_from = '2026-11-27T20:41:00.000Z'
        WHERE scope_type = 'global' AND superseded_at IS NULL`,
    );

    // Insert 2 Nov 27 NY sales for URW (before 17:53Z, so reward_eligible = FALSE, and URW has NO spin_credits row)
    // plus 1 pre-Nov-27 sale (04:30Z = Nov 26 23:30 EST) that must NOT count.
    await pool().query(
      `INSERT INTO validated_sales (id, case_id, user_code, agent_id, carrier, validated_at, source, reward_eligible, closer_name, status) VALUES
         ('s_urw_pre', 'C_URW_PRE', 'URW', 'agt_URW', 'Aetna', '2026-11-27T04:30:00.000Z', 'sse', FALSE, 'Urwah Malik', 'validated'),
         ('s_urw_1',   'C_URW_1',   'URW', 'agt_URW', 'Aetna', '2026-11-27T13:00:00.000Z', 'sse', FALSE, 'Urwah Malik', 'validated'),
         ('s_urw_2',   'C_URW_2',   'URW', 'agt_URW', 'Corebridge Financial', '2026-11-27T14:00:00.000Z', 'sse', FALSE, 'Urwah Malik', 'validated')`,
    );

    // Reconcile GET must find URW with 2 raw Nov 27 NY sales, 1 expected, 0 granted, 1 missing.
    const rec = await (await reconcileApi(req("/api/admin/spins/reconcile?from=2026-11-27", { cookie: sess.cookie }))).json();
    expect(rec.ok).toBe(true);
    const urw = rec.report.find((r: { userCode: string }) => r.userCode === "URW");
    expect(urw).toMatchObject({
      rawValidatedSales: 2,
      expectedAutoSpins: 1,
      grantedAutoSpins: 0,
      missingSpins: 1,
      status: "missing",
    });

    // Single-agent approval grants 1 spin; concurrent/repeated approval never duplicates.
    const [a1, a2] = await Promise.all([
      reconcileApproveApi(req("/api/admin/spins/reconcile", { method: "POST", cookie: sess.cookie, csrf: sess.csrf, body: { dryRun: false, agentIds: ["URW"], periodKey: "D:2026-11-27" } })),
      reconcileApproveApi(req("/api/admin/spins/reconcile", { method: "POST", cookie: sess.cookie, csrf: sess.csrf, body: { dryRun: false, agentIds: ["URW"], periodKey: "D:2026-11-27" } })),
    ]);
    expect(a1.status).toBe(200);
    expect(a2.status).toBe(200);
    expect(await balance("URW")).toBe(1);

    // Pre-campaign historical credit expiration: AL1 gets 2 pre-Nov-27 manual credits + 1 Nov-27+ manual credit.
    await allocateManualSpins(pool(), { userCode: "AL1", quantity: 2, reason: "Old contest", idempotencyKey: key("old"), adminId: admin.id });
    await pool().query(`UPDATE spin_credit_transactions SET created_at = '2026-11-20T12:00:00.000Z' WHERE user_code = 'AL1'`);
    await allocateManualSpins(pool(), { userCode: "AL1", quantity: 1, reason: "Nov 27 contest", idempotencyKey: key("new"), adminId: admin.id });
    expect(await balance("AL1")).toBe(3);

    const dry = await (await expirePreviewApi(req("/api/admin/spins/expire", { cookie: sess.cookie }))).json();
    const alExp = dry.rows.find((r: { userCode: string }) => r.userCode === "AL1");
    expect(alExp).toMatchObject({ available: 3, protectedNov27Credits: 1, expirableCredits: 2 });

    // Approved expiration expires only the 2 pre-campaign credits and is idempotent on repeat.
    const exp1 = await (await expireApproveApi(req("/api/admin/spins/expire", { method: "POST", cookie: sess.cookie, csrf: sess.csrf, body: { dryRun: false, userCodes: ["AL1"] } }))).json();
    expect(exp1.expired[0]).toMatchObject({ userCode: "AL1", expiredCount: 2, balanceAfter: 1, replayed: false });
    const exp2 = await (await expireApproveApi(req("/api/admin/spins/expire", { method: "POST", cookie: sess.cookie, csrf: sess.csrf, body: { dryRun: false, userCodes: ["AL1"] } }))).json();
    expect(exp2.expired).toHaveLength(0);
    expect(await balance("AL1")).toBe(1);
  });

  it("fresh_campaign_reset zeroes all old available credits, leaves non-spin tables intact, is idempotent, and enables clean Nov 27 post-reset grants", async () => {
    const sess = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" } })));
    await createAgent("HAM", "Hamna Nasir");
    await createAgent("URW2", "Urwah Malik");

    // Seed old balances (6 manual + 1 auto = 7 total available) + 1 completed spin_result + 1 cash reward_program + shared cutoff.
    await pool().query(
      `INSERT INTO admin_settings (key, value) VALUES
         ('auto_spins_enabled', 'true'::jsonb),
         ('reward_activation_cutoff', '"2026-11-27T17:53:00.000Z"'::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );
    await addPrize("rw_keep", null, 1);
    await allocateManualSpins(pool(), { userCode: "HAM", quantity: 4, reason: "Legacy manual", idempotencyKey: key("ham_old"), adminId: admin.id });
    await allocateManualSpins(pool(), { userCode: "AL1", quantity: 3, reason: "Legacy manual", idempotencyKey: key("al1_old"), adminId: admin.id });
    // Consume 1 on AL1 so there is a completed spin_results row to preserve, plus 1 admin_demo_historical_result and 1 cash bonus_awards row.
    await executeSpin(pool(), { userCode: "AL1", idempotencyKey: key("al1_spin"), actor: "test" });
    await historicalPrizeApi(req("/api/admin/spins/historical-prize", { method: "POST", cookie: sess.cookie, csrf: sess.csrf, body: { userCode: "HAM", prizeTitle: "KFC" } }));
    await pool().query(
      `INSERT INTO reward_programs (id, kind, name, enabled, sales_required, reward_type, amount, currency, headline, message, reward_line)
       VALUES ('prog_cash_keep', 'daily', 'Daily SPIF', TRUE, 2, 'cash', 3000, 'Rs.', 'SPIF!', 'Great!', 'Rs. 3,000')
       ON CONFLICT (id) DO NOTHING`,
    );
    await pool().query(
      `INSERT INTO bonus_awards (id, program_id, kind, user_code, agent_id, agent_name, period_key, n, sales_required, validated_at_award, amount, increment_amount, payable_amount, prize_label, program_name, status)
       VALUES ('aw_keep_1', 'prog_cash_keep', 'daily', 'HAM', 'agt_HAM', 'Hamna Nasir', 'D:2026-11-26', 1, 2, 2, 3000, 3000, 3000, 'Rs. 3,000', 'Daily SPIF', 'paid')
       ON CONFLICT (id) DO NOTHING`,
    );

    // Seed Nov 27 NY sales for HAM (2) and URW2 (2).
    await pool().query(
      `INSERT INTO validated_sales (id, case_id, user_code, agent_id, carrier, validated_at, source, reward_eligible, closer_name, status) VALUES
         ('s_fr_ham_1', 'C_FR_HAM_1', 'HAM', 'agt_HAM', 'Aetna', '2026-11-27T14:00:00.000Z', 'sse', FALSE, 'Hamna Nasir', 'validated'),
         ('s_fr_ham_2', 'C_FR_HAM_2', 'HAM', 'agt_HAM', 'Corebridge Financial', '2026-11-27T15:00:00.000Z', 'sse', FALSE, 'Hamna Nasir', 'validated'),
         ('s_fr_urw_1', 'C_FR_URW_1', 'URW2', 'agt_URW2', 'Aetna', '2026-11-27T16:00:00.000Z', 'sse', FALSE, 'Urwah Malik', 'validated'),
         ('s_fr_urw_2', 'C_FR_URW_2', 'URW2', 'agt_URW2', 'Aetna', '2026-11-27T17:00:00.000Z', 'sse', FALSE, 'Urwah Malik', 'validated')`,
    );

    const salesCountBefore = (await pool().query(`SELECT COUNT(*)::int AS n FROM validated_sales`)).rows[0].n;
    const spinResultsBefore = (await pool().query(`SELECT COUNT(*)::int AS n FROM spin_results`)).rows[0].n;
    const cutoffBefore = (await pool().query(`SELECT value FROM admin_settings WHERE key = 'reward_activation_cutoff'`)).rows[0].value;

    // Execute one-time fresh campaign reset.
    const r1 = await (
      await expireApproveApi(
        req("/api/admin/spins/expire", {
          method: "POST",
          cookie: sess.cookie,
          csrf: sess.csrf,
          body: { dryRun: false, mode: "fresh_campaign_reset", resetMarker: "nov27_fresh_reset_v1" },
        }),
      )
    ).json();
    expect(r1.ok).toBe(true);
    expect(r1.alreadyExecuted).toBe(false);
    expect(await balance("HAM")).toBe(0);
    expect(await balance("AL1")).toBe(0);

    // Repeat execution is strictly idempotent.
    const r2 = await (
      await expireApproveApi(
        req("/api/admin/spins/expire", {
          method: "POST",
          cookie: sess.cookie,
          csrf: sess.csrf,
          body: { dryRun: false, mode: "fresh_campaign_reset", resetMarker: "nov27_fresh_reset_v1" },
        }),
      )
    ).json();
    expect(r2.alreadyExecuted).toBe(true);

    // Non-spin tables, completed spin_results (including admin_demo_historical_result), cash bonus_awards, and shared reward_activation_cutoff are untouched.
    expect((await pool().query(`SELECT COUNT(*)::int AS n FROM validated_sales`)).rows[0].n).toBe(salesCountBefore);
    expect((await pool().query(`SELECT COUNT(*)::int AS n FROM spin_results`)).rows[0].n).toBe(spinResultsBefore);
    expect((await pool().query(`SELECT COUNT(*)::int AS n FROM spin_results WHERE mode = 'admin_demo_historical_result' AND reward_title = 'KFC'`)).rows[0].n).toBe(1);
    expect((await pool().query(`SELECT status, amount::int AS amount FROM bonus_awards WHERE id = 'aw_keep_1'`)).rows[0]).toEqual({ status: "paid", amount: 3000 });
    expect((await pool().query(`SELECT value FROM admin_settings WHERE key = 'reward_activation_cutoff'`)).rows[0].value).toBe(cutoffBefore);

    // Find Missing Spins finds HAM (1 missing) and URW2 (1 missing) post-reset.
    const rec = await (await reconcileApi(req("/api/admin/spins/reconcile?from=2026-11-27", { cookie: sess.cookie }))).json();
    expect(rec.report.find((r: { userCode: string }) => r.userCode === "HAM")).toMatchObject({ rawValidatedSales: 2, missingSpins: 1 });
    expect(rec.report.find((r: { userCode: string }) => r.userCode === "URW2")).toMatchObject({ rawValidatedSales: 2, missingSpins: 1 });

    // Approve HAM & URW2 post-reset → each has exactly 1 spin; AL1 remains at 0.
    await reconcileApproveApi(req("/api/admin/spins/reconcile", { method: "POST", cookie: sess.cookie, csrf: sess.csrf, body: { dryRun: false, agentIds: ["HAM", "URW2"], periodKey: "D:2026-11-27" } }));
    expect(await balance("HAM")).toBe(1);
    expect(await balance("URW2")).toBe(1);
    expect(await balance("AL1")).toBe(0);
  });

  it("2-phase claim & recovery: claimOnly creates in-progress spin, prevents 2nd claim, completes idempotently; historical-prize records without credits", async () => {
    const sess = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" } })));
    await addPrize("rw_one", null, 1);
    await allocateManualSpins(pool(), { userCode: "AL1", quantity: 1, reason: "2-phase", idempotencyKey: key("2p"), adminId: admin.id });

    // Two simultaneous claimOnly requests for 1 credit → 1 succeeds, 1 gets 409 insufficient_credits.
    const [c1, c2] = await Promise.all([
      spinApi(req("/api/arena/spin", { method: "POST", cookie: sess.cookie, body: { userCode: "AL1", idempotencyKey: key("c1"), claimOnly: true } })),
      spinApi(req("/api/arena/spin", { method: "POST", cookie: sess.cookie, body: { userCode: "AL1", idempotencyKey: key("c2"), claimOnly: true } })),
    ]);
    const statuses = [c1.status, c2.status].sort();
    expect(statuses).toEqual([200, 409]);
    const okClaim = c1.status === 200 ? await c1.json() : await c2.json();
    expect(await balance("AL1")).toBe(0);

    // Pending API lists the in-progress spin for other TVs.
    const pend = await (await pendingApi(req("/api/arena/spin/pending"))).json();
    expect(pend.inProgress).toEqual([expect.objectContaining({ spin_id: okClaim.spinId, user_code: "AL1" })]);

    // Interrupted spin recovery: completing twice is idempotent and yields 1 completed spin_results row.
    const fin1 = await (await spinCompleteApi(req("/api/arena/spin/complete", { method: "POST", cookie: sess.cookie, body: { spinId: okClaim.spinId } }))).json();
    const fin2 = await completeSpin(pool(), { spinId: okClaim.spinId });
    expect(fin1).toMatchObject({ ok: true, replayed: false, spinId: okClaim.spinId });
    expect(fin2).toMatchObject({ replayed: true, spinId: okClaim.spinId });
    expect((await pool().query(`SELECT COUNT(*)::int AS n FROM spin_results WHERE status = 'completed'`)).rows[0].n).toBe(1);

    // Historical admin-recorded prize (e.g. Hamna Nasir — KFC) stores mode='admin-historical', zero credit impact, idempotent.
    const hp1 = await (await historicalPrizeApi(req("/api/admin/spins/historical-prize", { method: "POST", cookie: sess.cookie, csrf: sess.csrf, body: { userCode: "BO2", prizeTitle: "KFC" } }))).json();
    const hp2 = await (await historicalPrizeApi(req("/api/admin/spins/historical-prize", { method: "POST", cookie: sess.cookie, csrf: sess.csrf, body: { userCode: "BO2", prizeTitle: "KFC" } }))).json();
    expect(hp1).toMatchObject({ ok: true, replayed: false });
    expect(hp2).toMatchObject({ ok: true, replayed: true, spinId: hp1.spinId });
    expect(await balance("BO2")).toBe(0);
    expect((await pool().query(`SELECT mode, reward_title FROM spin_results WHERE id = $1`, [hp1.spinId])).rows[0]).toEqual({
      mode: "admin_demo_historical_result",
      reward_title: "KFC",
    });

    // Simulate browser crash + application restart leaving an in-progress spin older than 90s:
    await allocateManualSpins(pool(), { userCode: "BO2", quantity: 1, reason: "Crash recovery test", idempotencyKey: key("cr"), adminId: admin.id });
    const crashed = await executeSpin(pool(), { userCode: "BO2", idempotencyKey: key("crash1"), actor: "device:tv1", claimOnly: true });
    await pool().query(`UPDATE spin_results SET created_at = NOW() - INTERVAL '2 minutes' WHERE id = $1`, [crashed.spinId]);
    await restartPool(); // simulate application restart
    const recovered = await recoverStaleSpins(pool(), 90);
    expect(recovered).toEqual([expect.objectContaining({ spinId: crashed.spinId, userCode: "BO2", availableLeft: 0 })]);
    expect((await pool().query(`SELECT status FROM spin_results WHERE id = $1`, [crashed.spinId])).rows[0].status).toBe("completed");
    // Calling recoverStaleSpins again is a no-op (never duplicates).
    expect(await recoverStaleSpins(pool(), 90)).toEqual([]);
  });
});
