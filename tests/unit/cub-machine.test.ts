import { describe, it, expect } from "vitest";
import { DEFAULT_CUB, validateCub, readCub, CubConfigError, type ArenaCubConfig } from "@/shared/cub/config";
import { ambient, activeWindow, enqueue, interrupts, isFreshSale, RecentIds, reminderMoments, shouldPlayIntro, cubVisibleOn, zonedClock, MAX_QUEUE, type CubAct } from "@/frontend/cub/machine";
import { bonusLines, feedingLines, phrase, PHRASES } from "@/frontend/cub/phrases";
import { charHeight, homeFor, movePlan, roamPick, CHAR_BOX, bubbleSideFor } from "@/frontend/cub/motion";
import { CUB_ACTIONS, isCubCommand } from "@/shared/cub/actions";
import { validatePatch } from "@/backend/settings/arena-config";

const cfg = (p: Partial<ArenaCubConfig> = {}): ArenaCubConfig => ({ ...DEFAULT_CUB, activeStart: "00:00", activeEnd: "23:59", activeDays: [0, 1, 2, 3, 4, 5, 6], ...p });
// Tue 2026-11-03 15:00 UTC = 10:00 New York (EST) = 20:00 Karachi.
const NOW = new Date("2026-11-03T15:00:00Z");
const ago = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe("config validation", () => {
  it("accepts defaults and partial values; refuses unknown keys and bad timing order", () => {
    expect(validateCub({})).toEqual(DEFAULT_CUB);
    expect(validateCub({ hungerMin: 10, angryMin: 20, sadMin: 25 }).sadMin).toBe(25);
    expect(() => validateCub({ hungerMin: 40, angryMin: 30 })).toThrow(/hungry time must come before/);
    expect(() => validateCub({ sadMin: 20 })).toThrow(CubConfigError);
    expect(() => validateCub({ nope: 1 })).toThrow(/not an Arena Cub setting/);
    expect(() => validateCub({ activeStart: "25:00" })).toThrow(/time/);
    expect(() => validateCub({ activeStart: "09:00", activeEnd: "09:00" })).toThrow(/different/);
    expect(() => validateCub({ activeDays: [7] })).toThrow(/weekdays/);
    expect(() => validateCub({ screens: { daily: "yes" } })).toThrow(/on or off/);
    expect(() => validateCub({ size: 5000 })).toThrow(/between/);
    expect(readCub({ hungerMin: 99, angryMin: 1 })).toEqual(DEFAULT_CUB); // a broken cache falls back safely
  });

  it("is a validated global setting on the server: a PARTIAL change (only the keys sent), each key checked", () => {
    // Only what was sent comes back: other stored settings (e.g. the Live Arena permission) are never touched.
    expect(validatePatch({ arenaCub: { position: "bottom-left" } }).arenaCub).toEqual({ position: "bottom-left" });
    expect(validatePatch({ arenaCub: { ...DEFAULT_CUB, enabled: false } }).arenaCub).toMatchObject({ enabled: false });
    expect(() => validatePatch({ arenaCub: { position: "top" } })).toThrow(/arenaCub position must be one of/);
    expect(() => validatePatch({ arenaCub: { hackerField: 1 } })).toThrow(/not an Arena Cub setting/);
    // Rules across keys (hungry < angry < sad) are enforced by saveArenaConfig on the merged result.
    expect(() => validatePatch({ arenaCub: { angryMin: 10 } })).not.toThrow();
  });
});

describe("business clock and active hours (business timezone, never the viewer's)", () => {
  it("computes weekday and minutes in the configured timezone", () => {
    expect(zonedClock(NOW, "America/New_York")).toMatchObject({ dow: 2, minutes: 600, day: "2026-11-03" });
    expect(zonedClock(NOW, "Asia/Karachi")).toMatchObject({ dow: 2, minutes: 1200 });
  });
  it("same instant: active in New York (10:00) but asleep in Karachi (20:00) for 09:00–18:00", () => {
    const c = cfg({ activeStart: "09:00", activeEnd: "18:00" });
    expect(activeWindow(NOW, c, "America/New_York")).toEqual({ active: true, startedAt: new Date("2026-11-03T14:00:00Z") });
    expect(activeWindow(NOW, c, "Asia/Karachi").active).toBe(false);
  });
  it("supports overnight windows and active days", () => {
    const c = cfg({ activeStart: "18:00", activeEnd: "02:00", activeDays: [2] });
    expect(activeWindow(new Date("2026-11-03T19:30:00Z"), c, "UTC")).toMatchObject({ active: true });
    expect(activeWindow(new Date("2026-11-04T01:30:00Z"), c, "UTC")).toMatchObject({ active: true, startedAt: new Date("2026-11-03T18:00:00Z") }); // Wed 01:30 belongs to Tue
    expect(activeWindow(new Date("2026-11-04T19:30:00Z"), c, "UTC").active).toBe(false); // Wednesday not active
  });
});

