import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { ingestValidatedSale } from "@/backend/sales/ingest";
import { discoverTodaySales } from "@/backend/sales/sync";
import { startSalesSync, stopSalesSync } from "@/backend/sales/scheduler";
import { safeQuoteSseConsumer } from "@/backend/safequote/sse-consumer";
import { __resetSyncState, readSyncState } from "@/backend/live/sync-state";
import { __resetTraces, traceRows } from "@/backend/sales/delivery-trace";
import { GET as syncRoute } from "@/app/api/arena/sync/route";
import { POST as deliveryRoute } from "@/app/api/arena/delivery/route";
import { GET as liveDelivery } from "@/app/api/admin/live-delivery/route";
import { POST as createProgramRoute } from "@/app/api/admin/programs/route";
import { PUT as putConfig } from "@/app/api/admin/arena-config/route";
import { POST as login } from "@/app/api/admin/auth/login/route";
import { arenaBroadcaster, type ArenaBroadcastEvent } from "@/backend/events/broadcaster";
import { createAdmin, pool, req, resetDatabase, sessionFrom, setSetting } from "./helpers";

/**
 * Background sync, fast discovery and delivery monitoring, on the TEST database only, with a local fake
 * Safe Quote /recent-sales endpoint (never the real upstream). Tier amounts are test fixtures.
 */
let owner: { cookie: string; csrf: string };
let upstream: http.Server;
let upstreamSales: Array<Record<string, unknown>> = [];
let upstreamHits = 0;
let streamClients: http.ServerResponse[] = [];
let events: ArenaBroadcastEvent[] = [];
let off = () => {};
const ALL_ON = { daily: { active: true, showOnArena: true }, weekly: { active: true, showOnArena: true }, monthly: { active: true, showOnArena: true } };
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000);
const as = () => ({ cookie: owner.cookie, csrf: owner.csrf });
const program = async (salesRequired: number, amount: number) => {
  const r = await createProgramRoute(req("/api/admin/programs", { method: "POST", body: { kind: "daily", name: `Daily ${salesRequired}`, rewardType: "cash", currency: "PKR", amount, salesRequired, enabled: true, maxAwards: 1 }, ...as() }));
  expect(r.status, await r.clone().text()).toBe(201);
};
const counts = async () => (await pool().query(`SELECT (SELECT COUNT(*) FROM validated_sales)::int s, (SELECT COUNT(*) FROM bonus_awards)::int a, (SELECT COALESCE(SUM(amount),0)::text FROM bonus_awards) amt`)).rows[0];

