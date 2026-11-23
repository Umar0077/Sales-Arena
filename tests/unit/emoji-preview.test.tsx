// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { CelebrationOverlay } from "@/frontend/components/celebrations/CelebrationOverlay";
import { TeamSaleCelebrationView, previewItem } from "@/frontend/components/arena/teams/TeamSaleCelebration";
import { useCelebrationStore } from "@/frontend/stores/celebration-store";
import { useTeamCelebrationStore } from "@/frontend/stores/team-celebration-store";
import { useArenaStore } from "@/frontend/stores/arena-store";
import { audioEngine } from "@/frontend/audio/engine";
it("mounted and repeated local previews never advance live queues, create sales or play audio", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const audio = vi.spyOn(audioEngine, "play").mockImplementation(() => { });
    const state = useArenaStore.getState();
    const queue = useCelebrationStore.getState();
    const teamQueue = useTeamCelebrationStore.getState();
    const el = document.createElement("div");
    const root = createRoot(el);
    try {
        for (const name of ["Mansoor Arshad", "Hamna Nasir", "Arsam Idrees"]) {
            await act(async () => { root.render(<CelebrationOverlay key={name} previewEvent={{ id: name, tier: "sale", headline: "NEW SALE APPROVED!", subline: "Preview", agentId: null, agentName: name, teamName: null, teamColor: null, value: null, createdAt: "", preview: true }}/>); });
            expect(el.textContent).toContain(name);
            expect(el.textContent).toContain("NEW SALE APPROVED!");
            expect(el.textContent).toContain("Just made a sale!");
            expect(el.querySelector('[data-testid="sale-celebration-popup"]')).not.toBeNull();
        }
        for (const kind of ["lion", "panther"] as const) {
            const item = previewItem(kind);
            item.event.agentName = "Mansoor Arshad";
            await act(async () => {
                root.render(
                    <TeamSaleCelebrationView
                        key={item.event.id}
                        item={item}
                        name={item.team.name}
                        logoUrl={item.team.logoUrl}
                        color={item.team.color}
                        accent={item.team.accentSecondary}
                        total={{ period: "day", value: 18 }}
                        motionLevel="full"
                    />
                );
            });
            expect(el.textContent).toContain("Mansoor Arshad");
            expect(el.querySelector('[data-testid="team-celebration"]')).not.toBeNull();
        }
        expect(useArenaStore.getState()).toBe(state);
        expect(useCelebrationStore.getState()).toBe(queue);
        expect(useTeamCelebrationStore.getState()).toBe(teamQueue);
        expect(audio).not.toHaveBeenCalled();
    }
    finally {
        await act(async () => root.unmount());
        audio.mockRestore();
        vi.unstubAllGlobals();
    }
});
