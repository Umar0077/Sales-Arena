// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { tierRows } from "@/components/arena/BonusTiers";
import { useRewardsStore, DEFAULT_PROGRAMS, REWARDS_STORAGE_KEY, type BonusProgram } from "@/store/rewards-store";

const prog = (salesRequired: number, amount: number, o: Partial<BonusProgram> = {}): BonusProgram =>
  ({ ...DEFAULT_PROGRAMS[0], id: `p${salesRequired}`, name: `T${salesRequired}`, salesRequired, amount, currency: "PKR", rewardType: "cash", stackable: true, ...o }) as BonusProgram;

describe("bonus tier strip", () => {
  it("shows each stackable tier with the running total an agent earns on reaching it", () => {
    const rows = tierRows([prog(4, 5000), prog(2, 2000), prog(5, 7000), prog(3, 3000)]);
    expect(rows.map((r) => [r.program.salesRequired, r.total])).toEqual([[2, 2000], [3, 5000], [4, 10000], [5, 17000]]);
  });
  it("never adds non-stackable or non-cash tiers to the running total", () => {
    const rows = tierRows([prog(2, 2000), prog(3, 3000, { stackable: false }), prog(4, 0, { rewardType: "physical", prizeLabel: "Headset" })]);
    expect(rows.map((r) => r.total)).toEqual([2000, null, null]);
  });
});

describe("live reward data is server-only", () => {
  it("a browser restore never brings back the demo '1 validated sale = Rs. 1,000' program", async () => {
    const live = [prog(2, 2000, { kind: "daily" }), prog(3, 3000, { kind: "daily" })];
    useRewardsStore.getState().setLivePrograms(live);
    // Another tab (or an old session) left the demo programs in localStorage.
    localStorage.setItem(REWARDS_STORAGE_KEY, JSON.stringify({ state: { programs: DEFAULT_PROGRAMS, awards: [] }, version: 1 }));
    await useRewardsStore.persist.rehydrate();
    const programs = useRewardsStore.getState().programs;
    expect(programs.map((p) => p.salesRequired)).toEqual([2, 3]);
    expect(programs.some((p) => p.id === "prog_daily")).toBe(false);
    // And nothing is written back to the browser in live mode.
    useRewardsStore.getState().setLivePrograms(live);
    expect(JSON.parse(localStorage.getItem(REWARDS_STORAGE_KEY) ?? "{}").state?.programs).toBeUndefined();
  });
});