describe("background sync: fingerprints, missed-sale recovery data, fast discovery, delivery trace", () => {
  beforeAll(async () => {
    await resetDatabase();
    await createAdmin();
    owner = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" } })));
    upstream = http.createServer((rq, res) => {
      upstreamHits++;
      if (rq.url?.startsWith("/events")) {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        res.write(": hello\n\n");
        streamClients.push(res);
        rq.on("close", () => (streamClients = streamClients.filter((c) => c !== res)));
        return;
      }
      if (!rq.url?.startsWith("/recent-sales")) return res.writeHead(404).end();
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ sales: upstreamSales }));
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    process.env.SALES_ARENA_API_URL = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    process.env.SALES_ARENA_API_TOKEN = "test-token-not-real";
    process.env.SALES_ARENA_TIMEZONE = "UTC";
  });
  afterAll(async () => {
    stopSalesSync();
    streamClients.forEach((c) => c.end());
    await new Promise((r) => upstream.close(r));
    delete process.env.SALES_ARENA_API_TOKEN;
  });
  beforeEach(async () => {
    await pool().query(`TRUNCATE bonus_sale_approvals, reward_program_history, bonus_awards, spin_credit_transactions, automatic_spin_awards, spin_credits, sale_status_history, sales_events_inbox, validated_sales, agents, reward_programs RESTART IDENTITY CASCADE`);
    await pool().query(`DELETE FROM admin_settings WHERE key = 'arena.config'`);
    await setSetting("auto_spins_enabled", false);
    await setSetting("reward_activation_cutoff", null);
    await putConfig(req("/api/admin/arena-config", { method: "PUT", body: { values: { businessTimezone: "UTC", weekStartDay: 1, rewardCategories: ALL_ON } }, ...as() }));
    __resetSyncState();
    __resetTraces();
    upstreamSales = [];
    events = [];
    off = arenaBroadcaster.subscribe((e) => events.push(e));
  });
  afterEach(() => off());

  it("fingerprints change only for real changes; recent sales exclude backfill and history; reads change nothing", async () => {
    const s0 = await readSyncState(pool());
    expect(s0.recentSales).toEqual([]);
    const before = await counts();
    for (let i = 0; i < 5; i++) {
      __resetSyncState();
      await readSyncState(pool());
    }
    expect(await counts()).toEqual(before); // read-only

    await ingestValidatedSale(pool(), { caseId: "BF-1", userCode: "CLS-A", closerName: "Agent A", validatedAt: minsAgo(30).toISOString() }, "backfill");
    __resetSyncState();
    const s1 = await readSyncState(pool());
    expect(s1.fp.sales).toBe(s0.fp.sales); // a historical import is not a live change
    expect(s1.recentSales).toEqual([]);

    await ingestValidatedSale(pool(), { caseId: "LIVE-1", userCode: "CLS-A", closerName: "Agent A", validatedAt: minsAgo(4).toISOString(), state: "TX", premium: 99 }, "reconciliation");
    __resetSyncState();
    const s2 = await readSyncState(pool());
    expect(s2.fp.sales).not.toBe(s1.fp.sales);
    expect(s2.fp.awards).toBe(s1.fp.awards); // no program: no award
    expect(s2.recentSales).toEqual([expect.objectContaining({ caseId: "LIVE-1", closerName: "Agent A", source: "reconciliation" })]);

    // Memoised for 2 s: many displays cost one set of queries.
    const a = readSyncState(pool());
    expect(readSyncState(pool())).toBe(a);

    // The public route exposes no customer data (no premium / state / coverage).
    __resetSyncState();
    const body = await (await syncRoute()).json();
    expect(body.ok).toBe(true);
    expect(Object.keys(body.recentSales[0]).sort()).toEqual(["caseId", "closerName", "firstSeenAt", "source", "userCode", "validatedAt"]);
    expect(JSON.stringify(body)).not.toMatch(/premium|"TX"|coverage/);
    expect(body.recoveryWindowSec).toBe(600);
  });

  it("fast discovery stores a sale the live stream missed, with Highest-Tier bonuses (3,000 final, +1,000), once", async () => {
    await program(2, 2000);
    await program(3, 3000);
    await pool().query(`UPDATE reward_programs SET active_since = NOW() - INTERVAL '1 hour'`);
    // Two sales arrived on the live stream earlier: the 2,000 tier.
    await ingestValidatedSale(pool(), { caseId: "T-1", userCode: "CLS-T", closerName: "Tier Agent", validatedAt: minsAgo(20).toISOString() }, "sse");
    await ingestValidatedSale(pool(), { caseId: "T-2", userCode: "CLS-T", closerName: "Tier Agent", validatedAt: minsAgo(10).toISOString() }, "sse");
    __resetSyncState();
    const fp0 = (await readSyncState(pool())).fp;

    // The third sale is only in Safe Quote's recent sales (its live event never came).
    const validatedAt = minsAgo(0.5).toISOString();
    upstreamSales = [
      { caseId: "T-1", closer: { code: "CLS-T", name: "Tier Agent" }, validatedAt: minsAgo(20).toISOString(), premium: 1 },
      { caseId: "T-2", closer: { code: "CLS-T", name: "Tier Agent" }, validatedAt: minsAgo(10).toISOString(), premium: 1 },
      { caseId: "T-3", closer: { code: "CLS-T", name: "Tier Agent" }, validatedAt, premium: 1 },
    ];
    const hits = upstreamHits;
    const before = events.length;
    const r = await discoverTodaySales(pool());
    expect(upstreamHits - hits).toBe(1); // one request (no summary call)
    expect(r).toMatchObject({ fetched: 3, inserted: 1, duplicates: 2 });
    expect((await pool().query(`SELECT source FROM validated_sales WHERE case_id = 'T-3'`)).rows[0].source).toBe("reconciliation");

    const award = events.slice(before).find((e) => e.type === "rewards.award.created")?.payload as { award: { amount: number; incrementAmount: number; upgrade: boolean; previousAmount: number } };
    expect(award.award).toMatchObject({ amount: 3000, incrementAmount: 1000, previousAmount: 2000, upgrade: true }); // never 5,000
    const eff = (await pool().query(`SELECT amount FROM bonus_awards WHERE superseded_by IS NULL AND status NOT IN ('cancelled','reversed')`)).rows;
    expect(eff.map((x) => Number(x.amount))).toEqual([3000]);

    __resetSyncState();
    const s = await readSyncState(pool());
    expect(s.fp.sales).not.toBe(fp0.sales);
    expect(s.fp.awards).not.toBe(fp0.awards); // the upgrade changes the awards fingerprint
    expect(s.recentSales.map((x) => x.caseId)).toContain("T-3");

    // Running again (next poll) never stores, awards or broadcasts twice.
    const n = events.length;
    const again = await discoverTodaySales(pool());
    expect(again).toMatchObject({ inserted: 0, duplicates: 3 });
    expect(events.length).toBe(n);
    expect((await counts()).a).toBe(2); // 2,000 (superseded, history) + 3,000

    // The trace records the real (slow) discovery, not "instant".
    const t = traceRows().find((x) => x.kind === "sale" && x.key === "T-3")!;
    expect(t.source).toBe("reconciliation");
    expect(t.stages.discoverySec!).toBeGreaterThanOrEqual(25);
    expect(t.stages.backendSec!).toBeLessThan(2);
  });

  it("displays report receipt / popup times; Admin sees the stages; junk is refused", async () => {
    await ingestValidatedSale(pool(), { caseId: "D-1", userCode: "CLS-D", closerName: "Agent D", validatedAt: minsAgo(1).toISOString() }, "sse");
    const sale = events.find((e) => e.type === "sale.validated")!.payload as { broadcastAt: string };
    const recv = new Date(new Date(sale.broadcastAt).getTime() + 300).toISOString();
    const shown = new Date(new Date(sale.broadcastAt).getTime() + 900).toISOString();
    const post = (body: unknown) => deliveryRoute(req("/api/arena/delivery", { method: "POST", body }));
    const ok = await post({ display: "d-test-display-1", items: [{ kind: "sale", key: "D-1", receivedAt: recv, via: "sse" }, { kind: "sale", key: "D-1", shownAt: shown }] });
    expect(ok.status).toBe(200);
    expect((await ok.json()).recorded).toBe(2);
    expect((await post({ display: "d-test-display-1", items: [{ kind: "sale", key: "UNKNOWN", receivedAt: recv }] })).status).toBe(202);
    expect((await post({ display: "../../etc", items: [{ kind: "sale", key: "D-1", receivedAt: recv }] })).status).toBe(202);
    expect((await deliveryRoute(req("/api/arena/delivery", { method: "POST", body: { display: "d-x", items: [], pad: "x".repeat(5000) } }))).status).toBe(413);

    const d = await (await liveDelivery(req("/api/admin/live-delivery", { cookie: owner.cookie }))).json();
    const row = d.trace.find((r: { key: string }) => r.key === "D-1");
    expect(row.stages.sseSec).toBe(0.3);
    expect(row.stages.frontendSec).toBe(0.6);
    expect(row.displays).toBe(1);
    expect(d.discoverySeconds).toBe(20);
    expect(d.traceStats.find((s: { stage: string }) => s.stage === "sse")).toMatchObject({ samples: 1, medianSec: null }); // too few samples: no number
    expect((await liveDelivery(req("/api/admin/live-delivery"))).status).toBe(401);
  });

  it("the background interval is a validated global setting (10–120 s) and changes the config fingerprint", async () => {
    const bad = await putConfig(req("/api/admin/arena-config", { method: "PUT", body: { values: { liveSyncSeconds: 2 } }, ...as() }));
    expect(bad.status).toBe(400);
    __resetSyncState();
    const rev0 = (await readSyncState(pool())).fp.config;
    const good = await putConfig(req("/api/admin/arena-config", { method: "PUT", body: { values: { liveSyncSeconds: 30 } }, ...as() }));
    expect(good.status, await good.clone().text()).toBe(200);
    __resetSyncState();
    expect((await readSyncState(pool())).fp.config).toBe(rev0 + 1);
    const pub = await pool().query(`SELECT value->'values'->>'liveSyncSeconds' v FROM admin_settings WHERE key = 'arena.config'`);
    expect(pub.rows[0].v).toBe("30");
  });

  it("an upstream event this app does not recognise stores nothing itself, but triggers an immediate check of the validated list", async () => {
    process.env.SALES_ARENA_DISCOVERY_SECONDS = "60"; // the regular poll is far away: only the event can explain a fast store
    startSalesSync();
    try {
      const deadline = Date.now() + 8000;
      while (safeQuoteSseConsumer.getHealth().status !== "connected" && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      expect(safeQuoteSseConsumer.getHealth().status).toBe("connected");
      const emit = (text: string) => streamClients.forEach((c) => c.write(text));

      // 1) A case event for a sale that is NOT validated at Safe Quote: nothing is stored.
      emit(`event: case.updated\ndata: ${JSON.stringify({ caseId: "EV-SUB", agent: "CLS-EV", stage: "submitted" })}\n\n`);
      await new Promise((r) => setTimeout(r, 3500));
      expect((await counts()).s).toBe(0);

      // 2) The validation: whatever the event is called, the validated list has it → stored within seconds.
      upstreamSales = [{ caseId: "EV-1", closer: { code: "CLS-EV", name: "Event Agent" }, validatedAt: new Date(Date.now() - 1500).toISOString(), premium: 1 }];
      const t0 = Date.now();
      emit(`event: case.status_changed\ndata: ${JSON.stringify({ caseId: "EV-1", agent: "CLS-EV", status: "validated" })}\n\n`);
      let row: { source: string } | undefined;
      while (!row && Date.now() - t0 < 10_000) {
        row = (await pool().query(`SELECT source FROM validated_sales WHERE case_id = 'EV-1'`)).rows[0];
        if (!row) await new Promise((r) => setTimeout(r, 100));
      }
      const ms = Date.now() - t0;
      console.log("EVENT_TRIGGERED_DISCOVERY_MS", ms);
      expect(row?.source).toBe("reconciliation");
      expect(ms).toBeLessThan(5000); // vs. up to 5 minutes before (and 60 s for the regular poll here)
      expect((await counts()).s).toBe(1);
      expect(events.filter((e) => e.type === "sale.validated").map((e) => (e.payload as { caseId: string }).caseId)).toEqual(["EV-1"]);

      // Diagnostics: event names and field names only, never values.
      const u = safeQuoteSseConsumer.getHealth().unrecognizedEvents;
      expect(Object.keys(u).sort()).toEqual(["case.status_changed", "case.updated"]);
      expect(u["case.status_changed"]).toMatchObject({ count: 1, fields: ["caseId", "agent", "status"] });
      expect(JSON.stringify(u)).not.toMatch(/CLS-EV|EV-1|validated|submitted/);
    } finally {
      stopSalesSync();
      delete process.env.SALES_ARENA_DISCOVERY_SECONDS;
    }
  });
});
