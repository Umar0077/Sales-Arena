// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parsePrize } from "@/backend/spins/prizes";
import { PendingSpinsPanel } from "@/frontend/components/spinflow/PendingSpinsPanel";
import { AchievementPopup } from "@/frontend/components/spinflow/AchievementPopup";
import { RecentSpinWinners } from "@/frontend/components/spinflow/RecentSpinWinners";
import { PreviewTab } from "@/frontend/components/admin/spins/PreviewTab";
import { useSpinBoardStore } from "@/frontend/stores/spin-board-store";
import { useSpinFlowStore } from "@/frontend/stores/spin-flow-store";
import { useArenaStore } from "@/frontend/stores/arena-store";
import { useSettingsStore } from "@/frontend/stores/settings-store";

describe("parsePrize 0–1 relative weight validation", () => {
  it("accepts 0 and 0–1 fractional relative weights", () => {
    const [zero, err0] = parsePrize({ title: "Paused", icon: "gift", color: "#FFC857", weight: 0 });
    expect(err0).toBeNull();
    expect(zero?.weight).toBe(0);

    const [frac, errFrac] = parsePrize({ title: "Half", icon: "trophy", color: "#36E0B5", weight: 0.25 });
    expect(errFrac).toBeNull();
    expect(frac?.weight).toBe(0.25);
  });

  it("rejects negative weights", () => {
    const [res, err] = parsePrize({ title: "Bad", icon: "gift", color: "#FFC857", weight: -0.1 });
    expect(res).toBeNull();
    expect(err).toMatch(/between 0 and 1000/);
  });
});

describe("PendingSpinsPanel, RecentSpinWinners & Admin PreviewTab", () => {
  let el: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("Path2D", class Path2D {});
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const noop = () => {};
    const ctx2d = new Proxy(
      {
        createRadialGradient: () => ({ addColorStop: noop }),
        createLinearGradient: () => ({ addColorStop: noop }),
        measureText: () => ({ width: 20 }),
      } as Record<string, unknown>,
      { get: (t, p) => (p in t ? t[p as string] : noop) },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((id: string) =>
      id === "2d" ? ctx2d : null) as unknown as HTMLCanvasElement["getContext"]);
    el = document.createElement("div");
    document.body.appendChild(el);
    useSpinFlowStore.getState().clear();
    useSettingsStore.setState({ arenaEnabled: true, spinFeatureEnabled: true, spinFlowEnabled: true });
  });

  afterEach(() => {
    el.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("PendingSpinsPanel renders pending spins from store and launches SpinFlow on click", async () => {
    useSpinBoardStore.setState({
      pendingLoaded: true,
      pending: [
        { user_code: "HAMNA", agent_id: "agt_HAMNA", name: "Hamna Nasir", available: 2 },
      ],
    });
    const root = createRoot(el);
    await act(async () => {
      root.render(<PendingSpinsPanel />);
    });
    expect(el.textContent).toContain("SPIN AVAILABLE");
    expect(el.textContent).toContain("Hamna Nasir");
    expect(el.textContent).toContain("2 Spins");

    const cta = el.querySelector('[data-testid="pending-spin-cta-HAMNA"]') as HTMLButtonElement | null;
    expect(cta).not.toBeNull();
    await act(async () => {
      cta!.click();
    });
    expect(useSpinFlowStore.getState().queue).toHaveLength(1);
    expect(useSpinFlowStore.getState().queue[0]).toMatchObject({
      userCode: "HAMNA",
      agentName: "Hamna Nasir",
      available: 2,
      reason: "launch",
    });

    await act(async () => root.unmount());
  });

  it("PendingSpinsPanel renders multiple agents in a compact queue", async () => {
    useSpinBoardStore.setState({
      pendingLoaded: true,
      pending: [
        { user_code: "HAMNA", agent_id: "agt_HAMNA", name: "Hamna Nasir", available: 2 },
        { user_code: "MANSOOR", agent_id: "agt_MANSOOR", name: "Mansoor Arshad", available: 1 },
      ],
    });
    const root = createRoot(el);
    await act(async () => {
      root.render(<PendingSpinsPanel />);
    });
    expect(el.querySelector('[data-testid="pending-spin-HAMNA"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="pending-spin-MANSOOR"]')).not.toBeNull();
    expect(el.textContent).toContain("Hamna Nasir");
    expect(el.textContent).toContain("Mansoor Arshad");
    await act(async () => root.unmount());
  });

  it("AchievementPopup displays agent name, emoji/fallback, and available spin balance", async () => {
    const root = createRoot(el);
    await act(async () => {
      root.render(
        <AchievementPopup
          agent={{
            id: "agt_HAMNA",
            userCode: "HAMNA",
            name: "Hamna Nasir",
            initials: "HN",
            teamId: "",
            campaignId: "cmp_fe",
            active: true,
            title: "Closer",
            hue: 200,
            joinedAt: new Date(0).toISOString(),
          }}
          team={undefined}
          periodSales={2}
          available={3}
          reason="bonus"
          eyebrow="BONUS SPIN AWARDED"
          reducedMotion={true}
          onSpin={() => {}}
          onLater={() => {}}
        />,
      );
    });
    expect(el.querySelector('[data-testid="achievement-agent-name"]')?.textContent).toBe("Hamna Nasir");
    expect(el.querySelector('[data-testid="achievement-spins-balance"]')?.textContent).toContain("3 Available");
    await act(async () => root.unmount());
  });

  it("RecentSpinWinners displays completed prize winners in production mode", async () => {
    useArenaStore.setState({ dataSourceMode: "production" });
    useSpinBoardStore.setState({
      winnersLoaded: true,
      winners: [
        {
          id: "spin_1",
          user_code: "HAMNA",
          name: "Hamna Nasir",
          reward_title: "$100 Bonus",
          reward_color: "#FFC857",
          reward_icon: "trophy",
          created_at: new Date().toISOString(),
        },
      ],
    });
    const root = createRoot(el);
    await act(async () => {
      root.render(<RecentSpinWinners />);
    });
    expect(el.textContent).toContain("RECENT SPIN WINNERS");
    expect(el.textContent).toContain("Hamna Nasir");
    expect(el.textContent).toContain("$100 Bonus");
    await act(async () => root.unmount());
  });

  it("PreviewTab is strictly local-only and never calls mutating spin/allocate APIs", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/api/admin/spins/agents")) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, agents: [] }), { status: 200 }));
      }
      if (String(url).includes("/api/admin/catalog")) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, prizes: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: false }), { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const spinQueueBefore = useSpinFlowStore.getState().queue;
    const root = createRoot(el);
    await act(async () => {
      root.render(<PreviewTab />);
    });
    expect(el.textContent).toContain("Local Preview Only");
    expect(el.querySelector('[data-testid="preview-allocation-card"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="preview-wheel-box"]')).not.toBeNull();

    // Verify no POST calls were made (no /api/arena/spin, no /api/admin/spins/allocate)
    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/api/arena/spin"))).toBe(false);
    expect(calls.some((u) => u.includes("/api/admin/spins/allocate"))).toBe(false);
    expect(useSpinFlowStore.getState().queue).toBe(spinQueueBefore);

    await act(async () => root.unmount());
  });
});