describe("ambient mood from the shared last-sale time", () => {
  const tz = "UTC";
  it("idle → hungry → angry → brief sad → resting", () => {
    const m = (mins: number) => ambient({ now: NOW, lastSaleAt: ago(mins), dataOk: true, cfg: cfg(), tz }).mood;
    expect([m(0), m(14.9), m(15), m(29), m(30), m(44), m(45), m(46.9), m(47), m(300)]).toEqual(["idle", "idle", "hungry", "hungry", "angry", "angry", "sad", "sad", "resting", "resting"]);
  });
  it("disabled states fall back gently; hunger off keeps it content", () => {
    expect(ambient({ now: NOW, lastSaleAt: ago(35), dataOk: true, cfg: cfg({ angry: false }), tz }).mood).toBe("hungry");
    expect(ambient({ now: NOW, lastSaleAt: ago(45.5), dataOk: true, cfg: cfg({ sad: false }), tz }).mood).toBe("resting");
    expect(ambient({ now: NOW, lastSaleAt: ago(120), dataOk: true, cfg: cfg({ hunger: false }), tz })).toMatchObject({ mood: "idle", reminder: null });
  });
  it("counts only inside active hours: a sale yesterday does not make the cub sad at opening time", () => {
    const c = cfg({ activeStart: "14:50", activeEnd: "23:00" });
    expect(ambient({ now: NOW, lastSaleAt: ago(24 * 60), dataOk: true, cfg: c, tz }).mood).toBe("idle"); // 10 min since opening
    expect(ambient({ now: NOW, lastSaleAt: null, dataOk: true, cfg: c, tz }).quietMin).toBe(10);
  });
  it("asleep outside active hours and neutral when live data is unavailable (never a false 'no sales')", () => {
    expect(ambient({ now: NOW, lastSaleAt: ago(300), dataOk: true, cfg: cfg({ activeDays: [] }), tz })).toMatchObject({ mood: "sleeping", reminder: null });
    expect(ambient({ now: NOW, lastSaleAt: ago(300), dataOk: false, cfg: cfg(), tz })).toMatchObject({ mood: "idle", reminder: null });
  });
  it("reminders at 15 / 30 / 45 then every 15 min, only while fresh, same key on every display", () => {
    expect(reminderMoments(cfg(), 100)).toEqual([15, 30, 45, 60, 75, 90]);
    expect(reminderMoments(cfg({ reminderEveryMin: 20 }), 70)).toEqual([15, 30, 35, 45, 55]);
    const at = (mins: number) => ambient({ now: NOW, lastSaleAt: ago(mins), dataOk: true, cfg: cfg(), tz }).reminder;
    expect(at(15.5)).toEqual({ mood: "hungry", key: `${ago(15.5).toISOString()}@15` });
    expect(at(18)).toBeNull(); // stale moment: a display opened later does not replay it
    expect(at(30.2)?.mood).toBe("angry");
    expect(at(45.1)?.mood).toBe("sad");
    expect(at(60.5)?.mood).toBe("hungry"); // later reminders stay gentle (no repeated crying)
  });
});

