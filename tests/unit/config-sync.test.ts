import { describe, it, expect, beforeEach } from "vitest";
import { applyArenaConfig, applyScreenSwitch, __resetConfigSync } from "@/lib/live/config-sync";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/store/settings-store";
import { useSpinFlowStore } from "@/store/spin-flow-store";
import { useArenaModeStore } from "@/store/arena-mode-store";
import { canAnnounce } from "@/components/rewards/RewardRuntime";
import { GLOBAL_SETTING_KEYS } from "@/lib/settings/global-keys";
import { GLOBAL_SETTING_KEYS as SERVER_KEYS, validatePatch } from "@/lib/server/settings/arena-config";

const s = () => useSettingsStore.getState();

describe("global arena config on a display", () => {
  beforeEach(() => {
    __resetConfigSync();
    useSpinFlowStore.getState().clear();
    useArenaModeStore.getState().setPicked(null);
    useSettingsStore.getState().reset();
  });

  it("the server config overrides old browser values and ignores older revisions", () => {
    useSettingsStore.getState().update({ showModeSelector: true, arenaEnabled: true }); // stale local copy
    applyArenaConfig({ revision: 4, values: { showModeSelector: false, arenaEnabled: false } }, { initial: true });
    expect(s().showModeSelector).toBe(false);
    expect(s().arenaEnabled).toBe(false);
    applyArenaConfig({ revision: 3, values: { arenaEnabled: true } }); // late, older delivery
    expect(s().arenaEnabled).toBe(false);
    useSettingsStore.getState().update({ arenaEnabled: true }); // local tampering
    applyArenaConfig({ revision: 4, values: { showModeSelector: false, arenaEnabled: false } }); // reconciliation
    expect(s().arenaEnabled).toBe(false);
  });

  it("duplicate deliveries of the same revision do not write the store again", () => {
    applyArenaConfig({ revision: 2, values: { brandTagline: "Live" } });
    let writes = 0;
    const off = useSettingsStore.subscribe(() => writes++);
    applyArenaConfig({ revision: 2, values: { brandTagline: "Live" } });
    off();
    expect(writes).toBe(0);
  });

  it("new displays open on the default; only an explicit switch moves open displays", () => {
    applyArenaConfig({ revision: 1, values: { defaultArenaMode: "weekly" }, screen: { screen: "monthly", revision: 5 } }, { initial: true });
    expect(useArenaModeStore.getState().picked).toBe("weekly"); // old switch is history for a new display
    applyArenaConfig({ revision: 2, values: { defaultArenaMode: "daily" } }); // default change: stays put
    expect(useArenaModeStore.getState().picked).toBe("weekly");
    applyScreenSwitch({ screen: "monthly", revision: 5 }); // duplicate
    expect(useArenaModeStore.getState().picked).toBe("weekly");
    applyScreenSwitch({ screen: "monthly", revision: 6 }); // admin pressed "Switch now"
    expect(useArenaModeStore.getState().picked).toBe("monthly");
  });

  it("disabling the screen a display is on moves it back to the default", () => {
    applyArenaConfig({ revision: 1, values: {} }, { initial: true });
    useArenaModeStore.getState().setPicked("weekly");
    applyArenaConfig({ revision: 2, values: { arenaModes: { daily: true, weekly: false, monthly: true, spin: true } } });
    expect(useArenaModeStore.getState().picked).toBeNull();
  });

  it("a change during a wheel spin waits until the spin finishes", () => {
    useSpinFlowStore.setState({ stage: "spin", active: { id: "u1", agentId: "a", periodSales: 2, available: 1, reason: "target" } });
    applyArenaConfig({ revision: 9, values: { spinnerTheme: "aurora" } });
    expect(s().spinnerTheme).toBe(DEFAULT_SETTINGS.spinnerTheme);
    useSpinFlowStore.getState().finish();
    expect(s().spinnerTheme).toBe("aurora");
  });
});

describe("reward announcements follow the admin switches", () => {
  const on = { arenaEnabled: true, celebrationPopups: true, announceCash: true, announcePrizes: true, rewardCategories: DEFAULT_SETTINGS.rewardCategories };
  it("Scenario E: hidden category, hidden program, cash/prize switches, arena off", () => {
    expect(canAnnounce({ kind: "daily", announce: true, rewardType: "cash" }, on)).toBe(true);
    expect(canAnnounce({ kind: "daily", announce: false, rewardType: "cash" }, on)).toBe(false);
    expect(canAnnounce({ kind: "daily", announce: true, rewardType: "cash" }, { ...on, rewardCategories: { ...on.rewardCategories, daily: { active: true, showOnArena: false } } })).toBe(false);
    expect(canAnnounce({ kind: "weekly", announce: true, rewardType: "physical" }, { ...on, announcePrizes: false })).toBe(false);
    expect(canAnnounce({ kind: "weekly", announce: true, rewardType: "cash" }, { ...on, announcePrizes: false })).toBe(true);
    expect(canAnnounce({ kind: "monthly", announce: true, rewardType: "cash" }, { ...on, arenaEnabled: false })).toBe(false);
    expect(canAnnounce({ kind: "monthly", announce: true, rewardType: "cash" }, { ...on, celebrationPopups: false })).toBe(false);
  });
});

describe("global settings schema", () => {
  it("client and server agree on which settings are global", () => {
    expect([...GLOBAL_SETTING_KEYS].sort()).toEqual([...SERVER_KEYS].sort());
  });
  it("every default value passes server validation", () => {
    const d = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
    expect(() => validatePatch(Object.fromEntries(SERVER_KEYS.map((k) => [k, d[k]])))).not.toThrow();
  });
  it("per-device settings are not global", () => {
    for (const k of ["diagnostics", "tvMode", "autoSimulate", "seededSpins", "quality"]) expect(GLOBAL_SETTING_KEYS as readonly string[]).not.toContain(k);
  });
});
