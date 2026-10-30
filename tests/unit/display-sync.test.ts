import { describe, it, expect, beforeEach } from "vitest";
import { applyGlobalDisplay, __resetDisplaySync } from "@/lib/live/display-sync";
import { useSettingsStore } from "@/store/settings-store";
import { useSpinFlowStore } from "@/store/spin-flow-store";
import { useLiveStore } from "@/store/live-store";

const quality = () => useSettingsStore.getState().quality;

describe("global performance mode on a display", () => {
  beforeEach(() => {
    __resetDisplaySync();
    useSpinFlowStore.getState().clear();
    useSettingsStore.getState().update({ quality: "high" }); // a legacy per-browser preference
  });

  it("Test C: the admin's global mode overrides an old local preference", () => {
    applyGlobalDisplay({ performanceMode: "performance", revision: 3 });
    expect(quality()).toBe("performance");
    expect(useLiveStore.getState().globalDisplay).toEqual({ performanceMode: "performance", revision: 3 });
    // Someone flips it locally; the next reconciliation of the SAME revision corrects it.
    useSettingsStore.getState().update({ quality: "high" });
    applyGlobalDisplay({ performanceMode: "performance", revision: 3 });
    expect(quality()).toBe("performance");
  });

  it("ignores older or duplicate revisions (no repeated re-initialisation)", () => {
    applyGlobalDisplay({ performanceMode: "performance", revision: 5 });
    let writes = 0;
    const off = useSettingsStore.subscribe(() => writes++);
    applyGlobalDisplay({ performanceMode: "performance", revision: 5 });
    applyGlobalDisplay({ performanceMode: "high", revision: 4 });
    off();
    expect(writes).toBe(0);
    expect(quality()).toBe("performance");
  });

  it("rejects invalid payloads", () => {
    applyGlobalDisplay({ performanceMode: "turbo" as never, revision: 9 });
    applyGlobalDisplay(null);
    expect(quality()).toBe("high");
  });

  it("Test E: a change during a wheel spin waits until the spin finishes", () => {
    useSpinFlowStore.setState({ stage: "spin", active: { id: "u1", agentId: "a", periodSales: 2, available: 1, reason: "target" } });
    applyGlobalDisplay({ performanceMode: "performance", revision: 7 });
    expect(quality()).toBe("high"); // not mid-spin
    useSpinFlowStore.getState().finish();
    expect(quality()).toBe("performance");
  });
});
