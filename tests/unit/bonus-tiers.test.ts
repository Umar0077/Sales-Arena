// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { useRewardsStore, DEFAULT_PROGRAMS, REWARDS_STORAGE_KEY, type BonusProgram } from "@/store/rewards-store";

const prog = (salesRequired: number, amount: number, o: Partial<BonusProgram> = {}): BonusProgram =>
  ({ ...DEFAULT_PROGRAMS[0], id: `p${salesRequired}`, name: `T${salesRequired}`, salesRequired, amount, currency: "PKR", rewardType: "cash", stackable: true, ...o }) as BonusProgram;

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
