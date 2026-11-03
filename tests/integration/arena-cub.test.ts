import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { ingestValidatedSale, recordSaleStatus } from "@/lib/server/sales/ingest";
import { GET as cubActivity } from "@/app/api/arena/cub/route";
import { GET as publicConfig } from "@/app/api/arena/config/route";
import { GET as getConfig, PUT as putConfig } from "@/app/api/admin/arena-config/route";
import { POST as login } from "@/app/api/admin/auth/login/route";
import { arenaBroadcaster, type ArenaBroadcastEvent } from "@/lib/server/events/broadcaster";
import { DEFAULT_CUB } from "@/lib/cub/config";
import { createAdmin, pool, req, resetDatabase, sessionFrom } from "./helpers";

/** Arena Cub server side: read-only activity, the sale event's source flag, and its PostgreSQL settings. */
let owner: { cookie: string; csrf: string };
let events: ArenaBroadcastEvent[] = [];
let off = () => {};
let seq = 0;
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000);
const sale = (at: Date, caseId = `CUB-${Date.now()}-${seq++}`) => ({ caseId, userCode: "CUB-AGENT", closerName: "Cub Agent", validatedAt: at.toISOString(), premium: 10 });
const counts = async () =>
  (
    await pool().query(
      `SELECT (SELECT COUNT(*) FROM validated_sales)::int AS sales, (SELECT COUNT(*) FROM bonus_awards)::int AS awards,
              (SELECT COUNT(*) FROM spin_credit_transactions)::int AS spins, (SELECT COUNT(*) FROM audit_logs)::int AS audits`,
    )
  ).rows[0];

describe("Arena Cub (server)", () => {
  beforeAll(async () => {
    await resetDatabase();
    await createAdmin();
    owner = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" } })));
  });
  beforeEach(async () => {
    await pool().query(`TRUNCATE bonus_awards, spin_credit_transactions, automatic_spin_awards, spin_credits, sale_status_history, sales_events_inbox, validated_sales, agents RESTART IDENTITY CASCADE`);
    events = [];
    off = arenaBroadcaster.subscribe((e) => events.push(e));
  });
  afterEach(() => off());

  it("activity = latest validated sale (returned / rejected excluded), and reading it writes nothing", async () => {
    let j = await (await cubActivity()).json();
    expect(j).toMatchObject({ ok: true, lastSaleAt: null });
    expect(Math.abs(new Date(j.serverNow).getTime() - Date.now())).toBeLessThan(5000);

    const older = sale(minsAgo(40));
    const newer = sale(minsAgo(12));
    await ingestValidatedSale(pool(), older, "sse");
    await ingestValidatedSale(pool(), newer, "reconciliation");
    j = await (await cubActivity()).json();
    expect(j.lastSaleAt).toBe(new Date(newer.validatedAt).toISOString());
    expect(Object.keys(j).sort()).toEqual(["lastSaleAt", "ok", "serverNow"]); // no names, codes or amounts

    await recordSaleStatus(pool(), { caseId: newer.caseId, status: "returned", source: "sse" });
    expect((await (await cubActivity()).json()).lastSaleAt).toBe(new Date(older.validatedAt).toISOString());

    const before = await counts();
    for (let i = 0; i < 5; i++) await cubActivity();
    expect(await counts()).toEqual(before);
  });

  it("sale.validated carries its source once per committed sale, so imports never feed the cub", async () => {
    const live = sale(minsAgo(1));
    await ingestValidatedSale(pool(), live, "sse");
    await ingestValidatedSale(pool(), live, "reconciliation"); // same case found again: no second event
    await ingestValidatedSale(pool(), sale(minsAgo(500)), "backfill");
    const sales = events.filter((e) => e.type === "sale.validated").map((e) => e.payload as { caseId: string; source: string });
    expect(sales).toHaveLength(2);
    expect(sales[0]).toMatchObject({ caseId: live.caseId, source: "sse" });
    expect(sales[1].source).toBe("backfill");
  });

  it("settings: stored in arena.config, validated server-side, audited, broadcast to every screen", async () => {
    const put = (values: unknown) => putConfig(req("/api/admin/arena-config", { method: "PUT", body: { values }, cookie: owner.cookie, csrf: owner.csrf }));
    // Defaults before any save.
    expect((await (await publicConfig()).json()).values.arenaCub).toEqual(DEFAULT_CUB);

    const next = { ...DEFAULT_CUB, hungerMin: 10, angryMin: 25, sadMin: 40, screens: { ...DEFAULT_CUB.screens, monthly: false }, sounds: true, activeStart: "08:30" };
    const ok = await put({ arenaCub: next });
    expect(ok.status).toBe(200);
    const saved = await ok.json();
    expect(saved.values.arenaCub).toEqual(next);
    const row = (await pool().query(`SELECT value FROM admin_settings WHERE key = 'arena.config'`)).rows[0].value;
    expect(row.values.arenaCub).toEqual(next);
    expect(events.find((e) => e.type === "settings.mascot.updated")?.payload).toMatchObject({ revision: saved.revision, scope: "config" });
    const audit = (await pool().query(`SELECT details FROM audit_logs WHERE action = 'settings.arena_config' ORDER BY id DESC LIMIT 1`)).rows[0].details;
    expect(audit.changed.arenaCub.to).toEqual(next);
    expect((await (await publicConfig()).json()).values.arenaCub).toEqual(next); // what every display reads

    // Refused: wrong order, unknown key, bad value. Nothing changes.
    for (const bad of [{ ...next, hungerMin: 30, angryMin: 20 }, { ...next, evil: 1 }, { ...next, size: 99999 }, { ...next, activeEnd: "8pm" }]) {
      const r = await put({ arenaCub: bad });
      expect(r.status).toBe(400);
    }
    const now = await (await getConfig(req("/api/admin/arena-config", { cookie: owner.cookie }))).json();
    expect(now.values.arenaCub).toEqual(next);

    // Anonymous screens cannot change it.
    const anon = await putConfig(req("/api/admin/arena-config", { method: "PUT", body: { values: { arenaCub: { ...next, enabled: false } } } }));
    expect(anon.status).toBe(401);
  });
});
