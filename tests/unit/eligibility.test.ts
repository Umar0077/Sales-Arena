import { describe, it, expect } from "vitest";
import { computeSpinCredit, previewRule } from "@/features/targets/eligibility";
import { createSeedData } from "@/lib/mock-api/seed";

describe("Target Rules & Spin Credit Eligibility", () => {
  it("calculates spin credits earned based on rule threshold", () => {
    expect(previewRule({ salesPerSpin: 3, enabled: true }, 9)).toBe(3);
    expect(previewRule({ salesPerSpin: 3, enabled: true }, 8)).toBe(2);
    expect(previewRule({ salesPerSpin: 3, enabled: true }, 2)).toBe(0);
    expect(previewRule({ salesPerSpin: 4, enabled: true }, 16)).toBe(4);
  });

  it("yields zero earned credits if the target rule is disabled", () => {
    expect(previewRule({ salesPerSpin: 3, enabled: false }, 12)).toBe(0);
  });

  it("calculates available credits taking used and bonus spins into account", () => {
    const data = createSeedData();
    const agent = data.agents[0];

    // Grant 2 bonus credits
    data.bonusCredits[agent.id] = 2;

    const credit = computeSpinCredit(data, agent.id);
    expect(credit.available).toBeGreaterThanOrEqual(2);
    expect(credit.agentId).toBe(agent.id);
  });
});
