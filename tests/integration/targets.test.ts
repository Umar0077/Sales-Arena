import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { GET as adminGet, PUT as adminPut } from "@/app/api/admin/targets/route";
import { GET as arenaGet } from "@/app/api/arena/targets/route";
import { POST as login } from "@/app/api/admin/auth/login/route";
import { createAdmin, pool, req, resetDatabase, restartPool, sessionFrom } from "./helpers";

let sess: { cookie: string; csrf: string };

const put = (body: unknown, s: { cookie?: string; csrf?: string } = sess) =>
  adminPut(req("/api/admin/targets", { method: "PUT", body, cookie: s.cookie, csrf: s.csrf }));

describe("sales targets", () => {
  beforeAll(async () => {
    await resetDatabase();
    await createAdmin();
    sess = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" } })));
  });
  beforeEach(async () => {
    await pool().query(`TRUNCATE sales_target_history, sales_targets, audit_logs RESTART IDENTITY CASCADE`);
  });

  it("requires an admin session and CSRF to change a target", async () => {
    expect((await put({ periodType: "day", periodKey: "2026-10-30", target: 40 }, {})).status).toBe(401);
    expect((await put({ periodType: "day", periodKey: "2026-10-30", target: 40 }, { cookie: sess.cookie })).status).toBe(403);
    expect((await adminGet(req("/api/admin/targets?day=2026-10-30"))).status).toBe(401);
    expect((await pool().query(`SELECT COUNT(*)::int AS n FROM sales_targets`)).rows[0].n).toBe(0);
  });

  it("saves day/week/month targets, keeps history with old→new and who changed it, and audits", async () => {
    expect((await put({ periodType: "day", periodKey: "2026-10-30", target: 40, note: "Friday push" })).status).toBe(200);
    expect((await put({ periodType: "day", periodKey: "2026-10-30", target: 45 })).status).toBe(200);
    expect((await put({ periodType: "week", periodKey: "2026-10-26", target: 200 })).status).toBe(200);
    expect((await put({ periodType: "month", periodKey: "2026-10-01", target: 800 })).status).toBe(200);

    const res = await adminGet(req("/api/admin/targets?day=2026-10-30&week=2026-10-26&month=2026-10-01", { cookie: sess.cookie }));
    const j = await res.json();
    expect(j.targets.day).toMatchObject({ target: 45, updatedBy: "owner@example.com" });
    expect(j.targets.week.target).toBe(200);
    expect(j.targets.month.target).toBe(800);
    const dayHistory = j.history.filter((h: { periodType: string }) => h.periodType === "day");
    expect(dayHistory.map((h: { oldTarget: number | null; newTarget: number }) => [h.oldTarget, h.newTarget])).toEqual([
      [40, 45],
      [null, 40],
    ]);
    const audits = (await pool().query(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'target.updated' AND admin_id IS NOT NULL`)).rows[0].n;
    expect(audits).toBe(4);
  });

  it("rejects invalid input", async () => {
    for (const body of [
      { periodType: "year", periodKey: "2026-10-30", target: 1 },
      { periodType: "day", periodKey: "2026-02-30", target: 1 },
      { periodType: "day", periodKey: "2026-10-30", target: -1 },
      { periodType: "day", periodKey: "2026-10-30", target: 2.5 },
    ]) {
      expect((await put(body)).status).toBe(400);
    }
  });

  it("serves read-only targets to the Live Arena and survives a restart", async () => {
    await put({ periodType: "day", periodKey: "2026-10-30", target: 12 });
    await restartPool();
    const j = await (await arenaGet(req("/api/arena/targets?day=2026-10-30&week=2026-10-26"))).json();
    expect(j.targets.day.target).toBe(12);
    expect(j.targets.week).toBeNull();
    expect(JSON.stringify(j)).not.toContain("owner@example.com"); // public payload has no admin identity
  });

  it("serialises concurrent saves so each change is recorded", async () => {
    await Promise.all([10, 20, 30, 40, 50].map((t) => put({ periodType: "day", periodKey: "2026-10-31", target: t })));
    const h = (await pool().query(`SELECT old_target, new_target FROM sales_target_history WHERE period_key = '2026-10-31' ORDER BY id`)).rows;
    expect(h).toHaveLength(5);
    expect(h[0].old_target).toBeNull();
    for (let i = 1; i < h.length; i++) expect(h[i].old_target).toBe(h[i - 1].new_target); // a clean chain
  });
});
