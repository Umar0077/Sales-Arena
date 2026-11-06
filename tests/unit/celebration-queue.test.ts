import { beforeEach, describe, expect, it } from "vitest";
import { teamCelebrationBusy, useTeamCelebrationStore } from "@/frontend/stores/team-celebration-store";
import { useBonusFlowStore } from "@/frontend/stores/bonus-flow-store";
import { isLiteDisplay } from "@/frontend/performance/lite";
import type { CelebrationEvent } from "@/shared/types";
import type { SaleTeamInfo } from "@/shared/teams/celebration";

const TEAM: SaleTeamInfo = { id: "team_sigma", slug: "sigma", name: "Team Sigma", active: true, logoUrl: null, color: "#8B5CF6", accentSecondary: null, businessDate: "2026-11-05" };
const ev = (id: string): CelebrationEvent => ({ id: `celeb_sale_${id}`, tier: "sale", headline: "", subline: "", agentId: "A", agentName: "A", teamName: null, teamColor: null, value: null, createdAt: "", preview: false, saleTeam: TEAM });
const item = (id: string) => ({ event: ev(id), team: TEAM, baseline: null, enqueuedAt: 0 });
const st = () => useTeamCelebrationStore.getState();

describe("team celebration state machine: idle → preparing → playing → finishing → idle", () => {
  beforeEach(() => {
    st().clear();
    useTeamCelebrationStore.setState({ seen: [], stats: { queued: 0, duplicates: 0, started: 0, completed: 0, recovered: 0, handedBack: 0 } });
  });
  it("the next one starts only after the previous one has completely left the screen", () => {
    st().enqueue(item("1"));
    st().enqueue(item("2"));
    expect(st().next()!.event.id).toBe("celeb_sale_1");
    expect(st().phase).toBe("preparing");
    st().play();
    expect(st().phase).toBe("playing");
    expect(st().next()).toBeNull(); // one at a time
    st().finish();
    expect(st().phase).toBe("finishing"); // still animating out
    expect(st().current).toBeNull();
    expect(teamCelebrationBusy(st())).toBe(true); // bonus popups / sale cards keep waiting
    expect(st().next()).toBeNull();
    st().exited(); // AnimatePresence reported the exit finished
    expect(st().phase).toBe("idle");
    expect(st().next()!.event.id).toBe("celeb_sale_2");
    expect(st().stats).toMatchObject({ queued: 2, started: 1, completed: 1, recovered: 0 });
  });
  it("a stalled exit is released by the safety path and counted (never stuck forever)", () => {
    st().enqueue(item("3"));
    st().next();
    st().play();
    st().finish();
    st().exited(true);
    expect(st().phase).toBe("idle");
    expect(st().stats).toMatchObject({ completed: 1, recovered: 1 });
  });
  it("finishing an item that was never shown goes straight back to idle (nothing to animate out)", () => {
    st().enqueue(item("4"));
    st().next();
    st().finish();
    expect(st().phase).toBe("idle");
  });
  it("duplicates are counted, never queued; leaving the screen resets at once", () => {
    st().enqueue(item("5"));
    expect(st().enqueue(item("5"))).toBe(false);
    expect(st().stats.duplicates).toBe(1);
    st().next();
    st().play();
    st().reset();
    expect(st().phase).toBe("idle");
    expect(st().current).toBeNull();
  });
  it("five rapid sales keep their order", () => {
    for (const i of ["a", "b", "c", "d", "e"]) st().enqueue(item(i));
    const order: string[] = [];
    for (let i = 0; i < 5; i++) {
      order.push(st().next()!.event.id);
      st().play();
      st().finish();
      st().exited();
    }
    expect(order).toEqual(["a", "b", "c", "d", "e"].map((x) => `celeb_sale_${x}`));
    expect(st().stats).toMatchObject({ queued: 5, started: 5, completed: 5 });
  });
});

describe("bonus popup completion signal", () => {
  beforeEach(() => useBonusFlowStore.getState().clear());
  const award = (id: string) => ({ key: id, awards: [{ id, agentId: "A", programId: "P" } as never] });
  it("a finished popup stays 'exiting' until its exit animation reports back", () => {
    const b = useBonusFlowStore.getState();
    b.push(award("x"));
    b.next();
    useBonusFlowStore.getState().finish();
    expect(useBonusFlowStore.getState()).toMatchObject({ active: null, exiting: true });
    useBonusFlowStore.getState().exited();
    expect(useBonusFlowStore.getState().exiting).toBe(false);
  });
  it("finishing with nothing open does not invent an exit", () => {
    useBonusFlowStore.getState().finish();
    expect(useBonusFlowStore.getState().exiting).toBe(false);
  });
});

describe("Lite display rule", () => {
  it("Performance mode, or Auto on a weak / measured-struggling display; never on a capable Auto display", () => {
    expect(isLiteDisplay({ quality: "performance", autoQuality: "high" }, false)).toBe(true);
    expect(isLiteDisplay({ quality: "auto", autoQuality: "low" }, false)).toBe(true);
    expect(isLiteDisplay({ quality: "auto", autoQuality: "high" }, true)).toBe(true);
    expect(isLiteDisplay({ quality: "auto", autoQuality: "high" }, false)).toBe(false);
    expect(isLiteDisplay({ quality: "high", autoQuality: "low" }, true)).toBe(false); // an explicit choice wins
  });
});
