import { describe, it, expect } from "vitest";
import { selectReward, seededRandom } from "@/features/spins/selector";
import { validateReward, validateWheel } from "@/features/rewards/validation";
import type { Reward } from "@/types";

const MOCK_REWARDS: Reward[] = [
  { id: "1", title: "Trophy", description: "", icon: "trophy", color: "#FFC857", active: true, quantity: 10, weight: 1, order: 0 },
  { id: "2", title: "Voucher", description: "", icon: "ticket", color: "#36E0B5", active: true, quantity: 10, weight: 2, order: 1 },
  { id: "3", title: "Headset", description: "", icon: "headphones", color: "#7568FF", active: true, quantity: 0, weight: 5, order: 2 }, // Out of stock!
  { id: "4", title: "Merch", description: "", icon: "package", color: "#27D5FF", active: false, quantity: 10, weight: 2, order: 3 }, // Inactive!
];

describe("Reward Selector & Validation", () => {
  it("never selects out of stock or inactive rewards", () => {
    const issued = new Map<string, number>();
    for (let i = 0; i < 50; i++) {
      const selected = selectReward(MOCK_REWARDS, issued, Math.random);
      expect(selected).not.toBeNull();
      expect(selected?.id).not.toBe("3"); // Out of stock
      expect(selected?.id).not.toBe("4"); // Inactive
    }
  });

  it("produces deterministic results with seeded RNG", () => {
    const issued = new Map<string, number>();
    const rng1 = seededRandom(42, "agt_1", 1);
    const rng2 = seededRandom(42, "agt_1", 1);

    const r1 = selectReward(MOCK_REWARDS, issued, rng1);
    const r2 = selectReward(MOCK_REWARDS, issued, rng2);

    expect(r1?.id).toBe(r2?.id);
  });

  it("validates minimum and maximum wheel segment bounds (4-12 segments)", () => {
    const few = MOCK_REWARDS.slice(0, 2);
    expect(validateWheel(few).valid).toBe(false);

    const validSet: Reward[] = Array.from({ length: 8 }, (_, i) => ({
      id: `r_${i}`,
      title: `Prize ${i}`,
      description: "",
      icon: "trophy",
      color: "#FFC857",
      active: true,
      quantity: 10,
      weight: 1,
      order: i,
    }));
    expect(validateWheel(validSet).valid).toBe(true);

    const tooMany: Reward[] = Array.from({ length: 14 }, (_, i) => ({
      id: `r_${i}`,
      title: `Prize ${i}`,
      description: "",
      icon: "trophy",
      color: "#FFC857",
      active: true,
      quantity: 10,
      weight: 1,
      order: i,
    }));
    expect(validateWheel(tooMany).valid).toBe(false);
  });

  it("validates reward title length constraints for legibility", () => {
    const draft = {
      title: "This title is far too long for a readable 3D wheel segment",
      description: "Desc",
      icon: "trophy" as const,
      color: "#7568FF",
      active: true,
      quantity: 10,
      weight: 1,
    };
    const res = validateReward(draft, []);
    expect(res.valid).toBe(false);
    expect(res.errors.title).toBeDefined();
  });
});
