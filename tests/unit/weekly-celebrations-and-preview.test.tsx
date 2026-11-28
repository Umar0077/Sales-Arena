// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { WeeklyTopCelebration } from "@/frontend/components/celebrations/WeeklyTopCelebration";
import { WeeklyTopTeamCelebration } from "@/frontend/components/celebrations/WeeklyTopTeamCelebration";
import { ThemeTvPreview } from "@/frontend/components/admin/ThemeTvPreview";
import { WeeklyTopPerformerSettings } from "@/frontend/components/admin/celebrations/WeeklyTopPerformerSettings";
import { WeeklyTopTeamSettings } from "@/frontend/components/admin/celebrations/WeeklyTopTeamSettings";
import { ArenaThemeScope } from "@/frontend/theme/arena-theme";
import { GET as weeklyTopTeamGet } from "@/app/api/admin/celebrations/weekly-top-team/route";
import { NextRequest } from "next/server";

vi.mock("@/backend/auth/guard", () => ({
  requireAdmin: async () => ({
    ok: false,
    response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
  }),
  jsonError: (status: number, msg: string) => new Response(JSON.stringify({ error: msg }), { status }),
  requestIp: () => null,
  requestUserAgent: () => null,
}));

vi.mock("@/frontend/components/celebrations/ConfettiCanvas", () => ({
  ConfettiCanvas: () => <div data-testid="mock-confetti" />,
}));

async function withMount(node: React.ReactElement, fn: (el: HTMLElement) => void | Promise<void>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  try {
    await act(async () => {
      root.render(node);
    });
    await fn(el);
  } finally {
    await act(async () => {
      root.unmount();
    });
    el.remove();
    vi.unstubAllGlobals();
  }
}