describe("celebration queue, dedupe and intro", () => {
  const sale = (id: string) => ({ caseId: id, agentName: `Agent ${id}`, validatedAt: NOW.toISOString() });
  it("bonus > feeding > intro > reminder; bursts coalesce without losing the count; bounded", () => {
    let q: CubAct[] = [];
    q = enqueue(q, { kind: "intro" });
    q = enqueue(q, { kind: "feeding", sales: [sale("A")] });
    q = enqueue(q, { kind: "feeding", sales: [sale("B"), sale("A")] });
    q = enqueue(q, { kind: "bonus", awards: [{ id: "w1", agentName: "X", kind: "daily", amount: 2000, currency: "PKR" }] });
    q = enqueue(q, { kind: "reminder", mood: "hungry", key: "k" }); // never queued behind real events
    expect(q.map((a) => a.kind)).toEqual(["bonus", "feeding", "intro"]);
    expect((q[1] as Extract<CubAct, { kind: "feeding" }>).sales.map((s) => s.caseId)).toEqual(["A", "B"]);
    for (let i = 0; i < 20; i++) q = enqueue(q, { kind: "feeding", sales: [sale(`S${i}`)] });
    expect(q.length).toBeLessThanOrEqual(MAX_QUEUE);
    expect((q.find((a) => a.kind === "feeding") as Extract<CubAct, { kind: "feeding" }>).sales).toHaveLength(22);
  });
  it("a real sale or bonus interrupts an intro or reminder, never another celebration", () => {
    const feed: CubAct = { kind: "feeding", sales: [sale("A")] };
    expect(interrupts({ kind: "reminder", mood: "hungry", key: "k" }, feed)).toBe(true);
    expect(interrupts({ kind: "intro" }, { kind: "bonus", awards: [] })).toBe(true);
    expect(interrupts(feed, { kind: "bonus", awards: [] })).toBe(false);
    expect(interrupts(null, feed)).toBe(false);
  });
  it("only fresh live sales feed (imports and late historical finds never do)", () => {
    const now = NOW.getTime();
    expect(isFreshSale({ source: "sse", validatedAt: ago(1).toISOString() }, now)).toBe(true);
    expect(isFreshSale({ source: "reconciliation", validatedAt: ago(10).toISOString() }, now)).toBe(true);
    expect(isFreshSale({ source: "backfill", validatedAt: ago(1).toISOString() }, now)).toBe(false);
    expect(isFreshSale({ source: "reconciliation", validatedAt: ago(120).toISOString() }, now)).toBe(false);
    expect(isFreshSale({ source: "sse", validatedAt: "garbage" }, now)).toBe(false);
  });
  it("bounded memory of celebrated ids", () => {
    const r = new RecentIds(3);
    expect([r.add("a"), r.add("a"), r.add("b"), r.add("c"), r.add("d")]).toEqual([true, false, true, true, true]);
    expect(r.has("a")).toBe(false); // evicted
    expect(r.size).toBe(3);
  });
  it("intro frequency per display (business day, not the viewer's day)", () => {
    expect(shouldPlayIntro("off", null, NOW, "UTC")).toBe(false);
    expect(shouldPlayIntro("every_load", NOW.getTime(), NOW, "UTC")).toBe(true);
    expect(shouldPlayIntro("hourly", ago(30).getTime(), NOW, "UTC")).toBe(false);
    expect(shouldPlayIntro("hourly", ago(61).getTime(), NOW, "UTC")).toBe(true);
    expect(shouldPlayIntro("daily", ago(60).getTime(), NOW, "UTC")).toBe(false);
    // 23:30 → 00:30 Karachi time is a new business day there.
    expect(shouldPlayIntro("daily", new Date("2026-11-03T18:30:00Z").getTime(), new Date("2026-11-03T19:30:00Z"), "Asia/Karachi")).toBe(true);
  });
  it("public visibility needs the Live Arena permission first (OFF by default), then the switches", () => {
    expect(DEFAULT_CUB.allowOnLiveArena).toBe(false);
    expect(readCub({}).allowOnLiveArena).toBe(false); // a missing value is OFF
    expect(readCub({ allowOnLiveArena: "yes" }).allowOnLiveArena).toBe(false); // invalid → defaults (OFF)
    expect(cubVisibleOn(DEFAULT_CUB, "daily", true)).toBe(false);
    const allowed = { ...DEFAULT_CUB, allowOnLiveArena: true };
    expect(cubVisibleOn(allowed, "daily", true)).toBe(true);
    expect(cubVisibleOn(allowed, "spin", true)).toBe(false); // Spin & Win off by default
    expect(cubVisibleOn({ ...allowed, enabled: false }, "daily", true)).toBe(false);
    expect(cubVisibleOn(allowed, "daily", false)).toBe(false);
  });
  it("admin commands: priority below genuine celebrations, only the latest waits, never stacked", () => {
    const cmd = (id: string): CubAct => ({ kind: "command", id, action: "run_left" });
    let q: CubAct[] = [];
    q = enqueue(q, cmd("c1"));
    q = enqueue(q, cmd("c2"));
    q = enqueue(q, { kind: "feeding", sales: [sale("A")] });
    q = enqueue(q, { kind: "intro" });
    expect(q.map((a) => (a.kind === "command" ? a.id : a.kind))).toEqual(["feeding", "c2", "intro"]);
    expect(interrupts(cmd("x"), { kind: "feeding", sales: [] })).toBe(true); // a real sale stops a run
    expect(interrupts(cmd("x"), { kind: "bonus", awards: [] })).toBe(true);
    expect(interrupts({ kind: "feeding", sales: [] }, cmd("y"))).toBe(false); // never cuts a genuine celebration
    expect(interrupts({ kind: "reminder", mood: "hungry", key: "k" }, cmd("y"))).toBe(true);
    expect(interrupts(cmd("x"), cmd("y"))).toBe(true); // the newer admin action replaces the playing one
  });
});

