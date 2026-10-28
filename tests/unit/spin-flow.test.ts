import { describe, it, expect } from "vitest";
import { fillTemplate } from "@/store/settings-store";
import { enqueueUnlock, type SpinUnlock } from "@/store/spin-flow-store";
import { detectNewUnlocks } from "@/components/arena/ArenaEventBridge";
import { segmentColors } from "@/features/spins/wheel-theme";
import { createSeedData } from "@/lib/mock-api/seed";
import { computeSpinCredit } from "@/features/targets/eligibility";
import type { Reward, Sale } from "@/types";

const u = (agentId: string, reason: SpinUnlock["reason"] = "target", available = 1): SpinUnlock => ({
  id: `${agentId}-${reason}`,
  agentId,
  periodSales: 2,
  available,
  reason,
});

describe("fillTemplate", () => {
  it("fills known placeholders and keeps unknown ones", () => {
    expect(fillTemplate("CONGRATULATIONS, {agent}!", { agent: "ALI" })).toBe("CONGRATULATIONS, ALI!");
    expect(fillTemplate("YOU WON {prize}! {other}", { prize: "A GIFT VOUCHER" })).toBe("YOU WON A GIFT VOUCHER! {other}");
  });
});

describe("enqueueUnlock", () => {
  it("keeps one entry per agent and updates it", () => {
    let q = enqueueUnlock([], u("a"), null);
    q = enqueueUnlock(q, u("b"), null);
    q = enqueueUnlock(q, u("a", "target", 2), null);
    expect(q.map((x) => x.agentId)).toEqual(["a", "b"]);
    expect(q[0].available).toBe(2);
  });

  it("ignores the agent currently on screen", () => {
    expect(enqueueUnlock([], u("a"), "a")).toEqual([]);
  });

  it("puts launch requests first", () => {
    const q = enqueueUnlock([u("a"), u("b")], u("b", "launch"), null);
    expect(q.map((x) => [x.agentId, x.reason])).toEqual([["b", "launch"], ["a", "target"]]);
  });
});

describe("detectNewUnlocks", () => {
  const approve = (agentId: string, teamId: string, n: number): Sale[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `t${agentId}${i}${Math.random()}`,
      agentId,
      teamId,
      campaignId: "c",
      status: "approved",
      product: "Test",
      value: 10,
      createdAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
      source: "demo-simulator",
    }));

  it("baselines silently, then reports a spin when the target is reached", () => {
    const data = createSeedData();
    data.targetRules = data.targetRules.map((r) => ({ ...r, salesPerSpin: 2, enabled: true, period: "daily" }));
    const agent = data.agents[0];
    const first = detectNewUnlocks(data, null);
    expect(first.unlocks).toEqual([]);

    const needed = computeSpinCredit(data, agent.id).salesToNext!;
    const one = { ...data, sales: [...data.sales, ...approve(agent.id, agent.teamId, needed - 1)] };
    const r1 = detectNewUnlocks(one, first.next);
    expect(r1.unlocks.find((x) => x.agentId === agent.id)).toBeUndefined();

    const two = { ...one, sales: [...one.sales, ...approve(agent.id, agent.teamId, 1)] };
    const r2 = detectNewUnlocks(two, r1.next);
    expect(r2.unlocks).toEqual([expect.objectContaining({ agentId: agent.id, reason: "target" })]);
  });

  it("does not flood popups when an admin changes the rules", () => {
    const data = createSeedData();
    const base = detectNewUnlocks(data, null).next;
    const easier = { ...data, targetRules: data.targetRules.map((r) => ({ ...r, salesPerSpin: 1 })) };
    expect(detectNewUnlocks(easier, base).unlocks).toEqual([]);
  });
});

describe("segmentColors", () => {
  const rewards = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, color: "#123456" }) as Reward);

  it("never puts the same theme colour on both sides of the seam", () => {
    for (let n = 4; n <= 12; n++) {
      const c = segmentColors(rewards(n), "neon", "theme");
      for (let i = 0; i < n; i++) expect(c[i]).not.toBe(c[(i + 1) % n]);
    }
  });

  it("uses prize colours in prize mode", () => {
    expect(segmentColors(rewards(4), "neon", "prize")).toEqual(["#123456", "#123456", "#123456", "#123456"]);
  });
});
