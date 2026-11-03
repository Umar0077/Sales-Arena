import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CubDirector, type CubView } from "@/lib/cub/director";
import { DEFAULT_CUB, type ArenaCubConfig } from "@/lib/cub/config";

const cfg = (p: Partial<ArenaCubConfig> = {}): ArenaCubConfig => ({ ...DEFAULT_CUB, feedingSec: 5, bonusSec: 6, bubbleSec: 4, reminderCooldownMin: 5, ...p });
const sale = (id: string, name = "Hamna Nasir") => ({ kind: "feeding" as const, sales: [{ caseId: id, agentName: name, validatedAt: new Date().toISOString() }] });
const award = { kind: "bonus" as const, awards: [{ id: "aw1", agentName: "Rehan Ali", kind: "daily" as const, rewardType: "cash", amount: 3000, currency: "PKR", upgrade: true, previousAmount: 2000, incrementAmount: 1000 }] };

describe("CubDirector", () => {
  let views: CubView[];
  let sounds: string[];
  let d: CubDirector;
  const last = () => views[views.length - 1];
  const make = (c = cfg()) => new CubDirector(c, { now: () => Date.now(), render: (v) => views.push(v), sound: (k) => sounds.push(k) });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T15:00:00Z"));
    views = [];
    sounds = [];
    d = make();
  });
  afterEach(() => {
    d.dispose();
    vi.useRealTimers();
  });

  it("feeding plays once, shows the real agent, then returns to the mood", () => {
    d.setMood("hungry");
    d.push(sale("C1"));
    expect(last().pose).toBe("feeding");
    vi.advanceTimersByTime(1500);
    expect(last().bubble?.detail).toBe("Great work, Hamna!");
    vi.advanceTimersByTime(3600);
    expect(last().pose).toBe("hungry");
    expect(sounds).toEqual(["feeding"]);
  });

  it("a sale stops a hungry reminder cleanly and plays feeding", () => {
    d.setMood("hungry");
    expect(d.push({ kind: "reminder", mood: "hungry", key: "k1" })).toBe(true);
    expect(last()).toMatchObject({ pose: "hungry", act: "reminder" });
    vi.advanceTimersByTime(1000);
    d.push(sale("C1"));
    expect(last()).toMatchObject({ pose: "feeding", act: null });
    vi.advanceTimersByTime(10_000);
    expect(last()).toMatchObject({ pose: "hungry", act: null });
  });

  it("sale + bonus together: bonus first, no overlap, then the sale", () => {
    d.setBlocked(true); // e.g. the bonus popup is on screen
    d.push(sale("C1"));
    d.push(award);
    expect(views.filter((v) => v.pose !== "idle")).toHaveLength(0);
    d.setBlocked(false);
    expect(last().pose).toBe("bonus");
    vi.advanceTimersByTime(300);
    expect(last().bubble).toEqual({ title: "Bonus upgraded!", detail: "Rehan: PKR 3,000 daily total (+PKR 1,000)" });
    vi.advanceTimersByTime(6000);
    expect(last().pose).toBe("feeding");
    vi.advanceTimersByTime(5000);
    expect(last().pose).toBe("idle");
    expect(sounds).toEqual(["bonus", "feeding"]);
  });

  it("a burst of sales is coalesced into the next celebration with the exact count", () => {
    d.push(sale("A"));
    for (const id of ["B", "C", "D"]) d.push(sale(id));
    vi.advanceTimersByTime(5000);
    expect(last().pose).toBe("feeding");
    vi.advanceTimersByTime(1500);
    expect(last().bubble).toEqual({ title: "YUM! 3 validated sales!", detail: "Great work, team!" });
    vi.advanceTimersByTime(4000);
    expect(d.state.queue).toHaveLength(0);
  });

  it("reminders respect the cooldown and never stack", () => {
    d.push(sale("A"));
    vi.advanceTimersByTime(5000);
    expect(d.push({ kind: "reminder", mood: "hungry", key: "k" })).toBe(false); // within 5 min of the celebration
    vi.advanceTimersByTime(5 * 60_000);
    expect(d.push({ kind: "reminder", mood: "hungry", key: "k" })).toBe(true);
    expect(d.push({ kind: "reminder", mood: "hungry", key: "k2" })).toBe(false); // one at a time
  });

  it("switched-off acts never play; disabling mid-act stops it; hiding drops pending celebrations", () => {
    d.setConfig(cfg({ feeding: false }));
    expect(d.push(sale("A"))).toBe(false);
    d.setConfig(cfg());
    d.push({ kind: "intro" });
    d.setConfig(cfg({ enabled: false }));
    expect(d.state.playing).toBeNull();
    d.setConfig(cfg());
    d.setBlocked(true);
    d.push(sale("B"));
    d.setVisible(false);
    expect(d.state.queue).toHaveLength(0);
    expect(d.push(sale("C"))).toBe(false);
  });

  it("speech can be switched off per category", () => {
    d.setConfig(cfg({ dialogue: { ...DEFAULT_CUB.dialogue, feeding: false } }));
    d.push(sale("A"));
    vi.advanceTimersByTime(2000);
    expect(last().bubble).toBeNull();
  });

  const cmd = (action: Parameters<typeof d.push>[0] extends infer A ? (A extends { kind: "command"; action: infer X } ? X : never) : never, id = `c-${action}`, expiresAt?: number) =>
    ({ kind: "command" as const, id, action, expiresAt });

  it("admin run: plays for the screen's move duration, then home and back to the mood", () => {
    d.dispose();
    d = new CubDirector(cfg(), { now: () => Date.now(), render: (v) => views.push(v), moveSec: () => 4 });
    d.setMood("hungry");
    d.push(cmd("run_across"));
    expect(last()).toMatchObject({ pose: "run", command: { action: "run_across" } });
    vi.advanceTimersByTime(3900);
    expect(last().pose).toBe("run");
    vi.advanceTimersByTime(200);
    expect(last()).toMatchObject({ pose: "hungry", command: null, bubble: null });
  });

  it("a genuine sale interrupts a run (feeding next); a genuine bonus waits ahead of a queued admin action", () => {
    d.push(cmd("run_left"));
    vi.advanceTimersByTime(800);
    d.push(sale("REAL-1"));
    expect(last()).toMatchObject({ pose: "feeding", command: null });
    d.setBlocked(true);
    vi.advanceTimersByTime(6000);
    d.push(cmd("dance"));
    d.push(award);
    d.setBlocked(false);
    expect(last().pose).toBe("bonus");
    vi.advanceTimersByTime(6100);
    expect(last().pose).toBe("dance");
  });

  it("an admin action replaces a reminder; stop / home / reset end it and clear waiting actions", () => {
    d.setMood("hungry");
    d.push({ kind: "reminder", mood: "hungry", key: "k1" });
    d.push(cmd("jump"));
    expect(last().pose).toBe("jump");
    d.push(cmd("dance", "c-2")); // a newer admin action replaces the playing one
    expect(last().pose).toBe("dance");
    d.utility("stop");
    expect(last()).toMatchObject({ pose: "hungry", command: null });
    expect(d.state.queue).toHaveLength(0);
    d.push(cmd("wave", "c-3"));
    d.utility("home");
    expect(last().command).toBeNull();
    d.push(cmd("sleep", "c-4"));
    d.utility("reset");
    expect(last()).toMatchObject({ pose: "hungry", command: null });
  });

  it("stop never cuts a genuine celebration", () => {
    d.push(sale("REAL-2"));
    d.utility("stop");
    expect(last().pose).toBe("feeding");
  });

  it("expired commands are dropped (on arrival or while waiting)", () => {
    expect(d.push(cmd("dance", "old", Date.now() - 1))).toBe(false);
    d.push(sale("REAL-3"));
    d.push(cmd("dance", "soon", Date.now() + 2000)); // waits behind the sale, expires meanwhile
    vi.advanceTimersByTime(5100);
    expect(last().pose).toBe("idle");
  });

  it("greeting: three readable lines over ~13 s, then home", () => {
    d.push(cmd("greet"));
    expect(last().pose).toBe("greet");
    vi.advanceTimersByTime(2300);
    expect(last().bubble?.title).toMatch(/I'm Arena Cub/);
    vi.advanceTimersByTime(3600);
    expect(last().bubble?.title).toMatch(/genuine validated sale feeds me/);
    vi.advanceTimersByTime(3800);
    expect(last().bubble?.title).toBe("Let's keep the sales coming! ROAR!");
    vi.advanceTimersByTime(3400);
    expect(last()).toMatchObject({ pose: "idle", bubble: null });
  });

  it("manual feeding / celebrate never claim a sale or award", () => {
    d.push(cmd("eat_token"));
    vi.advanceTimersByTime(1600);
    expect(last().pose).toBe("feeding");
    expect(JSON.stringify(last().bubble)).not.toMatch(/validated sale|PKR|bonus/i);
    vi.advanceTimersByTime(5000);
    d.push(cmd("celebrate"));
    vi.advanceTimersByTime(400);
    expect(last().pose).toBe("bonus");
    expect(JSON.stringify(last().bubble)).not.toMatch(/PKR|earned|award|upgraded/i);
  });

  it("dispose clears every timer (no leaks after unmount)", () => {
    d.push({ kind: "intro" });
    d.push(sale("A"));
    expect(d.state.timers).toBeGreaterThan(0);
    const before = views.length;
    d.dispose();
    expect(d.state.timers).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(views.length).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
  });
});
