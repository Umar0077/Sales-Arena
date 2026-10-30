import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { GET as adminGet, PUT as adminPut } from "@/app/api/admin/display-settings/route";
import { GET as publicGet } from "@/app/api/arena/display-settings/route";
import { GET as modeGet } from "@/app/api/arena/mode/route";
import { POST as login } from "@/app/api/admin/auth/login/route";
import { arenaBroadcaster, type ArenaBroadcastEvent } from "@/lib/server/events/broadcaster";
import { createAdmin, pool, req, resetDatabase, restartPool, sessionFrom } from "./helpers";

let sess: { cookie: string; csrf: string };
let events: ArenaBroadcastEvent[] = [];
let off = () => {};
const put = (mode: unknown, s: { cookie?: string; csrf?: string } = sess) =>
  adminPut(req("/api/admin/display-settings", { method: "PUT", body: { performanceMode: mode }, cookie: s.cookie, csrf: s.csrf }));

describe("global display performance mode", () => {
  beforeAll(async () => {
    await resetDatabase();
    await createAdmin();
    sess = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" } })));
  });
  beforeEach(async () => {
    await pool().query(`DELETE FROM admin_settings WHERE key = 'display.performance_mode'`);
    await pool().query(`TRUNCATE audit_logs RESTART IDENTITY`);
    events = [];
    off = arenaBroadcaster.subscribe((e) => events.push(e));
  });
  afterEach(() => off());

  it("defaults to Auto (revision 0) for a new installation", async () => {
    expect(await (await publicGet()).json()).toMatchObject({ ok: true, performanceMode: "auto", revision: 0 });
  });

  it("Test G: only a signed-in admin with CSRF can change it", async () => {
    expect((await put("performance", {})).status).toBe(401);
    expect((await put("performance", { cookie: sess.cookie })).status).toBe(403);
    expect((await put("ultra")).status).toBe(400);
    expect((await (await publicGet()).json()).performanceMode).toBe("auto");
    expect(events).toHaveLength(0);
  });

  it("saves to PostgreSQL, bumps the revision, audits, and broadcasts once on the shared stream", async () => {
    const r1 = await (await put("performance")).json();
    const r2 = await (await put("high")).json();
    expect(r1).toMatchObject({ performanceMode: "performance", revision: 1, updatedBy: "owner@example.com" });
    expect(r2.revision).toBe(2);
    expect(events.map((e) => [e.type, e.payload])).toEqual([
      ["settings.performance.updated", { mode: "performance", revision: 1 }],
      ["settings.performance.updated", { mode: "high", revision: 2 }],
    ]);
    const audits = await pool().query(`SELECT action, details FROM audit_logs WHERE admin_id IS NOT NULL ORDER BY id`);
    expect(audits.rows.map((a) => [a.action, a.details.to])).toEqual([
      ["settings.performance_mode", "performance"],
      ["settings.performance_mode", "high"],
    ]);
    // New devices get it in their very first request.
    expect((await (await modeGet()).json()).display).toEqual({ performanceMode: "high", revision: 2 });
  });

  it("Test F: survives an application restart", async () => {
    await put("performance");
    await restartPool();
    expect(await (await publicGet()).json()).toMatchObject({ performanceMode: "performance", revision: 1 });
    expect((await (await adminGet(req("/api/admin/display-settings", { cookie: sess.cookie }))).json()).performanceMode).toBe("performance");
  });

  it("concurrent saves get distinct, consecutive revisions", async () => {
    await Promise.all(["auto", "high", "performance", "high"].map((m) => put(m)));
    expect((await (await publicGet()).json()).revision).toBe(4);
    expect(new Set(events.map((e) => (e.payload as { revision: number }).revision)).size).toBe(4);
  });
});
