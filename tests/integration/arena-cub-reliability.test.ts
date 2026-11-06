import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { PUT as putConfig } from "@/app/api/admin/arena-config/route";
import { GET as publicConfig } from "@/app/api/arena/config/route";
import { POST as command } from "@/app/api/admin/arena-cub/command/route";
import { GET as commandStatus } from "@/app/api/admin/arena-cub/command/[id]/route";
import { POST as ack } from "@/app/api/arena/cub/ack/route";
import { POST as login } from "@/app/api/admin/auth/login/route";
import { __resetCubRate } from "@/backend/cub/commands";
import { __resetAcks } from "@/backend/cub/acks";
import { DEFAULT_CUB } from "@/shared/cub/config";
import { createAdmin, pool, req, resetDatabase, sessionFrom } from "./helpers";

/** Arena Cub reliability on the server: partial saves never flip the public permission; delivery acknowledgments. */
let owner: { cookie: string; csrf: string };
const put = (arenaCub: Record<string, unknown>) => putConfig(req("/api/admin/arena-config", { method: "PUT", body: { values: { arenaCub } }, cookie: owner.cookie, csrf: owner.csrf }));
const stored = async () => (await (await publicConfig()).json()).values.arenaCub;

describe("Arena Cub reliability (server)", () => {
  beforeAll(async () => {
    await resetDatabase();
    await createAdmin();
    owner = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" } })));
  });
  beforeEach(() => {
    __resetCubRate();
    __resetAcks();
  });

  it("a partial save (e.g. home position) merges onto the STORED settings and never changes the public permission", async () => {
    expect((await put({ allowOnLiveArena: true, position: "bottom-right", sizePreset: "large" })).status).toBe(200);
    expect(await stored()).toMatchObject({ allowOnLiveArena: true, position: "bottom-right" });

    // What a stale admin tab used to do: only the position changes now.
    for (const position of ["bottom-left", "bottom-center", "custom", "bottom-right"]) {
      const r = await put({ position, homeX: 30, homeY: 90 });
      expect(r.status).toBe(200);
      const s = await stored();
      expect(s).toMatchObject({ allowOnLiveArena: true, position, homeX: 30, homeY: 90, sizePreset: "large" });
    }
    expect((await put({ sizePreset: "xl" })).status).toBe(200);
    expect(await stored()).toMatchObject({ allowOnLiveArena: true, sizePreset: "xl" });

    // Cross-key rules are checked on the merged result; nothing is saved when refused.
    const before = await stored();
    const bad = await put({ hungerMin: before.angryMin + 5 });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/hungry time must come before/);
    expect(await stored()).toEqual(before);
    expect((await put({ activeStart: before.activeEnd })).status).toBe(400);

    // Hide / show only via the permission key.
    expect((await put({ allowOnLiveArena: false })).status).toBe(200);
    expect(await stored()).toMatchObject({ allowOnLiveArena: false, sizePreset: "xl", position: "bottom-right" });
    expect((await put({ allowOnLiveArena: true })).status).toBe(200);
    expect((await stored()).allowOnLiveArena).toBe(true);
  });

  it("an install saved before this change (full object) still works; missing permission stays OFF", async () => {
    await pool().query(`UPDATE admin_settings SET value = jsonb_set(value, '{values,arenaCub}', $1::jsonb) WHERE key = 'arena.config'`, [JSON.stringify({ ...DEFAULT_CUB, allowOnLiveArena: undefined })]);
    expect((await stored()).allowOnLiveArena).toBe(false);
    expect((await put({ speech: false })).status).toBe(200);
    expect(await stored()).toMatchObject({ allowOnLiveArena: false, speech: false });
  });

  it("delivery evidence: displays acknowledge real recent commands only; admins read the counts", async () => {
    await put({ allowOnLiveArena: true, enabled: true });
    const sent = await command(req("/api/admin/arena-cub/command", { method: "POST", body: { action: "dance" }, cookie: owner.cookie, csrf: owner.csrf }));
    expect(sent.status).toBe(200);
    const id = (await sent.json()).command.id as string;
    const status = async () => (await (await commandStatus(req(`/api/admin/arena-cub/command/${id}`, { cookie: owner.cookie }), { params: Promise.resolve({ id }) })).json()).status;
    expect(await status()).toMatchObject({ action: "dance", started: 0, completed: 0 });

    const post = (body: unknown) => ack(req("/api/arena/cub/ack", { method: "POST", body }));
    expect((await post({ id, display: "d-display-one", phase: "started" })).status).toBe(200);
    expect((await post({ id, display: "d-display-one", phase: "started" })).status).toBe(200); // same display counted once
    expect((await post({ id, display: "d-display-two", phase: "started" })).status).toBe(200);
    expect((await post({ id, display: "d-display-one", phase: "completed" })).status).toBe(200);
    expect(await status()).toMatchObject({ started: 2, completed: 1, interrupted: 0 });

    // Junk is ignored: unknown ids, bad display ids, unknown phases, oversized bodies.
    expect((await post({ id: "00000000-0000-4000-8000-000000000000", display: "d-display-one", phase: "started" })).status).toBe(202);
    expect((await post({ id, display: "<script>", phase: "started" })).status).toBe(202);
    expect((await post({ id, display: "d-display-three", phase: "hacked" })).status).toBe(202);
    expect((await ack(req("/api/arena/cub/ack", { method: "POST", body: { id, pad: "x".repeat(600) } }))).status).toBe(413);
    expect(await status()).toMatchObject({ started: 2, completed: 1 });

    // Only admins can read delivery status.
    expect((await commandStatus(req(`/api/admin/arena-cub/command/${id}`), { params: Promise.resolve({ id }) })).status).toBe(401);
    // Nothing financial is touched.
    const n = (await pool().query(`SELECT (SELECT COUNT(*) FROM validated_sales)::int + (SELECT COUNT(*) FROM bonus_awards)::int + (SELECT COUNT(*) FROM spin_credit_transactions)::int AS n`)).rows[0].n;
    expect(n).toBe(0);
  });
});