describe("dialogue uses only real payloads", () => {
  it("feeding: agent first name, exact burst count", () => {
    expect(feedingLines([{ caseId: "1", agentName: "Hamna Nasir", validatedAt: "" }]).detail).toBe("Great work, Hamna!");
    expect(feedingLines([1, 2, 3].map((i) => ({ caseId: String(i), agentName: "x", validatedAt: "" }))).title).toBe("YUM! 3 validated sales!");
  });
  it("bonus: highest-tier total and real increase, never a sum of tiers; prizes never get an amount", () => {
    const up = bonusLines([{ id: "a", agentName: "Rehan Ali", kind: "daily", rewardType: "cash", amount: 3000, currency: "PKR", upgrade: true, previousAmount: 2000, incrementAmount: 1000 }]);
    expect(up).toEqual({ title: "Bonus upgraded!", detail: "Rehan: PKR 3,000 daily total (+PKR 1,000)" });
    expect(bonusLines([{ id: "b", agentName: "Ali", kind: "weekly", rewardType: "cash", amount: 8000, currency: "Rs." }]).detail).toBe("Ali earned the Rs. 8,000 weekly bonus!");
    const prize = bonusLines([{ id: "c", agentName: "Sara Khan", kind: "monthly", rewardType: "physical", amount: 0, currency: "PKR", prizeLabel: "Headphones" }]);
    expect(prize.detail).toBe("Sara won Headphones!");
    expect(JSON.stringify(prize)).not.toMatch(/PKR/);
  });
  it("reminder phrase is the same on every display for the same moment", () => {
    expect(phrase("hungry", "k@15")).toBe(phrase("hungry", "k@15"));
    expect(PHRASES.angry.join(" ")).not.toMatch(/lazy|bad|fail|skip/i);
  });
});

