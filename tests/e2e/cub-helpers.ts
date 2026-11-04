import { expect, type BrowserContext, type Page, type Route } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";

/** Shared Arena Cub e2e helpers: a Live Arena display whose stream, activity and cub config the test controls. */
export const SHOTS = "playwright-report/arena-cub"; // gitignored; test-results is wiped on every run
mkdirSync(SHOTS, { recursive: true });

export const ALWAYS_ON = { allowOnLiveArena: true, activeStart: "00:00", activeEnd: "23:59", activeDays: [0, 1, 2, 3, 4, 5, 6], introFrequency: "off", feedingSec: 3, bonusSec: 4, bubbleSec: 4, reminderCooldownMin: 0 };
export const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
export const sse = (type: string, payload: unknown) => `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;

interface RigState {
  cub: Record<string, unknown>;
  lastSaleAt: string | null | undefined;
  /** Last sale this many minutes before the display FIRST asks for activity (then frozen, like the server). */
  saleMinsAgo?: number;
  mode?: string;
  events: string;
  /** Deprecated (kept for old call sites): delivery is now controlled by stream(events, times). */
  retry?: number;
  /** How many more connections should receive the events (each reconnect = one redelivery). */
  deliveries: number;
  /** Connections served since the last open(). */
  served: number;
}

/** A Live Arena display (no admin session) whose stream, activity and cub config are controlled by the test. */
export async function rig(page: Page) {
  const st: RigState = { cub: {}, lastSaleAt: undefined, events: "", deliveries: 0, served: 0 };
  const safe = (fn: (r: Route) => Promise<void>) => async (route: Route) => {
    try {
      await fn(route);
    } catch {
      await route.continue().catch(() => {});
    }
  };
  // Fake Live Arena stream. The first connection of a page load only says "ready"; later connections
  // WAIT until the test has events to deliver (no reconnect storm: every reconnect makes the display
  // resync all live data, which used to stall slow loads), then deliver them, once per remaining delivery.
  await page.route("**/api/arena/stream", async (route) => {
    const body = (events: string) => ({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" }, body: `retry: 1000\n\nevent: ready\ndata: {}\n\n${events}` });
    if (st.served++ === 0) return route.fulfill(body("")).catch(() => {});
    const until = Date.now() + 10 * 60_000;
    while (st.deliveries <= 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
    if (st.deliveries <= 0) return route.abort().catch(() => {});
    st.deliveries--;
    await route.fulfill(body(st.events)).catch(() => {});
  });
  await page.route(
    "**/api/arena/config",
    safe(async (route) => {
      const res = await route.fetch();
      const j = await res.json();
      j.values.arenaCub = { ...j.values.arenaCub, enabled: true, ...ALWAYS_ON, ...st.cub };
      j.values.arenaEnabled = true;
      j.values.arenaModes = { daily: true, weekly: true, monthly: true, spin: true };
      if (st.mode) j.values.defaultArenaMode = st.mode;
      await route.fulfill({ status: 200, json: j });
    }),
  );
  // The startup payload carries the same config: patch it too, or whichever answer lands last would win.
  await page.route(
    "**/api/arena/mode",
    safe(async (route) => {
      const res = await route.fetch();
      const j = await res.json();
      if (j?.config?.values) {
        j.config.values.arenaCub = { ...j.config.values.arenaCub, enabled: true, ...ALWAYS_ON, ...st.cub };
        j.config.values.arenaEnabled = true;
        j.config.values.arenaModes = { daily: true, weekly: true, monthly: true, spin: true };
        if (st.mode) j.config.values.defaultArenaMode = st.mode;
      }
      await route.fulfill({ status: 200, json: j });
    }),
  );
  await page.route(
    "**/api/arena/cub",
    safe(async (route) => {
      if (st.lastSaleAt === undefined && st.saleMinsAgo !== undefined) st.lastSaleAt = minsAgo(st.saleMinsAgo);
      if (st.lastSaleAt === undefined) return route.continue();
      await route.fulfill({ json: { ok: true, lastSaleAt: st.lastSaleAt, serverNow: new Date().toISOString() } });
    }),
  );
  // Every pose the cub shows, in order (the root remounts when an act restarts).
  await page.addInitScript(() => {
    const w = window as unknown as { __poses: string[] };
    w.__poses = [];
    setInterval(() => {
      const el = document.querySelector('[data-testid="arena-cub"]') as HTMLElement | null;
      const p = el ? `${el.dataset.pose}${el.dataset.act ? ":" + el.dataset.act : ""}` : "none";
      if (w.__poses[w.__poses.length - 1] !== p) w.__poses.push(p);
    }, 80);
  });
  return {
    async open(o: Partial<RigState> = {}) {
      st.cub = o.cub ?? {};
      st.lastSaleAt = "lastSaleAt" in o ? o.lastSaleAt : undefined;
      st.saleMinsAgo = o.saleMinsAgo;
      st.mode = o.mode;
      st.events = "";
      st.deliveries = 0;
      st.served = 0;
      await page.goto("/");
      // Live data comes from the real upstream through the dev server: one reload if a load stalls.
      if (!(await page.locator("[data-arena-mode]").isVisible({ timeout: 45_000 }).catch(() => false))) {
        await page.waitForSelector("[data-arena-mode]", { timeout: 45_000 }).catch(async () => {
          await page.reload();
        });
      }
      await expect(page.locator("[data-arena-mode]")).toBeVisible({ timeout: 60_000 });
    },
    /** Delivers these events on the next connection, and again on each of the next (times - 1) reconnects. */
    stream(events: string, times = 1) {
      st.events = events;
      st.deliveries = times;
    },
    /** The last-sale time the display was actually given. */
    served: () => st.lastSaleAt,
  };
}
export const poses = (p: Page) => p.evaluate(() => (window as unknown as { __poses: string[] }).__poses);
export const cub = (p: Page) => p.getByTestId("arena-cub");
export async function cubClip(page: Page) {
  const b = (await page.getByTestId("arena-cub-root").boundingBox())!;
  const vw = page.viewportSize()!.width;
  const x = Math.max(0, b.x - 260);
  return { x, y: Math.max(0, b.y - 40), width: Math.min(b.width + 300, vw - x), height: b.height + 40 };
}

// ---------------------------------------------------------------- admin

export const csrfFor = (t: string) => createHash("sha256").update(`csrf:${t}`).digest("base64url");
export async function adminPut(admin: BrowserContext, baseURL: string, values: Record<string, unknown>) {
  const cookie = (await admin.cookies(baseURL)).find((c) => c.name.endsWith("sa_admin"))!;
  return admin.request.fetch("/api/admin/arena-config", {
    method: "PUT",
    headers: { "x-csrf-token": csrfFor(cookie.value), Origin: new URL(baseURL).origin, "content-type": "application/json" },
    data: { values },
  });
}


export async function adminPost(admin: BrowserContext, baseURL: string, url: string, data: unknown) {
  const cookie = (await admin.cookies(baseURL)).find((c) => c.name.endsWith("sa_admin"))!;
  return admin.request.fetch(url, {
    method: "POST",
    headers: { "x-csrf-token": csrfFor(cookie.value), Origin: new URL(baseURL).origin, "content-type": "application/json" },
    data,
  });
}

/** Horizontal offset of the moving cub from its home (0 when home). */
export const offsetX = (p: Page, testId = "arena-cub") =>
  p.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}-mover"]`);
    if (!el) return null;
    const t = getComputedStyle(el).transform;
    return !t || t === "none" ? 0 : new DOMMatrix(t).m41;
  }, testId);
