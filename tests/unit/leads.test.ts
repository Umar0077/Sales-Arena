import { describe, it, expect } from "vitest";
import { leadCountsByAgent, closedRate, rankClosers, closerCode } from "@/features/sales/leads";
import { computeSpinCredit } from "@/features/targets/eligibility";
import { detectNewUnlocks } from "@/components/arena/ArenaEventBridge";
import { createSeedData } from "@/lib/mock-api/seed";
import type { ArenaData } from "@/lib/mock-api/schema";
import type { Sale, SaleStatus } from "@/types";

let n = 0;
const lead = (agentId: string, status: SaleStatus, id = `L${n++}`): Sale => ({
  id,
  agentId,
  teamId: "t1",
  campaignId: "c1",
  status,
  product: "Policy",
  value: 50,
  createdAt: new Date().toISOString(),
  approvedAt: status === "approved" ? new Date().toISOString() : null,
  source: "demo-simulator",
});
const leads = (agentId: string, validated: number, others: SaleStatus[]) => [
  ...Array.from({ length: validated }, () => lead(agentId, "approved")),
  ...others.map((s) => lead(agentId, s)),
];

/** A clean data set: one agent, default rule = 2 validated sales per spin, no prior spins. */
function world(sales: Sale[]): ArenaData {
  const d = createSeedData();
  const agent = { ...d.agents[0], id: "A", teamId: "t1", active: true };
  return {
    ...d,
    agents: [agent],
    sales,
    spins: [],
    bonusCredits: {},
    history: { A: [] },
    targetRules: [{ id: "r", teamId: null, salesPerSpin: 2, period: "daily", enabled: true, teamDailyTarget: 50, agentDailyTarget: 5 }],
  };
}

describe("spin eligibility uses validated sales only", () => {
  it.each([
    { submitted: 5, validated: 1, spins: 0 },
    { submitted: 5, validated: 2, spins: 1 },
    { submitted: 8, validated: 4, spins: 2 },
  ])("$submitted submitted + $validated validated → $spins spin(s)", ({ submitted, validated, spins }) => {
    const unvalidated: SaleStatus[] = ["pending", "rejected", "duplicate"];
    const others = Array.from({ length: submitted - validated }, (_, i) => unvalidated[i % 3]);
    const data = world(leads("A", validated, others));
    expect(leadCountsByAgent(data.sales).get("A")).toMatchObject({ submitted, validated });
    expect(computeSpinCredit(data, "A").earned).toBe(spins);
  });

  it("pending, rejected and duplicate leads never earn spins", () => {
    const data = world(leads("A", 0, Array<SaleStatus>(10).fill("pending").concat(["rejected", "duplicate", "rejected"])));
    expect(computeSpinCredit(data, "A").earned).toBe(0);
  });

  it("a record repeated with the same id counts once", () => {
    const a = lead("A", "approved", "same");
    const data = world([a, a, lead("A", "approved")]);
    expect(leadCountsByAgent(data.sales).get("A")).toMatchObject({ submitted: 2, validated: 2 });
    expect(computeSpinCredit(data, "A").earned).toBe(1);
  });
});

describe("closed rate and ranking", () => {
  it("closed rate = validated ÷ submitted × 100", () => {
    expect(closedRate({ submitted: 4, validated: 3 })).toBe(75);
    expect(closedRate({ submitted: 0, validated: 0 })).toBe(0);
  });

  it("ranks by validated first, then submitted; leaves out agents with no leads", () => {
    const d = createSeedData();
    const [x, y, z, idle] = d.agents.filter((a) => a.active);
    const data = {
      agents: [x, y, z, idle],
      sales: [...leads(x.id, 3, ["pending"]), ...leads(y.id, 0, ["pending", "rejected", "duplicate"]), ...leads(z.id, 0, ["pending"])],
    };
    const rows = rankClosers(data);
    expect(rows.map((r) => [r.agent.id, r.counts.submitted, r.counts.validated, Math.round(r.rate)])).toEqual([
      [x.id, 4, 3, 75],
      [y.id, 3, 0, 0],
      [z.id, 1, 0, 0],
    ]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("closer codes are stable and readable", () => {
    expect(closerCode({ id: "agt_1" })).toMatch(/^CLS-[0-9A-F]{8}$/);
    expect(closerCode({ id: "agt_1" })).toBe(closerCode({ id: "agt_1" }));
    expect(closerCode({ id: "agt_1" })).not.toBe(closerCode({ id: "agt_2" }));
  });
});

describe("no duplicate spin rewards", () => {
  it("rejecting and re-validating the same sale does not announce the spin again", () => {
    const first = lead("A", "approved");
    const second = lead("A", "approved");
    const base = detectNewUnlocks(world([first]), null).next;

    const earned = detectNewUnlocks(world([first, second]), base);
    expect(earned.unlocks).toHaveLength(1);

    const rejected = detectNewUnlocks(world([first, { ...second, status: "rejected", approvedAt: null }]), earned.next);
    expect(rejected.unlocks).toHaveLength(0);

    const again = detectNewUnlocks(world([first, second]), rejected.next);
    expect(again.unlocks).toHaveLength(0);
  });
});