describe("size, home position and movement (computed from the real bounds)", () => {
  const big = { w: 1920, h: 1080, top: 64, badge: { x: 1630, y: 1012, w: 274, h: 56 } };

  it("is much bigger by default and scales per screen (no fixed coordinates)", () => {
    expect(charHeight(DEFAULT_CUB, big)).toBe(310); // 280–340 target at 1920×1080
    const at = (w: number, h: number) => charHeight(DEFAULT_CUB, { w, h });
    expect(at(1600, 900)).toBeGreaterThanOrEqual(240);
    expect(at(1600, 900)).toBeLessThanOrEqual(300);
    expect(at(1366, 768)).toBeGreaterThanOrEqual(200);
    expect(at(1366, 768)).toBeLessThanOrEqual(260);
    expect(at(1280, 720)).toBeGreaterThanOrEqual(180);
    expect(at(1280, 720)).toBeLessThanOrEqual(230);
    expect(at(390, 844)).toBeLessThanOrEqual(215); // phones: reduced
    expect(charHeight({ sizePreset: "xl", size: 0 }, big)).toBe(400);
    expect(charHeight({ sizePreset: "small", size: 0 }, big)).toBe(170);
    expect(charHeight({ sizePreset: "custom", size: 450 }, big)).toBe(450);
    expect(charHeight({ sizePreset: "custom", size: 100 }, big)).toBe(100);
    expect(() => validateCub({ size: 460 })).toThrow(/between/);
    expect(() => validateCub({ sizePreset: "huge" })).toThrow(/one of/);
  });

  it("home positions keep the cub fully inside the screen, below the header", () => {
    const screens = [big, { w: 1280, h: 720, top: 60, badge: null }, { w: 390, h: 844, top: 120, badge: null }];
    for (const position of ["bottom-right", "bottom-left", "bottom-center", "custom"] as const)
      for (const b of screens) {
        const h = homeFor({ ...DEFAULT_CUB, position, homeX: 0, homeY: 30 }, b);
        expect(h.left + h.boxW * CHAR_BOX.x0).toBeGreaterThanOrEqual(0);
        expect(h.left + h.boxW * CHAR_BOX.x1).toBeLessThanOrEqual(b.w);
        expect(h.top + h.boxH * CHAR_BOX.y0).toBeGreaterThanOrEqual(b.top - 1);
        expect(h.top + h.boxH * CHAR_BOX.y1).toBeLessThanOrEqual(b.h);
      }
    const br = homeFor(DEFAULT_CUB, big);
    expect(br.left + br.boxW * CHAR_BOX.x1).toBeLessThanOrEqual(big.badge.x); // beside the Go Connectivo badge
    expect(bubbleSideFor(br, big, 300)).toBe("left");
    expect(bubbleSideFor(homeFor({ ...DEFAULT_CUB, position: "bottom-left" }, big), big, 300)).toBe("right");
  });

  it("every run goes out, turns around and returns to exactly home, inside the screen", () => {
    const screens = [big, { w: 1280, h: 720, top: 60, badge: null }, { w: 390, h: 844, top: 120, badge: null }];
    for (const b of screens)
      for (const position of ["bottom-right", "bottom-left", "bottom-center"] as const) {
        const home = homeFor({ ...DEFAULT_CUB, position }, b);
        for (const a of ["run_left", "run_right", "run_across", "dash", "jump_run", "roam"] as const) {
          const p = movePlan(a, home, b, "cmd-1");
          expect(p.steps.map((s) => s.phase)).toEqual(["prep", "run", "turn", "run", "settle"]);
          expect(p.steps[p.steps.length - 1].x).toBe(0); // back home
          expect(p.totalMs).toBe(p.steps.reduce((n, s) => n + s.ms, 0));
          const far = p.steps[1].x;
          expect(home.left + home.boxW * CHAR_BOX.x0 + far).toBeGreaterThanOrEqual(0);
          expect(home.left + home.boxW * CHAR_BOX.x1 + far).toBeLessThanOrEqual(b.w);
          if (a === "run_left") expect(far).toBeLessThanOrEqual(0);
          if (a === "run_right") expect(far).toBeGreaterThanOrEqual(0);
          expect(p.steps[3].dir).toBe(-p.steps[1].dir); // turns around to come back
        }
      }
    const home = homeFor(DEFAULT_CUB, big);
    const across = movePlan("run_across", home, big);
    expect(Math.abs(across.steps[1].x)).toBeGreaterThan(big.w * 0.6); // really crosses the dashboard
    const dash = movePlan("dash", home, big);
    expect(Math.abs(dash.steps[1].x)).toBeLessThanOrEqual(big.w * 0.3);
    expect(dash.steps[1].ms).toBeLessThan(across.steps[1].ms);
    expect(movePlan("jump_run", home, big).steps[1].hops).toBe(true);
  });

  it("random playful run is the same pattern on every screen for the same command", () => {
    expect(roamPick("abc")).toBe(roamPick("abc"));
    expect(new Set(Array.from({ length: 40 }, (_, i) => roamPick("id-" + i))).size).toBeGreaterThan(2);
  });

  it("only allowlisted action names exist", () => {
    expect(isCubCommand("run_left")).toBe(true);
    expect(isCubCommand("stop")).toBe(true);
    expect(isCubCommand("<script>")).toBe(false);
    expect(isCubCommand("constructor")).toBe(false);
    expect(CUB_ACTIONS.length).toBe(22);
  });
});
