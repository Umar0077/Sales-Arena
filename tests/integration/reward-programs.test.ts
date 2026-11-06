import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { ingestValidatedSale } from "@/backend/sales/ingest";
import { POST as createProgramRoute, GET as listProgramsRoute } from "@/app/api/admin/programs/route";
import { PATCH as patchProgram, DELETE as deleteProgram } from "@/app/api/admin/programs/[id]/route";
import { GET as listAwardsRoute } from "@/app/api/admin/awards/route";
import { PATCH as patchAward } from "@/app/api/admin/awards/[id]/route";
import { PUT as putConfig } from "@/app/api/admin/arena-config/route";
import { POST as switchScreen } from "@/app/api/admin/arena-config/screen/route";
import { GET as publicConfig } from "@/app/api/arena/config/route";
import { GET as publicPrograms } from "@/app/api/arena/programs/route";
import { GET as publicAwards } from "@/app/api/arena/awards/route";
import { POST as allocate } from "@/app/api/admin/spins/allocate/route";
import { POST as login } from "@/app/api/admin/auth/login/route";
import { arenaBroadcaster, type ArenaBroadcastEvent } from "@/backend/events/broadcaster";
import { createAdmin, pool, req, resetDatabase, restartPool, sessionFrom, setSetting } from "./helpers";
import { vi } from "vitest";

const CUTOFF = new Date(Date.now() - 6 * 60 * 60_000);
let seq = 0;
let sess: { cookie: string; csrf: string };
let events: ArenaBroadcastEvent[] = [];
let off = () => {};

const sale = (userCode: string, at: Date | number = 5, name = "Hamna Nasir") => ({
  caseId: `CASE-RP-${Date.now()}-${seq++}`,
  userCode,
  closerName: name,
  premium: 100,
  validatedAt: (typeof at === "number" ? new Date(Date.now() - at * 60_000) : at).toISOString(),
});
const program = async (body: Record<string, unknown>) => {
  const res = await createProgramRoute(req("/api/admin/programs", { method: "POST", body: { enabled: true, ...body }, cookie: sess.cookie, csrf: sess.csrf }));
  const j = await res.json();
  expect(res.status, j.error).toBe(201);
  return j.program as { id: string; name: string; revision: number; activeSince: string | null };
};
const patch = async (id: string, body: Record<string, unknown>) =>
  patchProgram(req(`/api/admin/programs/${id}`, { method: "PATCH", body, cookie: sess.cookie, csrf: sess.csrf }), { params: Promise.resolve({ id }) });
const config = async (values: Record<string, unknown>) => putConfig(req("/api/admin/arena-config", { method: "PUT", body: { values }, cookie: sess.cookie, csrf: sess.csrf }));
const awards = async (where = "") => (await pool().query(`SELECT * FROM bonus_awards ${where} ORDER BY created_at, id`)).rows;
const awardEvents = () => events.filter((e) => e.type === "rewards.award.created");