describe("Weekly Top Performer, Weekly Top Team & Appearance Preview Fix", () => {
  beforeEach(() => {
    if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
          matches: false,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }),
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("protects /api/admin/celebrations/weekly-top-team with Admin auth", async () => {
    const res = await weeklyTopTeamGet(new NextRequest("http://arena.test/api/admin/celebrations/weekly-top-team"));
    expect(res.status).toBe(401);
  });

  it("renders WeeklyTopCelebration with agent emoji when available and Crown medal fallback when missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ url: "/api/arena/agent-emojis/asset-123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await withMount(
      <ArenaThemeScope theme="normal" preview>
        <WeeklyTopCelebration
          motion="full"
          event={{
            id: "wtp_1",
            tier: "weekly-top",
            headline: "CONGRATULATIONS!",
            subline: "Nov 18 – Nov 24",
            agentId: "CLS-MANSOOR",
            agentName: "Mansoor Arshad",
            teamName: "Team Sigma",
            teamColor: "#F5C451",
            value: 19,
            createdAt: "2026-11-25T10:00:00.000Z",
            preview: true,
          }}
        />
      </ArenaThemeScope>,
      async (el) => {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 20));
        });
        expect(el.querySelector('[data-testid="weekly-top-name"]')?.textContent).toBe("Mansoor Arshad");
        expect(el.querySelector('[data-testid="weekly-top-team"]')?.textContent).toBe("Team Sigma");
        expect(el.querySelector('[data-testid="weekly-top-sales"]')?.textContent).toContain("19");
        const img = el.querySelector("img.wtp-agent-emoji") as HTMLImageElement | null;
        expect(img?.getAttribute("src")).toBe("/api/arena/agent-emojis/asset-123");
      },
    );

    // Without agentId -> safe Crown medal fallback
    await withMount(
      <ArenaThemeScope theme="christmas" preview>
        <WeeklyTopCelebration
          motion="full"
          event={{
            id: "wtp_fallback",
            tier: "weekly-top",
            headline: "CONGRATULATIONS!",
            subline: "Nov 18 – Nov 24",
            agentId: null,
            agentName: "Hamna Nasir",
            teamName: null,
            teamColor: null,
            value: 12,
            createdAt: "2026-11-25T10:00:00.000Z",
            preview: true,
          }}
        />
      </ArenaThemeScope>,
      (el) => {
        expect(el.querySelector('[data-testid="weekly-top-fallback-medal"]')).toBeTruthy();
        expect(el.querySelector('[data-testid="weekly-top-kicker"]')?.textContent).toContain("🎄");
      },
    );
  });

  it("renders WeeklyTopTeamCelebration with winning team logo and all team members", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ url: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await withMount(
      <ArenaThemeScope theme="normal" preview>
        <WeeklyTopTeamCelebration
          motion="full"
          event={{
            id: "wtt_1",
            tier: "weekly-top-team",
            headline: "TEAM SIGMA — THIS WEEK'S TOP PERFORMERS",
            subline: "Nov 18 – Nov 24",
            agentId: null,
            agentName: null,
            teamName: "Team Sigma",
            teamColor: "#F5C451",
            teamLogoUrl: "/teams/team-sigma.webp",
            teamMembers: [
              { userCode: "C1", name: "Mansoor Arshad", validated: 14 },
              { userCode: "C2", name: "Hamna Nasir", validated: 11 },
              { userCode: "C3", name: "Rohan Ali", validated: 9 },
            ],
            value: 34,
            createdAt: "2026-11-25T10:00:00.000Z",
            preview: true,
          }}
        />
      </ArenaThemeScope>,
      (el) => {
        const logo = el.querySelector('[data-testid="weekly-top-team-logo"]') as HTMLImageElement | null;
        expect(logo?.getAttribute("src")).toBe("/teams/team-sigma.webp");
        expect(el.querySelector('[data-testid="weekly-top-team-headline"]')?.textContent).toContain(
          "Team Sigma — This Week's Top Performers",
        );
        expect(el.querySelector('[data-testid="weekly-top-team-sales"]')?.textContent).toContain("34");
        const members = el.querySelectorAll('[data-testid="weekly-top-team-member"]');
        expect(members.length).toBe(3);
      },
    );
  });

  it("contains 16:9 preview overlays inside ThemeTvPreview and renders Weekly Top & Weekly Top Team tabs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: false }), { status: 401 }),
    );

    await withMount(
      <ThemeTvPreview
        theme="christmas"
        snowfall="light"
        christmasSounds={true}
        christmasSantaCub={true}
        effectsIntensity="standard"
      />,
      async (el) => {
        const monitor = el.querySelector('[data-testid="theme-tv-monitor"]') as HTMLElement;
        expect(monitor.style.transform).toBe("translateZ(0)");
        expect(monitor.className).toContain("aspect-video");
        expect(monitor.className).toContain("[container-type:size]");

        // Switch to Weekly Top Performer tab
        const wtpTab = el.querySelector('[data-testid="preview-tab-weekly-top"]') as HTMLButtonElement;
        await act(async () => {
          wtpTab.click();
        });
        expect(el.querySelector('[data-testid="weekly-top-celebration"]')).toBeTruthy();

        // Switch to Weekly Top Team tab
        const wttTab = el.querySelector('[data-testid="preview-tab-weekly-top-team"]') as HTMLButtonElement;
        await act(async () => {
          wttTab.click();
        });
        expect(el.querySelector('[data-testid="weekly-top-team-celebration"]')).toBeTruthy();

        // Switch to Sale Celebration tab
        const saleTab = el.querySelector('[data-testid="preview-tab-celebration"]') as HTMLButtonElement;
        await act(async () => {
          saleTab.click();
        });
        expect(el.querySelector('[data-testid="sale-celebration-popup"]')).toBeTruthy();
      },
    );
  });

  it("provides local Preview buttons in WeeklyTopPerformerSettings and WeeklyTopTeamSettings without mutating server state", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("weekly-top-performer")) {
        return new Response(
          JSON.stringify({
            ok: true,
            week: { from: "2026-11-18", to: "2026-11-24", label: "Nov 18 – Nov 24" },
            top: { userCode: "C1", name: "Mansoor Arshad", validated: 14, submitted: 18, teamName: "Team Sigma" },
            tiedWith: null,
            celebrated: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("weekly-top-team")) {
        return new Response(
          JSON.stringify({
            ok: true,
            week: { from: "2026-11-18", to: "2026-11-24", label: "Nov 18 – Nov 24" },
            topTeam: {
              id: "t1",
              slug: "sigma",
              name: "Team Sigma",
              logoUrl: "/teams/team-sigma.webp",
              color: "#F5C451",
              accentSecondary: "#7568FF",
              validated: 34,
              submitted: 41,
              closeRate: 83,
              members: [
                { userCode: "C1", name: "Mansoor Arshad", designation: null, validated: 14, submitted: 18 },
              ],
            },
            tiedWith: null,
            celebrated: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ url: null }), { status: 200 });
    });

    await withMount(<WeeklyTopPerformerSettings />, async (el) => {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(el.querySelector('[data-testid="weekly-top-celebrate"]')?.textContent).toContain(
        "Celebrate Weekly Top Performer",
      );
      const previewBtn = el.querySelector('[data-testid="weekly-top-preview-btn"]') as HTMLButtonElement;
      await act(async () => {
        previewBtn.click();
      });
      expect(el.querySelector('[data-testid="weekly-top-preview-stage"]')).toBeTruthy();
    });

    await withMount(<WeeklyTopTeamSettings />, async (el) => {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(el.querySelector('[data-testid="weekly-top-team-celebrate"]')?.textContent).toContain(
        "Celebrate Weekly Top Team",
      );
      const previewBtn = el.querySelector('[data-testid="weekly-top-team-preview-btn"]') as HTMLButtonElement;
      await act(async () => {
        previewBtn.click();
      });
      expect(el.querySelector('[data-testid="weekly-top-team-preview-stage"]')).toBeTruthy();
    });
  });

  it("displays an explicit tie state and disables sole-winner celebration when two teams have identical raw validated counts", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          week: { from: "2026-11-23", to: "2026-11-28", label: "Nov 23 – Nov 28" },
          topTeam: null,
          isTie: true,
          tiedTeams: [
            { id: "team_panthers", slug: "panthers", name: "Team Panthers", logoUrl: "/teams/team-panthers.webp", color: "#A855F7", accentSecondary: null, validated: 30, creditedValidated: 27, submitted: 100, closeRate: 27, members: [] },
            { id: "team_sigma", slug: "sigma", name: "Team Sigma", logoUrl: "/teams/team-sigma.webp", color: "#8B5CF6", accentSecondary: null, validated: 30, creditedValidated: 27, submitted: 95, closeRate: 28.4, members: [] },
          ],
          teams: [
            { id: "team_panthers", slug: "panthers", name: "Team Panthers", logoUrl: "/teams/team-panthers.webp", color: "#A855F7", validated: 30, creditedValidated: 27, submitted: 100, closeRate: 27, memberCount: 10, rank: 1, tied: true },
            { id: "team_sigma", slug: "sigma", name: "Team Sigma", logoUrl: "/teams/team-sigma.webp", color: "#8B5CF6", validated: 30, creditedValidated: 27, submitted: 95, closeRate: 28.4, memberCount: 9, rank: 1, tied: true },
          ],
          tiedWith: "Team Panthers & Team Sigma",
          celebrated: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await withMount(<WeeklyTopTeamSettings />, async (el) => {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 25));
      });
      expect(el.querySelector('[data-testid="weekly-top-team-admin-tie"]')?.textContent).toContain(
        "Tied for #1: Team Panthers & Team Sigma",
      );
      expect(el.querySelector('[data-testid="weekly-top-team-admin-sales"]')?.textContent).toBe("30");
      const btn = el.querySelector('[data-testid="weekly-top-team-celebrate"]') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(btn.textContent).toContain("Tied — No Sole Winner Yet");
    });
  });
});
