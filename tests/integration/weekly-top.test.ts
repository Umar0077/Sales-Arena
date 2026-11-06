import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { celebrateWeeklyTop, weeklyTopPerformer, RECOGNITION_EVENT, RECOGNITION_KEY } from "@/backend/recognition/weekly-top";
import { arenaBroadcaster, type ArenaBroadcastEvent } from "@/backend/events/broadcaster";
import { GET, POST } from "@/app/api/admin/celebrations/weekly-top-performer/route";
import { POST as login } from "@/app/api/admin/auth/login/route";
import type { CloserRow } from "@/shared/sales/leads";
import { createAdmin, pool, req, resetDatabase, sessionFrom } from "./helpers";

/**
 * Weekly Top Performer recognition on the TEST database only. Safe Quote figures come from a fake (the same
 * CloserRow shape the Weekly leaderboard uses). Recognition only: it must never create money, spins or sales.
 */
const row = (code: string, name: string, validated: number, submitted = validated + 2, campaignId = "cmp_fe"): CloserRow => ({
  agent: { id: `agt_${code}`, name, initials: name.slice(0, 2), teamId: "fe", campaignId, active: true } as CloserRow["agent"],
  code,
  teamId: "fe",
  counts: { submitted, validated, pending: 0, rejected: 0, duplicate: 0 },
  rate: submitted ? (validated / submitted) * 100 : 0,
  rank: 0,
});
let rows: CloserRow[] = [];
const closers = async () => rows;
let events: ArenaBroadcastEvent[] = [];
let off = () => {};
let actor: { adminId: string; ip: null; userAgent: null };
const count = async (t: string) => Number((await pool().query(`SELECT COUNT(*)::int n FROM ${t}`)).rows[0].n);
const NOW = new Date("2026-11-05T17:00:00Z"); // a Thursday (business week Mon 2 – Sun 8, America/New_York)

describe("Weekly Top Performer recognition", () => {
  beforeAll(async () => {
    await resetDatabase();
    await createAdmin();
    actor = { adminId: (await pool().query(`SELECT id FROM admin_users WHERE email = 'owner@example.com'`)).rows[0].id, ip: null, userAgent: null };
  });
  beforeEach(async () => {
    await pool().query(`DELETE FROM admin_settings WHERE key = $1`, [RECOGNITION_KEY]);
    rows = [row("UI-A", "Arsam Idrees", 23), row("UI-B", "Rehan Ali", 19), row("UI-C", "Kanwal Farooq", 0, 4)];
    events = [];
    off = arenaBroadcaster.subscribe((e) => events.push(e));
  });
  afterEach(() => off());

  it("the #1 is the Weekly leaderboard's first row for this business week; nobody is celebrated without an approved sale", async () => {
    const s = await weeklyTopPerformer(pool(), { now: NOW, closers });
    expect(s.week).toMatchObject({ from: "2026-11-02", to: "2026-11-08" });
    expect(s.top).toEqual({ userCode: "UI-A", name: "Arsam Idrees", validated: 23, submitted: 25 });
    expect(s.tiedWith).toBeNull();
    expect(s.celebrated).toBeNull();
    rows = [row("UI-A", "Arsam Idrees", 7), row("UI-B", "Rehan Ali", 7)];
    expect((await weeklyTopPerformer(pool(), { now: NOW, closers })).tiedWith).toBe("Rehan Ali");
    rows = [row("UI-C", "Kanwal Farooq", 0, 4)];
    expect((await weeklyTopPerformer(pool(), { now: NOW, closers })).top).toBeNull();
    await expect(celebrateWeeklyTop(pool(), actor, { now: NOW, closers })).rejects.toMatchObject({ status: 422 });
    expect(events.filter((e) => e.type === RECOGNITION_EVENT)).toHaveLength(0);
  });

  it("once per week: the first celebration is broadcast once and audited; a second attempt is refused (no second broadcast)", async () => {
    const money = { awards: await count("bonus_awards"), spins: await count("spin_credit_transactions"), sales: await count("validated_sales") };
    const r = await celebrateWeeklyTop(pool(), actor, { now: NOW, closers });
    expect(r).toMatchObject({ id: "weekly-top:2026-11-02", top: { name: "Arsam Idrees", validated: 23 } });
    const ev = events.filter((e) => e.type === RECOGNITION_EVENT);
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toMatchObject({ id: "weekly-top:2026-11-02", name: "Arsam Idrees", validated: 23, from: "2026-11-02", to: "2026-11-08" });
    await expect(celebrateWeeklyTop(pool(), actor, { now: NOW, closers })).rejects.toMatchObject({ status: 409 });
    // Two Admins clicking at the same moment: still exactly one broadcast in total.
    await Promise.allSettled([celebrateWeeklyTop(pool(), actor, { now: NOW, closers }), celebrateWeeklyTop(pool(), actor, { now: NOW, closers })]);
    expect(events.filter((e) => e.type === RECOGNITION_EVENT)).toHaveLength(1);
    const st = await weeklyTopPerformer(pool(), { now: NOW, closers });
    expect(st.celebrated).toMatchObject({ name: "Arsam Idrees", validated: 23, weekFrom: "2026-11-02", by: "owner@example.com" });
    const audit = (await pool().query(`SELECT action, target_id FROM audit_logs WHERE action = 'recognition.weekly_top.celebrated'`)).rows;
    expect(audit).toEqual([{ action: "recognition.weekly_top.celebrated", target_id: "UI-A" }]);
    // Recognition only: no award, spin credit or sale was created or changed.
    expect({ awards: await count("bonus_awards"), spins: await count("spin_credit_transactions"), sales: await count("validated_sales") }).toEqual(money);
  });

  it("next business week a new celebration is allowed again", async () => {
    await celebrateWeeklyTop(pool(), actor, { now: NOW, closers });
    const next = await celebrateWeeklyTop(pool(), actor, { now: new Date("2026-11-10T17:00:00Z"), closers });
    expect(next.id).toBe("weekly-top:2026-11-09");
    expect(events.filter((e) => e.type === RECOGNITION_EVENT)).toHaveLength(2);
  });

  it("the Admin API needs a session (and CSRF for the trigger)", async () => {
    expect((await GET(req("/api/admin/celebrations/weekly-top-performer"))).status).toBe(401);
    expect((await POST(req("/api/admin/celebrations/weekly-top-performer", { method: "POST" }))).status).toBe(401);
    const s = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" } })));
    expect((await POST(req("/api/admin/celebrations/weekly-top-performer", { method: "POST", cookie: s.cookie }))).status).toBe(403); // no CSRF token
  });
});
