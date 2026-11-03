import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { randomBytes } from "crypto";
import { POST as command } from "@/app/api/admin/arena-cub/command/route";
import { PUT as putConfig } from "@/app/api/admin/arena-config/route";
import { GET as stream } from "@/app/api/arena/stream/route";
import { POST as login } from "@/app/api/admin/auth/login/route";
import { arenaBroadcaster, type ArenaBroadcastEvent } from "@/lib/server/events/broadcaster";
import { __resetCubRate, CUB_RATE } from "@/lib/server/cub/commands";
import { deviceCookieName } from "@/lib/server/auth/arena-device";
import { sha256 } from "@/lib/server/auth/session";
import { DEFAULT_CUB } from "@/lib/cub/config";
import { createAdmin, pool, req, resetDatabase, sessionFrom } from "./helpers";

/** Live Arena Cub commands: admin-only, allowlisted, permission-gated, rate-limited, audited; device targeting on the real SSE stream. */
let owner: { cookie: string; csrf: string };
let events: ArenaBroadcastEvent[] = [];
let off = () => {};
const send = (body: unknown, auth: { cookie?: string; csrf?: string } = owner) => command(req("/api/admin/arena-cub/command", { method: "POST", body, cookie: auth.cookie, csrf: auth.csrf }));
const setCub = (patch: Record<string, unknown>) => putConfig(req("/api/admin/arena-config", { method: "PUT", body: { values: { arenaCub: { ...DEFAULT_CUB, ...patch } } }, cookie: owner.cookie, csrf: owner.csrf }));
const financial = async () =>
  (
    await pool().query(
      `SELECT (SELECT COUNT(*) FROM validated_sales)::int AS sales, (SELECT COUNT(*) FROM bonus_awards)::int AS awards, (SELECT COUNT(*) FROM spin_credit_transactions)::int AS spins`,
    )
  ).rows[0];

