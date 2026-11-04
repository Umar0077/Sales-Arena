import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { NextRequest } from "next/server";
import { SafeQuoteSseConsumer } from "@/lib/server/safequote/sse-consumer";
import { GET as stream } from "@/app/api/arena/stream/route";
import { PUT as putConfig } from "@/app/api/admin/arena-config/route";
import { POST as createProgram } from "@/app/api/admin/programs/route";
import { GET as liveDelivery } from "@/app/api/admin/live-delivery/route";
import { POST as login } from "@/app/api/admin/auth/login/route";
import { arenaBroadcaster, type ArenaBroadcastEvent } from "@/lib/server/events/broadcaster";
import { createAdmin, pool, req, resetDatabase, sessionFrom } from "./helpers";

/**
 * Real-time delivery, in the test database only: a local fake Safe Quote stream (no real upstream)
 * that splits every message across network writes, the real consumer, ingestion, reward engine,
 * broadcaster and the Live Arena SSE route.
 */
let owner: { cookie: string; csrf: string };
let upstream: http.Server;
let upstreamUrl = "";
let pending: string[] = [];
let clients: http.ServerResponse[] = [];

function emitSplit(text: string) {
  // Worst case for a parser: every message cut in the middle of its data line and before its blank line.
  const a = Math.floor(text.indexOf("data:") + 12);
  const b = text.length - 1;
  for (const res of clients) {
    res.write(text.slice(0, a));
    setTimeout(() => res.write(text.slice(a, b)), 40);
    setTimeout(() => res.write(text.slice(b)), 80);
  }
}
const saleEvent = (caseId: string, userCode: string, name: string, at: Date) =>
  `id: up-${caseId}\nevent: sale.validated\ndata: ${JSON.stringify({ caseId, closer: { userCode, name }, validatedAt: at.toISOString(), premium: 42 })}\n\n`;

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("real-time pipeline: Safe Quote stream → PostgreSQL → reward engine → Live Arena SSE", () => {
  beforeAll(async () => {
    await resetDatabase();
    await createAdmin();
    owner = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" } })));
    upstream = http.createServer((rq, res) => {
      if (!rq.url?.endsWith("/events")) return res.writeHead(404).end();
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write(": hello\n\n");
      clients.push(res);
      for (const p of pending) emitSplit(p);
      pending = [];
      rq.on("close", () => (clients = clients.filter((c) => c !== res)));
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    process.env.SALES_ARENA_API_URL = upstreamUrl;
    process.env.SALES_ARENA_API_TOKEN = "test-token-not-real";
  });
  afterAll(async () => {
    clients.forEach((c) => c.end());
    await new Promise((r) => upstream.close(r));
    delete process.env.SALES_ARENA_API_TOKEN;
  });
  beforeEach(async () => {
    await pool().query(`TRUNCATE bonus_awards, spin_credit_transactions, automatic_spin_awards, spin_credits, sale_status_history, sales_events_inbox, validated_sales, agents, reward_programs RESTART IDENTITY CASCADE`);
    await pool().query(`DELETE FROM sync_checkpoints WHERE id = 'sse'`).catch(() => {});
  });

  it("split upstream messages are stored via the live stream within seconds, with a bonus exactly once and a full timeline", async () => {
    await pool().query(`DELETE FROM admin_settings WHERE key = 'arena.config'`);
    await putConfig(req("/api/admin/arena-config", { method: "PUT", body: { values: { businessTimezone: "UTC", rewardCategories: { daily: { active: true, showOnArena: true }, weekly: { active: true, showOnArena: true }, monthly: { active: true, showOnArena: true } } } }, cookie: owner.cookie, csrf: owner.csrf }));
    const p = await createProgram(req("/api/admin/programs", { method: "POST", body: { kind: "daily", name: "Daily 2", rewardType: "cash", currency: "PKR", amount: 2000, salesRequired: 2, enabled: true, maxAwards: 1 }, cookie: owner.cookie, csrf: owner.csrf }));
    expect(p.status, await p.clone().text()).toBe(201);
    await pool().query(`UPDATE reward_programs SET active_since = NOW() - INTERVAL '1 hour'`);

    const events: ArenaBroadcastEvent[] = [];
    const off = arenaBroadcaster.subscribe((e) => events.push(e));
    const consumer = new SafeQuoteSseConsumer();
    consumer.start();
    try {
      await waitFor(async () => (consumer.getHealth().status === "connected" ? true : null));
      const t0 = Date.now();
      emitSplit(saleEvent("RT-1", "CLS-RT", "Realtime Closer", new Date(t0 - 1000)) + saleEvent("RT-2", "CLS-RT", "Realtime Closer", new Date(t0 - 500)));

      const rows = await waitFor(async () => {
        const r = await pool().query(`SELECT case_id, source FROM validated_sales ORDER BY case_id`);
        return r.rows.length === 2 ? r.rows : null;
      });
      const storedMs = Date.now() - t0;
      expect(rows).toEqual([{ case_id: "RT-1", source: "sse" }, { case_id: "RT-2", source: "sse" }]); // never left for reconciliation
      expect(storedMs).toBeLessThan(3000);

      // Bonus: exactly one award, broadcast with the real amount and the timeline stamps.
      const award = await waitFor(async () => events.find((e) => e.type === "rewards.award.created"));
      const payload = award.payload as { award: { amount: number; currency: string }; broadcastAt: string; firstSeenAt: string; source: string };
      expect(payload.award).toMatchObject({ amount: 2000, currency: "PKR" });
      expect(payload.source).toBe("sse");
      expect((await pool().query(`SELECT COUNT(*)::int AS n FROM bonus_awards`)).rows[0].n).toBe(1);

      const sales = events.filter((e) => e.type === "sale.validated").map((e) => e.payload as Record<string, string>);
      expect(sales.map((s) => s.caseId)).toEqual(["RT-1", "RT-2"]);
      for (const s of sales) {
        const committedToBroadcast = new Date(s.broadcastAt).getTime() - new Date(s.storedAt).getTime();
        expect(committedToBroadcast).toBeLessThan(250); // broadcast right after the commit
        expect(new Date(s.firstSeenAt).getTime()).toBeGreaterThanOrEqual(t0 - 50);
      }

      // Redelivery after an upstream reconnect never stores, awards or broadcasts twice.
      emitSplit(saleEvent("RT-2", "CLS-RT", "Realtime Closer", new Date(t0 - 500)));
      await new Promise((r) => setTimeout(r, 600));
      expect(events.filter((e) => e.type === "sale.validated")).toHaveLength(2);
      expect((await pool().query(`SELECT COUNT(*)::int AS n FROM bonus_awards`)).rows[0].n).toBe(1);
    } finally {
      consumer.stop();
      off();
    }

    // Admin diagnostics show how it was discovered.
    const d = await (await liveDelivery(req("/api/admin/live-delivery", { cookie: owner.cookie }))).json();
    expect(d.recent.map((r: { caseId: string; source: string }) => [r.caseId, r.source])).toEqual([["RT-2", "sse"], ["RT-1", "sse"]]);
    expect(d.bySource).toEqual([expect.objectContaining({ source: "sse", sales: 2 })]);
    expect(d.recent[1].awardCreatedAt === null || typeof d.recent[1].awardCreatedAt === "string").toBe(true);
    const anon = await liveDelivery(req("/api/admin/live-delivery"));
    expect(anon.status).toBe(401);
  });

  it("Live Arena SSE: unbuffered headers and broadcast → bytes on the wire within milliseconds", async () => {
    const ctl = new AbortController();
    const res = await stream(new NextRequest(new Request("http://arena.test/api/arena/stream", { headers: { host: "arena.test" }, signal: ctl.signal })));
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("x-accel-buffering")).toBe("no"); // Nginx must not buffer this response
    expect(res.headers.get("cache-control")).toContain("no-transform"); // never compressed / held back
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    await reader.read(); // "ready"
    const sent = Date.now();
    arenaBroadcaster.broadcast("stats.updated", { probe: "latency" });
    let text = "";
    while (!text.includes("probe")) text += dec.decode((await reader.read()).value);
    expect(Date.now() - sent).toBeLessThan(200);
    ctl.abort();
    await reader.cancel().catch(() => {});
  });
});