describe("reward programs, automated awards and global settings (PostgreSQL)", () => {
  beforeAll(async () => {
    await resetDatabase();
    await createAdmin();
    sess = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" } })));
  });
  beforeEach(async () => {
    await pool().query(
      `TRUNCATE reward_program_history, bonus_awards, spin_credit_transactions, manual_spin_allocations, automatic_spin_awards, spin_results,
                spin_credits, sale_status_history, sales_events_inbox, validated_sales, agents, reward_programs RESTART IDENTITY CASCADE`,
    );
    await pool().query(`DELETE FROM admin_settings WHERE key IN ('arena.config', 'arena.screen.current')`);
    await setSetting("auto_spins_enabled", false); // these tests are about bonus programs, not spins
    await setSetting("reward_activation_cutoff", CUTOFF.toISOString());
    await config({ businessTimezone: "UTC", weekStartDay: 1 });
    // Programs created in a test count sales from their activation; backdate so test sales made "minutes ago" count.
    events = [];
    off = arenaBroadcaster.subscribe((e) => events.push(e));
  });
  afterEach(() => {
    off();
    vi.restoreAllMocks();
  });
  const backdate = async (id: string) => pool().query(`UPDATE reward_programs SET active_since = NOW() - INTERVAL '5 hours' WHERE id = $1`, [id]);

  it("Scenario B: 2 validated sales = Rs. 3,000 → exactly one award, one event, persisted history", async () => {
    const p = await program({ kind: "daily", name: "Daily Double Sale Bonus", rewardType: "cash", amount: 3000, currency: "Rs.", salesRequired: 2, maxAwards: 1 });
    await backdate(p.id);
    const s1 = sale("HN01", 30);
    await ingestValidatedSale(pool(), s1, "sse");
    expect(await awards()).toHaveLength(0);
    const s2 = sale("HN01", 10);
    await ingestValidatedSale(pool(), s2, "sse");
    // Same sales again (SSE replay + reconciliation overlap) never award twice.
    await ingestValidatedSale(pool(), s2, "reconciliation");
    await ingestValidatedSale(pool(), { ...s1, eventId: "evt-x" }, "sse");
    const rows = await awards();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ program_id: p.id, user_code: "HN01", agent_name: "Hamna Nasir", amount: "3000.00", status: "earned", reward_type: "cash", validated_at_award: 2, announce: true, trigger_case_id: s2.caseId });
    expect(rows[0].reward_snapshot).toMatchObject({ name: "Daily Double Sale Bonus", amount: 3000, salesRequired: 2 });
    expect(awardEvents()).toHaveLength(1);
    expect((awardEvents()[0].payload as { award: Record<string, unknown> }).award).toMatchObject({ agentName: "Hamna Nasir", amount: 3000, currency: "Rs.", validatedAtAward: 2, kind: "daily", announce: true });
    // Admin Award History (PostgreSQL) shows it; the public feed shows it without customer data.
    const hist = await (await listAwardsRoute(req("/api/admin/awards", { cookie: sess.cookie }))).json();
    expect(hist.awards).toHaveLength(1);
    expect(hist.totals).toMatchObject({ count: 1, cash: 3000, paid: 0, outstanding: 3000 });
    const pub = await (await publicAwards(req("/api/arena/awards"))).json();
    expect(pub.awards[0]).toMatchObject({ agentName: "Hamna Nasir", amount: 3000 });
    expect(JSON.stringify(pub)).not.toContain(s2.caseId);
  });

  it("Scenario C: three daily programs with different thresholds each award once; non-stackable keeps only the top tier", async () => {
    const a = await program({ kind: "daily", name: "One", rewardType: "cash", amount: 500, salesRequired: 1 });
    const b = await program({ kind: "daily", name: "Three", rewardType: "physical", prizeLabel: "Premium Headset", salesRequired: 3 });
    const c = await program({ kind: "daily", name: "Ten", rewardType: "cash", amount: 10000, salesRequired: 10, enabled: false });
    for (const p of [a, b, c]) await backdate(p.id);
    for (let i = 0; i < 4; i++) await ingestValidatedSale(pool(), sale("AK22", 40 - i), "sse");
    const rows = await awards();
    expect(rows.map((r) => [r.program_name, r.n])).toEqual([["One", 1], ["Three", 1]]); // "Ten" is inactive
    expect(rows[1]).toMatchObject({ reward_type: "physical", prize_label: "Premium Headset", amount: "0.00" });

    // Non-stackable: two tiers that unlock on the same sale → only the higher threshold.
    const x = await program({ kind: "daily", name: "NS-2", rewardType: "cash", amount: 100, salesRequired: 2, stackable: false });
    const y = await program({ kind: "daily", name: "NS-4", rewardType: "cash", amount: 400, salesRequired: 4, stackable: false });
    for (const p of [x, y]) await backdate(p.id);
    await ingestValidatedSale(pool(), sale("ZZ99", 20), "sse");
    await ingestValidatedSale(pool(), sale("ZZ99", 19), "sse"); // 2 sales: NS-2 unlocks, but "One" was already earned → non-stackable blocked
    expect((await awards(`WHERE user_code = 'ZZ99'`)).map((r) => r.program_name)).toEqual(["One"]);
  });

  it("Scenario D: weekly and monthly use business periods and keep separate records", async () => {
    await config({ businessTimezone: "UTC", weekStartDay: 1 });
    const w = await program({ kind: "weekly", name: "Weekly 2", rewardType: "voucher", prizeLabel: "Gift Voucher", salesRequired: 2 });
    const m = await program({ kind: "monthly", name: "Monthly 2", rewardType: "cash", amount: 10000, salesRequired: 2 });
    await pool().query(`UPDATE reward_programs SET active_since = '2020-01-01' WHERE id = ANY($1)`, [[w.id, m.id]]);
    await setSetting("reward_activation_cutoff", "2020-01-01T00:00:00Z");
    // Sun 2026-05-31 (week of Mon 25 May) and Mon 2026-06-01 (new week AND new month).
    await ingestValidatedSale(pool(), sale("WK1", new Date("2026-05-30T10:00:00Z")), "sse");
    await ingestValidatedSale(pool(), sale("WK1", new Date("2026-05-31T23:30:00Z")), "sse");
    await ingestValidatedSale(pool(), sale("WK1", new Date("2026-06-01T00:30:00Z")), "sse");
    const rows = await awards();
    expect(rows.map((r) => [r.kind, r.period_key]).sort()).toEqual([["monthly", "M:2026-05"], ["weekly", "W:2026-05-25"]]);
    await setSetting("reward_activation_cutoff", CUTOFF.toISOString());
  });

  it("Scenario E: hiding announcements still earns awards (no popup); a paused category or program earns nothing new", async () => {
    const p = await program({ kind: "daily", name: "Daily One", rewardType: "cash", amount: 1000, salesRequired: 1, maxAwards: 10, tierPolicy: "additive" }); // repeat awards per day = an additive program
    await backdate(p.id);
    await config({ rewardCategories: { daily: { active: true, showOnArena: false }, weekly: { active: true, showOnArena: true }, monthly: { active: true, showOnArena: true } } });
    await ingestValidatedSale(pool(), sale("EV1", 50), "sse");
    expect(await awards()).toHaveLength(1);
    expect((await awards())[0].announce).toBe(false);
    expect((awardEvents()[0].payload as { award: { announce: boolean } }).award.announce).toBe(false);
    expect((await (await publicAwards(req("/api/arena/awards"))).json()).awards).toHaveLength(0); // hidden publicly
    expect((await (await publicPrograms()).json()).programs).toHaveLength(0);

    await config({ rewardCategories: { daily: { active: false, showOnArena: true }, weekly: { active: true, showOnArena: true }, monthly: { active: true, showOnArena: true } } });
    await ingestValidatedSale(pool(), sale("EV1", 40), "sse");
    expect(await awards()).toHaveLength(1); // category inactive → nothing new, old award kept

    await config({ rewardCategories: { daily: { active: true, showOnArena: true }, weekly: { active: true, showOnArena: true }, monthly: { active: true, showOnArena: true } } });
    expect((await patch(p.id, { enabled: false })).status).toBe(200);
    await ingestValidatedSale(pool(), sale("EV1", 30), "sse");
    expect(await awards()).toHaveLength(1); // program paused
    // Re-activated: only sales validated from now on count (the paused-period sales never do).
    expect((await patch(p.id, { enabled: true })).status).toBe(200);
    await ingestValidatedSale(pool(), sale("EV1", 20), "sse");
    expect(await awards()).toHaveLength(1);
    await ingestValidatedSale(pool(), sale("EV1", -0.05), "sse"); // validated just after re-activation
    expect(await awards()).toHaveLength(2);
  });

  it("concurrent sales for one agent: the threshold-2 award is created exactly once and never lost", async () => {
    const p = await program({ kind: "daily", name: "Pair", rewardType: "cash", amount: 3000, salesRequired: 2, maxAwards: 5, tierPolicy: "additive" });
    await backdate(p.id);
    await Promise.all(Array.from({ length: 6 }, (_, i) => ingestValidatedSale(pool(), sale("CC1", 30 - i), "sse")));
    expect((await awards()).map((r) => r.n).sort()).toEqual([1, 2, 3]);
    expect(awardEvents()).toHaveLength(3);
  });

  it("Scenario J: historical backfill never awards cash bonuses retroactively", async () => {
    const p = await program({ kind: "daily", name: "Any", rewardType: "cash", amount: 1000, salesRequired: 1, maxAwards: 50 });
    await backdate(p.id);
    const rows = Array.from({ length: 3 }, (_, i) => ({ caseId: `BF-${i}-${Date.now()}`, userCode: "BF1", closerName: "Back Fill", validatedAt: new Date(Date.now() - (20 - i) * 60_000).toISOString(), premium: 1 }));
    for (const r of rows) await ingestValidatedSale(pool(), r, "backfill");
    expect(await awards()).toHaveLength(0);
  });

  it("program lifecycle: create never touches other programs; edits keep past awards; archive instead of delete", async () => {
    const a = await program({ kind: "monthly", name: "M-30", rewardType: "cash", amount: 10000, salesRequired: 1 });
    const b = await program({ kind: "monthly", name: "M-50", rewardType: "custom", prizeLabel: "Merch pack", salesRequired: 50 });
    await backdate(a.id);
    await ingestValidatedSale(pool(), sale("LC1", 30), "sse");
    expect((await patch(a.id, { amount: 25000, name: "M-30 renamed" })).status).toBe(200);
    const award = (await awards())[0];
    expect(award).toMatchObject({ amount: "10000.00", program_name: "M-30", program_revision: 1 }); // never regenerated
    const del = await deleteProgram(req(`/api/admin/programs/${a.id}`, { method: "DELETE", cookie: sess.cookie, csrf: sess.csrf }), { params: Promise.resolve({ id: a.id }) });
    expect((await del.json()).program.status).toBe("archived");
    expect(await awards()).toHaveLength(1); // award kept
    await expect(pool().query(`DELETE FROM reward_programs WHERE id = $1`, [a.id])).rejects.toThrow(); // FK RESTRICT protects history
    const list = await (await listProgramsRoute(req("/api/admin/programs?archived=1", { cookie: sess.cookie }))).json();
    expect(list.programs.map((p: { name: string; status: string }) => [p.name, p.status])).toEqual([["M-30 renamed", "archived"], ["M-50", "active"]]);
    const hist = (await pool().query(`SELECT action FROM reward_program_history WHERE program_id = $1 ORDER BY revision`, [a.id])).rows.map((r) => r.action);
    expect(hist).toEqual(["created", "edited", "archived"]);
    expect((await patch(a.id, { amount: 1 })).status).toBe(409); // archived programs can't be edited
    expect(b.id).not.toBe(a.id);
    const audits = (await pool().query(`SELECT action FROM audit_logs WHERE target_id = $1 ORDER BY id`, [a.id])).rows.map((r) => r.action);
    expect(audits).toEqual(["reward_program.created", "reward_program.edited", "reward_program.archived"]);
  });

  it("rejects invalid programs with clear messages", async () => {
    const bad = async (body: Record<string, unknown>) =>
      (await createProgramRoute(req("/api/admin/programs", { method: "POST", body, cookie: sess.cookie, csrf: sess.csrf }))).json();
    expect((await bad({ kind: "daily", name: "x", rewardType: "cash", amount: 0, salesRequired: 2 })).error).toMatch(/cash bonus amount/i);
    expect((await bad({ kind: "daily", name: "x", rewardType: "physical", salesRequired: 2 })).error).toMatch(/prize/i);
    expect((await bad({ kind: "yearly", name: "x", rewardType: "cash", amount: 5, salesRequired: 2 })).error).toMatch(/Daily, Weekly or Monthly/);
    expect((await bad({ kind: "daily", name: "x", rewardType: "cash", amount: 5, salesRequired: 0 })).error).toMatch(/sales required/i);
    expect((await bad({ kind: "daily", name: "x", rewardType: "cash", amount: 5, salesRequired: 2, startDate: "2026-02-10", endDate: "2026-02-01" })).error).toMatch(/End date/);
  });

  it("award workflow: earned ≠ paid; transitions are validated and audited", async () => {
    const p = await program({ kind: "daily", name: "Pay", rewardType: "cash", amount: 3000, salesRequired: 1 });
    await backdate(p.id);
    await ingestValidatedSale(pool(), sale("PY1", 10), "sse");
    const id = (await awards())[0].id as string;
    const set = (status: string, note?: string) =>
      patchAward(req(`/api/admin/awards/${id}`, { method: "PATCH", body: { status, note }, cookie: sess.cookie, csrf: sess.csrf }), { params: Promise.resolve({ id: encodeURIComponent(id) }) });
    expect((await set("paid")).status).toBe(409); // must be approved first
    expect((await set("approved")).status).toBe(200);
    expect((await set("cancelled")).status).toBe(400); // reason required
    expect((await set("paid")).status).toBe(200);
    expect((await set("reversed", "Duplicate payout")).status).toBe(200);
    expect((await awards())[0]).toMatchObject({ status: "reversed", status_note: "Duplicate payout" });
    const audit = (await pool().query(`SELECT details FROM audit_logs WHERE action = 'bonus_award.status' ORDER BY id`)).rows.map((r) => [r.details.from, r.details.to]);
    expect(audit).toEqual([["earned", "approved"], ["approved", "paid"], ["paid", "reversed"]]);
  });

  it("global config: validated, revisioned, audited, broadcast, and readable by every display", async () => {
    const r1 = await (await config({ arenaModes: { daily: true, weekly: false, monthly: true, spin: true }, showModeSelector: false })).json();
    expect(r1.values).toMatchObject({ arenaModes: { weekly: false }, showModeSelector: false });
    expect(events.filter((e) => e.type === "arena.screens.updated").at(-1)?.payload).toEqual({ revision: r1.revision, scope: "config" });
    expect((await config({ defaultArenaMode: "weekly" })).status).toBe(400); // disabled screen can't be default
    expect((await config({ nope: true })).status).toBe(400);
    expect((await config({ leaderboardCount: 999 })).status).toBe(400);
    expect((await config({ businessTimezone: "Mars/Base" })).status).toBe(400);
    expect((await switchScreen(req("/api/admin/arena-config/screen", { method: "POST", body: { screen: "weekly" }, cookie: sess.cookie, csrf: sess.csrf }))).status).toBe(400);
    const sw = await (await switchScreen(req("/api/admin/arena-config/screen", { method: "POST", body: { screen: "monthly" }, cookie: sess.cookie, csrf: sess.csrf }))).json();
    expect(events.at(-1)).toMatchObject({ type: "arena.screen.changed", payload: { screen: "monthly", revision: sw.screen.revision } });
    const pub = await (await publicConfig()).json();
    expect(pub).toMatchObject({ ok: true, revision: r1.revision, values: { showModeSelector: false }, screen: { screen: "monthly" } });
    const audit = (await pool().query(`SELECT details FROM audit_logs WHERE action = 'settings.arena_config' ORDER BY id DESC LIMIT 1`)).rows[0].details;
    expect(audit.changed.showModeSelector).toEqual({ from: true, to: false });
  });

  it("Scenario H: settings, programs and awards survive an application restart", async () => {
    const p = await program({ kind: "weekly", name: "Persist", rewardType: "cash", amount: 5000, salesRequired: 1 });
    await backdate(p.id);
    await config({ arenaEnabled: false, arenaOfflineMessage: "Back at 9" });
    await ingestValidatedSale(pool(), sale("RS1", 10), "sse");
    expect((await awards())[0].announce).toBe(false); // Live Arena off → recorded, not announced
    await restartPool();
    expect((await (await publicConfig()).json()).values).toMatchObject({ arenaEnabled: false, arenaOfflineMessage: "Back at 9" });
    expect((await (await listProgramsRoute(req("/api/admin/programs", { cookie: sess.cookie }))).json()).programs[0].name).toBe("Persist");
    expect(await awards()).toHaveLength(1);
  });

  it("Scenario I: without a signed-in admin + CSRF nothing can be created, changed or allocated", async () => {
    const anon = { cookie: undefined, csrf: undefined };
    const noCsrf = { cookie: sess.cookie, csrf: undefined };
    for (const s of [anon, noCsrf]) {
      const expected = s === anon ? 401 : 403;
      expect((await createProgramRoute(req("/api/admin/programs", { method: "POST", body: { kind: "daily", name: "x", rewardType: "cash", amount: 1, salesRequired: 1 }, ...s }))).status).toBe(expected);
      expect((await putConfig(req("/api/admin/arena-config", { method: "PUT", body: { values: { arenaEnabled: false } }, ...s }))).status).toBe(expected);
      expect((await switchScreen(req("/api/admin/arena-config/screen", { method: "POST", body: { screen: "daily" }, ...s }))).status).toBe(expected);
      expect((await allocate(req("/api/admin/spins/allocate", { method: "POST", body: { userCode: "X1", quantity: 1, reason: "x", idempotencyKey: `k-${expected}` }, ...s }))).status).toBe(expected);
      expect((await patchAward(req("/api/admin/awards/x", { method: "PATCH", body: { status: "paid" }, ...s }), { params: Promise.resolve({ id: "x" }) })).status).toBe(expected);
    }
    expect((await listAwardsRoute(req("/api/admin/awards"))).status).toBe(401);
    expect(await pool().query(`SELECT 1 FROM reward_programs`).then((r) => r.rowCount)).toBe(0);
  });
});