describe("Arena Cub live commands", () => {
  beforeAll(async () => {
    await resetDatabase();
    await createAdmin();
    owner = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" } })));
  });
  beforeEach(async () => {
    __resetCubRate();
    events = [];
    off = arenaBroadcaster.subscribe((e) => events.push(e));
  });
  afterEach(() => off());

  it("is OFF by default: live commands are refused until the admin allows the cub on the Live Arena", async () => {
    await pool().query(`DELETE FROM admin_settings WHERE key = 'arena.config'`);
    const r = await send({ action: "wave" });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/Allow Arena Cub on Live Arena/);
    expect(events.filter((e) => e.type === "arena.cub.action")).toHaveLength(0);
  });

  it("only signed-in admins (with CSRF) can send; anything outside the allowlist is refused", async () => {
    expect((await setCub({ allowOnLiveArena: true })).status).toBe(200);
    expect((await send({ action: "wave" }, {})).status).toBe(401); // anonymous display / public client
    expect((await send({ action: "wave" }, { cookie: owner.cookie })).status).toBe(403); // missing CSRF
    for (const bad of [
      { action: "eval" },
      { action: "<script>alert(1)</script>" },
      { action: "wave", css: "body{display:none}" },
      { action: "wave", target: { scope: "screen", screen: "admin" } },
      { action: "wave", target: { scope: "devices", devices: ["not-a-uuid"] } },
      { action: "wave", target: { scope: "devices", devices: ["00000000-0000-4000-8000-000000000000"] } }, // not paired
    ]) {
      __resetCubRate();
      expect((await send(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    const big = await command(req("/api/admin/arena-cub/command", { method: "POST", body: { action: "wave", pad: "x".repeat(3000) }, cookie: owner.cookie, csrf: owner.csrf }));
    expect(big.status).toBe(413);
    expect(events.filter((e) => e.type === "arena.cub.action")).toHaveLength(0);
  });

  it("valid command: unique id, expiry, target, audited with the admin identity, broadcast once; nothing financial", async () => {
    const before = await financial();
    const r = await send({ action: "run_across", target: { scope: "screen", screen: "weekly" } });
    expect(r.status).toBe(200);
    const { command: c } = await r.json();
    expect(c).toMatchObject({ action: "run_across", target: { scope: "screen", screen: "weekly" } });
    expect(c.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(c.expiresAt).getTime() - new Date(c.issuedAt).getTime()).toBe(20_000);
    const sent = events.filter((e) => e.type === "arena.cub.action");
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toEqual(c);
    expect(JSON.stringify(sent[0].payload)).not.toMatch(/owner@example.com/); // identity stays in the audit log
    const audit = (await pool().query(`SELECT a.action, a.target_id, a.details, u.email FROM audit_logs a JOIN admin_users u ON u.id = a.admin_id WHERE a.action = 'arena_cub.command' ORDER BY a.id DESC LIMIT 1`)).rows[0];
    expect(audit).toMatchObject({ action: "arena_cub.command", target_id: c.id, email: "owner@example.com" });
    expect(audit.details).toMatchObject({ action: "run_across", target: { scope: "screen", screen: "weekly" } });
    expect(await financial()).toEqual(before);
  });

  it("rate limits per admin and a cooldown on the live greeting", async () => {
    let t = Date.now();
    const { sendCubCommand } = await import("@/lib/server/cub/commands");
    const actor = { adminId: (await pool().query(`SELECT id FROM admin_users LIMIT 1`)).rows[0].id, ip: null, userAgent: null };
    await sendCubCommand(pool(), { action: "jump" }, actor, t);
    await expect(sendCubCommand(pool(), { action: "jump" }, actor, t + 200)).rejects.toMatchObject({ status: 429 }); // too fast
    __resetCubRate();
    await sendCubCommand(pool(), { action: "greet" }, actor, t);
    await expect(sendCubCommand(pool(), { action: "greet" }, actor, t + 5000)).rejects.toMatchObject({ status: 429 });
    await sendCubCommand(pool(), { action: "greet" }, actor, t + CUB_RATE.greetCooldownMs + 10);
    __resetCubRate();
    t += 100_000;
    for (let i = 0; i < CUB_RATE.perMinute; i++) await sendCubCommand(pool(), { action: "wave" }, actor, t + i * 1500);
    await expect(sendCubCommand(pool(), { action: "wave" }, actor, t + CUB_RATE.perMinute * 1500)).rejects.toMatchObject({ status: 429 });
  });

  it("hiding the cub (permission OFF) blocks live commands again", async () => {
    expect((await setCub({ allowOnLiveArena: false })).status).toBe(200);
    expect((await send({ action: "wave" })).status).toBe(409);
    expect((await setCub({ allowOnLiveArena: true })).status).toBe(200);
  });

  it("device-targeted actions reach only the named paired display on the SSE stream", async () => {
    const tokenA = randomBytes(24).toString("hex");
    const tokenB = randomBytes(24).toString("hex");
    const ids = (
      await pool().query(
        `INSERT INTO arena_devices (label, token_hash, paired_at) VALUES ('Display A', $1, NOW()), ('Display B', $2, NOW()) RETURNING id`,
        [sha256(tokenA), sha256(tokenB)],
      )
    ).rows.map((r) => r.id as string);
    const open = async (token: string | null) => {
      const ctl = new AbortController();
      const r = new Request("http://arena.test/api/arena/stream", { headers: token ? { cookie: `${deviceCookieName()}=${token}`, host: "arena.test" } : { host: "arena.test" }, signal: ctl.signal });
      const { NextRequest } = await import("next/server");
      const res = await stream(new NextRequest(r));
      const reader = res.body!.getReader();
      let text = "";
      const pump = (async () => {
        for (;;) {
          const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
          if (done) break;
          text += new TextDecoder().decode(value);
        }
      })();
      return { read: () => text, close: async () => (ctl.abort(), reader.cancel().catch(() => {}), await pump.catch(() => {})) };
    };
    const a = await open(tokenA);
    const b = await open(tokenB);
    const anon = await open(null);
    await new Promise((r) => setTimeout(r, 200));
    __resetCubRate();
    const r1 = await send({ action: "dance", target: { scope: "devices", devices: [ids[0]] } });
    expect(r1.status).toBe(200);
    const id1 = (await r1.json()).command.id;
    __resetCubRate();
    const r2 = await send({ action: "wave", target: { scope: "all" } });
    const id2 = (await r2.json()).command.id;
    await new Promise((r) => setTimeout(r, 300));
    expect(a.read()).toContain(id1);
    expect(a.read()).toContain(id2);
    expect(b.read()).not.toContain(id1); // not for display B
    expect(b.read()).toContain(id2);
    expect(anon.read()).not.toContain(id1); // unpaired screens never get device-targeted actions
    expect(anon.read()).toContain(id2);
    expect(a.read()).not.toContain(ids[1]); // other displays' ids are not leaked
    await Promise.all([a.close(), b.close(), anon.close()]);
  });
});
