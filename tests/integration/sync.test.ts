import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from "vitest";
import { ingestValidatedSale, recordSaleStatus } from "@/lib/server/sales/ingest";
import { backfillSales, reconcileRecentSales } from "@/lib/server/sales/sync";
import { getSafeQuoteClient } from "@/lib/server/safequote/client";
import { POST as createRule } from "@/app/api/admin/spins/rules/route";
import { POST as login } from "@/app/api/admin/auth/login/route";
import { createAdmin, pool, req, resetDatabase, restartPool, sessionFrom, setSetting } from "./helpers";

const CUTOFF = new Date(Date.now() - 60 * 60_000); // activation one hour ago
let n = 0;
const sale = (userCode: string, minutesAgo = 5, extra: Record<string, unknown> = {}) => ({
  caseId: `CASE-${Date.now()}-${n++}`,
  userCode,
  closerName: "Ali Khan",
  state: "TX",
  carrier: "Acme",
  premium: 120,
  validatedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  ...extra,
});
const spins = async (u: string) => (await pool().query(`SELECT available FROM spin_credits WHERE user_code = $1`, [u])).rows[0]?.available ?? 0;
const salesCount = async () => (await pool().query(`SELECT COUNT(*)::int AS n FROM validated_sales`)).rows[0].n;

describe("sales sync and automatic rewards", () => {
  beforeAll(async () => {
    await resetDatabase();
  });
  beforeEach(async () => {
    await pool().query(
      `TRUNCATE spin_credit_transactions, manual_spin_allocations, automatic_spin_awards, spin_results, spin_credits, bonus_awards,
                sale_status_history, sales_events_inbox, validated_sales, agents, reward_programs, sync_checkpoints RESTART IDENTITY CASCADE`,
    );
    // Default rule (from migration 004) is 2 validated sales = 1 spin per business day; make it effective before the cutoff.
    await pool().query(`DELETE FROM target_rules WHERE id <> 'rule_global_v1'`);
    await pool().query(`UPDATE target_rules SET superseded_at = NULL, effective_from = NOW() - INTERVAL '2 days', enabled = TRUE, sales_per_spin = 2, spins_per_threshold = 1, period = 'daily' WHERE id = 'rule_global_v1'`);
    await setSetting("auto_spins_enabled", true);
    await setSetting("reward_activation_cutoff", CUTOFF.toISOString());
  });
  afterEach(() => vi.restoreAllMocks());

  it("stores a sale once, maps the agent by userCode, and keeps no raw payload", async () => {
    const s = sale(" cls-ali1 ");
    const a = await ingestValidatedSale(pool(), s, "sse");
    const b = await ingestValidatedSale(pool(), { ...s, closerName: "Ali K. Updated" }, "reconciliation");
    expect(a.status).toBe("inserted");
    expect(b.status).toBe("duplicate");
    expect(await salesCount()).toBe(1);
    const row = (await pool().query(`SELECT user_code, source, raw_payload, reward_eligible FROM validated_sales`)).rows[0];
    expect(row).toEqual({ user_code: "CLS-ALI1", source: "sse", raw_payload: {}, reward_eligible: true });
    const agent = (await pool().query(`SELECT id, name FROM agents WHERE user_code = 'CLS-ALI1'`)).rows[0];
    expect(agent).toEqual({ id: "agt_CLS-ALI1", name: "Ali K. Updated" });
  });

  it("SSE + reconciliation delivering the same sale grant rewards exactly once", async () => {
    const first = sale("CLS-ALI1", 10);
    const second = sale("CLS-ALI1", 5);
    await ingestValidatedSale(pool(), first, "sse");
    await ingestValidatedSale(pool(), { ...second, eventId: "evt-2" }, "sse");
    expect(await spins("CLS-ALI1")).toBe(1);
    // Reconciliation re-delivers both, and SSE replays its event.
    await ingestValidatedSale(pool(), first, "reconciliation");
    await ingestValidatedSale(pool(), second, "reconciliation");
    const replay = await ingestValidatedSale(pool(), { ...second, eventId: "evt-2" }, "sse");
    expect(replay.status).toBe("duplicate");
    expect(await spins("CLS-ALI1")).toBe(1);
    expect((await pool().query(`SELECT COUNT(*)::int AS n FROM automatic_spin_awards`)).rows[0].n).toBe(1);
    expect((await pool().query(`SELECT processed FROM sales_events_inbox WHERE event_id = 'evt-2'`)).rows[0].processed).toBe(true);
  });

  it("historical backfill never grants spins or bonuses — even for sales after the cutoff", async () => {
    await pool().query(
      `INSERT INTO reward_programs (id, kind, name, sales_required, amount, max_awards, headline, message, reward_line) VALUES ('prog_d', 'daily', 'Daily', 1, 1000, 10, 'h', 'm', 'r')`,
    );
    for (let i = 0; i < 6; i++) await ingestValidatedSale(pool(), sale("CLS-BOB2", 5), "backfill");
    expect(await salesCount()).toBe(6);
    expect(await spins("CLS-BOB2")).toBe(0);
    expect((await pool().query(`SELECT COUNT(*)::int AS n FROM spin_credit_transactions`)).rows[0].n).toBe(0);
    expect((await pool().query(`SELECT COUNT(*)::int AS n FROM bonus_awards`)).rows[0].n).toBe(0);
    // A later live sale counts only itself, not the backfilled ones.
    await ingestValidatedSale(pool(), sale("CLS-BOB2", 1), "sse");
    expect(await spins("CLS-BOB2")).toBe(0);
    await ingestValidatedSale(pool(), sale("CLS-BOB2", 1), "sse");
    expect(await spins("CLS-BOB2")).toBe(1);
  });

  it("no automatic rewards without a cutoff, before the cutoff, when disabled, or for ineligible agents", async () => {
    await setSetting("reward_activation_cutoff", null);
    await ingestValidatedSale(pool(), sale("A1"), "sse");
    await ingestValidatedSale(pool(), sale("A1"), "sse");
    expect(await spins("A1")).toBe(0);

    await setSetting("reward_activation_cutoff", CUTOFF.toISOString());
    await ingestValidatedSale(pool(), sale("A2", 120), "sse"); // validated before the cutoff
    await ingestValidatedSale(pool(), sale("A2", 121), "sse");
    expect(await spins("A2")).toBe(0);

    await setSetting("auto_spins_enabled", false);
    await ingestValidatedSale(pool(), sale("A3"), "sse");
    await ingestValidatedSale(pool(), sale("A3"), "sse");
    expect(await spins("A3")).toBe(0);

    await setSetting("auto_spins_enabled", true);
    await ingestValidatedSale(pool(), sale("A4"), "sse");
    await pool().query(`UPDATE agents SET spin_eligible = FALSE WHERE user_code = 'A4'`);
    await ingestValidatedSale(pool(), sale("A4"), "sse");
    expect(await spins("A4")).toBe(0);
  });

  it("concurrent sales for one agent: 10 at once with 2 per spin → exactly 5 spins", async () => {
    await Promise.all(Array.from({ length: 10 }, () => ingestValidatedSale(pool(), sale("CLS-FAST"), "sse")));
    expect(await spins("CLS-FAST")).toBe(5);
    const awards = await pool().query(`SELECT threshold_n FROM automatic_spin_awards ORDER BY threshold_n`);
    expect(awards.rows.map((r) => r.threshold_n)).toEqual([1, 2, 3, 4, 5]);
  });

  it("changing the threshold mid-period: no retroactive grants and no duplicates", async () => {
    await createAdmin();
    const s = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" } })));
    for (let i = 0; i < 3; i++) await ingestValidatedSale(pool(), sale("CLS-RULE", 3), "sse");
    expect(await spins("CLS-RULE")).toBe(1); // 3 sales at 2/spin

    // Back-dating is refused.
    const past = await createRule(
      req("/api/admin/spins/rules", { method: "POST", cookie: s.cookie, csrf: s.csrf, body: { scopeType: "global", salesPerSpin: 1, enabled: true, period: "daily", effectiveFrom: new Date(Date.now() - 3600_000).toISOString() } }),
    );
    expect(past.status).toBe(400);
    const res = await createRule(
      req("/api/admin/spins/rules", { method: "POST", cookie: s.cookie, csrf: s.csrf, body: { scopeType: "global", salesPerSpin: 1, spinsPerThreshold: 1, enabled: true, period: "daily", effectiveFrom: "now", note: "1:1 promo" } }),
    );
    expect(res.status).toBe(200);
    // The 3 earlier sales are not re-counted under the new rule.
    expect(await spins("CLS-RULE")).toBe(1);
    await new Promise((r) => setTimeout(r, 20));
    await ingestValidatedSale(pool(), { ...sale("CLS-RULE", 0), validatedAt: new Date().toISOString() }, "sse");
    expect(await spins("CLS-RULE")).toBe(2);
    const versions = await pool().query(`SELECT id, superseded_at FROM target_rules WHERE scope_type = 'global' ORDER BY effective_from`);
    expect(versions.rows).toHaveLength(2);
    expect(versions.rows[0].superseded_at).not.toBeNull();
    expect(versions.rows[1].superseded_at).toBeNull();
    expect((await pool().query(`SELECT action FROM audit_logs WHERE action = 'spins.rule_version_created'`)).rowCount).toBe(1);
  });

  it("a returned sale stops counting toward future thresholds; past grants stay in the ledger", async () => {
    const a = sale("CLS-RET");
    await ingestValidatedSale(pool(), a, "sse");
    await ingestValidatedSale(pool(), sale("CLS-RET"), "sse");
    expect(await spins("CLS-RET")).toBe(1);
    expect(await recordSaleStatus(pool(), { caseId: a.caseId, status: "returned", source: "sse", eventId: "ret-1" })).toBe("updated");
    await ingestValidatedSale(pool(), sale("CLS-RET"), "sse"); // now only 2 validated → still threshold 1
    expect(await spins("CLS-RET")).toBe(1);
    const hist = await pool().query(`SELECT status FROM sale_status_history WHERE case_id = $1 ORDER BY id`, [a.caseId]);
    expect(hist.rows.map((r) => r.status)).toEqual(["validated", "returned"]);
  });

  it("bonus programs award once per threshold, only from eligible sales", async () => {
    await pool().query(
      `INSERT INTO reward_programs (id, kind, name, sales_required, amount, max_awards, headline, message, reward_line, active_since)
       VALUES ('prog_daily', 'daily', 'Daily Bonus', 1, 1000, 2, 'h', 'm', 'r', NOW() - INTERVAL '1 day')`,
    );
    const s1 = sale("CLS-BON");
    await ingestValidatedSale(pool(), s1, "sse");
    await ingestValidatedSale(pool(), s1, "reconciliation");
    await ingestValidatedSale(pool(), sale("CLS-BON"), "sse");
    await ingestValidatedSale(pool(), sale("CLS-BON"), "sse"); // max 2 awards per day
    const awards = await pool().query(`SELECT n, amount FROM bonus_awards ORDER BY n`);
    expect(awards.rows.map((r) => [r.n, Number(r.amount)])).toEqual([[1, 1000], [2, 1000]]);
  });

  it("reconciliation stores missed sales and records an honest checkpoint (full page flagged)", async () => {
    const client = getSafeQuoteClient();
    vi.spyOn(client, "isConfigured").mockReturnValue(true);
    const page = Array.from({ length: 50 }, (_, i) => ({
      caseId: `REC-${i}`, closer: { userCode: "CLS-REC", name: "Rec Closer" }, state: "FL", carrier: "C", coverage: "", premium: 50,
      validatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    }));
    vi.spyOn(client, "getRecentSales").mockResolvedValue({ sales: page });
    vi.spyOn(client, "getSummary").mockResolvedValue({ range: { from: null, to: null }, submitted: 140, validated: 125, closeRate: 0, returned: 0, rejected: 0, activeClosers: 1, premium: { total: 0, average: 0 } });
    const r = await reconcileRecentSales(pool());
    expect(r.inserted).toBe(50); // the same 50 returned for both days → stored once
    expect(r.duplicates).toBe(50);
    expect(r.upstreamValidated).toBe(125);
    expect(r.possiblyIncompleteDays.length).toBe(2);
    const cp = (await pool().query(`SELECT status, details FROM sync_checkpoints WHERE id = 'reconciliation'`)).rows[0];
    expect(cp.status).toBe("partial");
    expect(cp.details.inserted).toBe(50);

    const b = await backfillSales(pool(), "2026-10-01", "2026-10-02");
    expect(b.inserted).toBe(0); // all already stored
    expect((await pool().query(`SELECT COUNT(*)::int AS n FROM validated_sales WHERE source = 'reconciliation'`)).rows[0].n).toBe(50);
  });

  it("data survives a service restart (new connection pool reads it back)", async () => {
    await ingestValidatedSale(pool(), sale("CLS-PERSIST"), "sse");
    await ingestValidatedSale(pool(), sale("CLS-PERSIST"), "sse");
    const before = await spins("CLS-PERSIST");
    const fresh = await restartPool();
    const after = (await fresh.query(`SELECT available FROM spin_credits WHERE user_code = 'CLS-PERSIST'`)).rows[0].available;
    expect(after).toBe(before);
    expect(after).toBe(1);
    expect((await fresh.query(`SELECT COUNT(*)::int AS n FROM validated_sales WHERE user_code = 'CLS-PERSIST'`)).rows[0].n).toBe(2);
  });
});
