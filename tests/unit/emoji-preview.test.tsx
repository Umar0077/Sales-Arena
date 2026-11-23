// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { CelebrationOverlay } from "@/frontend/components/celebrations/CelebrationOverlay";
import { useCelebrationStore } from "@/frontend/stores/celebration-store";
import { useArenaStore } from "@/frontend/stores/arena-store";
import { audioEngine } from "@/frontend/audio/engine";
it("mounted and repeated local previews never advance live queues, create sales or play audio", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const audio = vi.spyOn(audioEngine, "play").mockImplementation(() => { });
    const state = useArenaStore.getState();
    const queue = useCelebrationStore.getState();
    const el = document.createElement("div");
    const root = createRoot(el);
    try {
        for (const name of ["Mansoor Arshad", "Hamna Nasir", "Arsam Idrees"]) {
            await act(async () => { root.render(<CelebrationOverlay key={name} previewEvent={{ id: name, tier: "sale", headline: "NEW SALE APPROVED!", subline: "Preview", agentId: null, agentName: name, teamName: null, teamColor: null, value: null, createdAt: "", preview: true }}/>); });
            expect(el.textContent).toContain(name);
        }
        expect(useArenaStore.getState()).toBe(state);
        expect(useCelebrationStore.getState()).toBe(queue);
        expect(audio).not.toHaveBeenCalled();
    }
    finally {
        await act(async () => root.unmount());
        audio.mockRestore();
        vi.unstubAllGlobals();
    }
});
