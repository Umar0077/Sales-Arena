import { randomBytes } from "node:crypto";

/**
 * Admin "Test Live Arena Sounds": a short, temporary audio test on the Live Arena displays and their real
 * acknowledgements. In memory only (bounded, expires after 5 minutes): it never touches sales, rewards, bonuses,
 * spins or the database. An acknowledgement is accepted only for a test that exists and has not expired, and (for a
 * test aimed at chosen displays) only from those paired displays, identified on the server by their device cookie.
 */
export const SOUND_TEST_EVENT = "arena.sound.test";
const TTL_MS = 5 * 60_000;
const MAX_TESTS = 20;
const MAX_ACKS = 100;

export interface SoundTestResult {
  played: boolean;
  reason: string;
  readiness: string;
  contextState: string;
  soundEnabled: boolean;
  volume: number;
  saleCategory: boolean;
  engineLoaded: boolean;
  trumpetDecoded: boolean;
  screen: string;
  browser: string;
}
export interface SoundTestAck {
  display: string;
  device: { id: string; label: string } | null;
  at: string;
  result: SoundTestResult;
}
export interface SoundTest {
  id: string;
  createdAt: number;
  by: string;
  target: { scope: "all" } | { scope: "devices"; devices: string[] };
  acks: SoundTestAck[];
}

const key = Symbol.for("sales_arena.sound_tests");
const g = globalThis as unknown as { [key]?: Map<string, SoundTest> };
const tests = (g[key] ??= new Map<string, SoundTest>());

function prune(now = Date.now()) {
  for (const [id, t] of tests) if (now - t.createdAt > TTL_MS) tests.delete(id);
  while (tests.size > MAX_TESTS) tests.delete(tests.keys().next().value as string);
}

export function createSoundTest(by: string, devices: string[] | null): SoundTest {
  prune();
  const t: SoundTest = {
    id: `st_${randomBytes(12).toString("hex")}`,
    createdAt: Date.now(),
    by,
    target: devices && devices.length ? { scope: "devices", devices: devices.slice(0, 50) } : { scope: "all" },
    acks: [],
  };
  tests.set(t.id, t);
  return t;
}

export function getSoundTest(id: string): SoundTest | null {
  prune();
  return tests.get(id) ?? null;
}

const str = (v: unknown, max = 80) => (typeof v === "string" ? v.slice(0, max) : "");

/** Records one display's acknowledgement. False when the test is unknown / expired or the display was not targeted. */
export function recordSoundTestAck(id: string, display: string, device: { id: string; label: string } | null, raw: unknown): boolean {
  const t = getSoundTest(id);
  if (!t || !display || display.length > 80) return false;
  if (t.target.scope === "devices" && (!device || !t.target.devices.includes(device.id))) return false;
  if (t.acks.length >= MAX_ACKS || t.acks.some((a) => a.display === display)) return false;
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  t.acks.push({
    display,
    device,
    at: new Date().toISOString(),
    result: {
      played: r.played === true,
      reason: str(r.reason, 200),
      readiness: str(r.readiness),
      contextState: str(r.contextState),
      soundEnabled: r.soundEnabled === true,
      volume: typeof r.volume === "number" && Number.isFinite(r.volume) ? Math.max(0, Math.min(1, r.volume)) : 0,
      saleCategory: r.saleCategory === true,
      engineLoaded: r.engineLoaded === true,
      trumpetDecoded: r.trumpetDecoded === true,
      screen: str(r.screen),
      browser: str(r.browser, 120),
    },
  });
  return true;
}
