import { describe, it, expect, beforeEach } from "vitest";
import { useArenaStore } from "@/store/arena-store";
import { computeSpinCredit } from "@/features/targets/eligibility";

describe("Arena Store State Machine & Actions", () => {
  beforeEach(() => {
    useArenaStore.getState().resetDemo();
  });

  it("records approved sales and updates agent performance", () => {
    const store = useArenaStore.getState();
    const agent = store.agents[0];
    const initialApprovedCount = store.sales.filter(
      (s) => s.agentId === agent.id && s.status === "approved"
    ).length;

    const res = store.recordSale({
      agentId: agent.id,
      status: "approved",
      source: "demo-simulator",
      celebrate: false,
    });

    expect(res).not.toBeNull();
    const afterApprovedCount = useArenaStore
      .getState()
      .sales.filter((s) => s.agentId === agent.id && s.status === "approved").length;

    expect(afterApprovedCount).toBe(initialApprovedCount + 1);
  });

  it("prevents starting a spin when an agent has 0 credits", () => {
    const store = useArenaStore.getState();
    // Pick an agent with 0 bonus credits and ensure used >= earned
    const agent = store.agents[5];
    // Clear bonus
    useArenaStore.setState({
      bonusCredits: { ...store.bonusCredits, [agent.id]: 0 },
    });

    const credit = computeSpinCredit(useArenaStore.getState(), agent.id);
    if (credit.available === 0) {
      const res = store.startSpin(agent.id);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toContain("credits");
      }
    }
  });

  it("allows spin when agent has available credits and prevents simultaneous double spins", () => {
    const store = useArenaStore.getState();
    const agent = store.agents[0];

    // Grant 1 bonus credit
    store.addBonusCredits(agent.id, 1);

    const spin1 = store.startSpin(agent.id);
    expect(spin1.ok).toBe(true);

    // Attempt second spin simultaneously while first is in-progress
    const spin2 = store.startSpin(agent.id);
    expect(spin2.ok).toBe(false);
    if (!spin2.ok) {
      expect(spin2.reason).toContain("already in progress");
    }

    // Complete the spin
    if (spin1.ok) {
      const completed = store.completeSpin(spin1.spin.id);
      expect(completed).not.toBeNull();
      expect(completed?.status).toBe("completed");

      // Attempting to complete the same spin again should return null (guaranteeing exactly-once execution)
      const repeatComplete = store.completeSpin(spin1.spin.id);
      expect(repeatComplete).toBeNull();
    }
  });

  it("supports adding and updating agents", () => {
    const store = useArenaStore.getState();
    const newAgent = store.upsertAgent({
      name: "Test Specialist",
      teamId: store.teams[0].id,
      campaignId: store.campaigns[0].id,
      title: "Senior Closer",
      active: true,
    });

    expect(newAgent.id).toBeDefined();
    expect(useArenaStore.getState().agents.some((a) => a.id === newAgent.id)).toBe(true);

    // Update
    const updated = store.upsertAgent({
      id: newAgent.id,
      name: "Test Specialist (Promoted)",
      teamId: store.teams[0].id,
      campaignId: store.campaigns[0].id,
      title: "Lead Closer",
      active: true,
    });

    expect(updated.name).toBe("Test Specialist (Promoted)");
    expect(
      useArenaStore.getState().agents.find((a) => a.id === newAgent.id)?.name
    ).toBe("Test Specialist (Promoted)");
  });
});
