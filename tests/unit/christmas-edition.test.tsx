// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  ARENA_THEMES,
  ArenaThemeScope,
  normalizeArenaTheme,
  isChristmasAudioActive,
} from "@/frontend/theme/arena-theme";
import { ChristmasSnowfall } from "@/frontend/components/theme/ChristmasSnowfall";
import { CubCharacter } from "@/frontend/components/cub/CubCharacter";
import { CelebrationOverlay } from "@/frontend/components/celebrations/CelebrationOverlay";
import { TeamSaleCelebrationView, previewItem } from "@/frontend/components/arena/teams/TeamSaleCelebration";
import {
  CHRISTMAS_GENERATORS,
  CHRISTMAS_CUB_SOUNDS,
  CHRISTMAS_TEAM_STINGERS,
  encodeWav,
} from "@/frontend/audio/synth";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/frontend/stores/settings-store";
import { GLOBAL_SETTING_KEYS } from "@/shared/settings/global-keys";
import { validatePatch } from "@/backend/settings/arena-config";
import AppearanceSoundPage from "@/app/admin/(panel)/settings/page";
import * as globalSettings from "@/frontend/admin/global-settings";

// Mock canvas / Three.js heavy SpinnerPreview for admin settings tests
vi.mock("@/frontend/components/admin/SpinnerPreview", () => ({
  SpinnerPreview: () => <div data-testid="mock-spinner-preview">Spinner Preview</div>,
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

describe("FE Sales Arena — Christmas Edition", () => {
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
    useSettingsStore.setState({
      ...DEFAULT_SETTINGS,
      arenaTheme: "normal",
      christmasSnowfall: "light",
      christmasSounds: true,
      christmasSantaCub: true,
      christmasEffectsIntensity: "standard",
    });
  });

  describe("1. Theme Normalization & Global Settings Persistence Schema", () => {
    it("normalizes valid theme IDs and falls back safely to 'normal' on invalid input", () => {
      expect(normalizeArenaTheme("normal")).toBe("normal");
      expect(normalizeArenaTheme("christmas")).toBe("christmas");
      expect(normalizeArenaTheme("invalid-theme")).toBe("normal");
      expect(normalizeArenaTheme(null)).toBe("normal");
      expect(normalizeArenaTheme(undefined)).toBe("normal");
      expect(ARENA_THEMES.normal.name).toBe("Normal Arena");
      expect(ARENA_THEMES.christmas.name).toBe("Christmas Edition");
    });

    it("includes all Christmas theme keys in GLOBAL_SETTING_KEYS and backend validatePatch", () => {
      const keys = [
        "arenaTheme",
        "christmasSnowfall",
        "christmasSounds",
        "christmasSantaCub",
        "christmasEffectsIntensity",
      ] as const;

      for (const k of keys) {
        expect(GLOBAL_SETTING_KEYS).toContain(k);
      }

      const valid = validatePatch({
        arenaTheme: "christmas",
        christmasSnowfall: "medium",
        christmasSounds: true,
        christmasSantaCub: true,
        christmasEffectsIntensity: "epic",
      });
      expect(valid).toEqual({
        arenaTheme: "christmas",
        christmasSnowfall: "medium",
        christmasSounds: true,
        christmasSantaCub: true,
        christmasEffectsIntensity: "epic",
      });

      expect(() => validatePatch({ arenaTheme: "halloween" })).toThrow();
    });
  });

  describe("2. Normal vs Christmas Sale & Team Celebrations", () => {
    const sampleSale = {
      id: "sale_test_1",
      tier: "sale" as const,
      headline: "NEW SALE APPROVED!",
      subline: "Just made a sale!",
      agentId: "agent-1",
      agentName: "Mansoor Arshad",
      teamName: "Team Sigma",
      teamColor: "#F5C451",
      value: 110,
      createdAt: "2026-12-25T10:00:00.000Z",
      preview: true,
    };

    it("renders NEW SALE APPROVED! in Normal Arena and CHRISTMAS SALE APPROVED! in Christmas Edition", async () => {
      await withMount(
        <ArenaThemeScope theme="normal" preview>
          <CelebrationOverlay previewEvent={sampleSale} />
        </ArenaThemeScope>,
        (el) => {
          expect(el.querySelector('[data-testid="sale-celebration-heading"]')?.textContent).toBe("NEW SALE APPROVED!");
          expect(el.querySelector('[data-testid="sale-celebration-support"]')?.textContent).toBe("Just made a sale!");
          expect(el.querySelector('[data-testid="sale-celebration-christmas-sub"]')).toBeNull();
        },
      );

      await withMount(
        <ArenaThemeScope theme="christmas" preview>
          <CelebrationOverlay previewEvent={sampleSale} />
        </ArenaThemeScope>,
        (el) => {
          expect(el.querySelector('[data-testid="sale-celebration-heading"]')?.textContent).toBe(
            "CHRISTMAS SALE APPROVED!",
          );
          expect(el.querySelector('[data-testid="sale-celebration-christmas-sub"]')?.textContent).toContain(
            "Another win this holiday season!",
          );
        },
      );
    });

    it("renders the festive Christmas banner on TeamSaleCelebrationView only when Christmas theme is active", async () => {
      const item = previewItem("lion");
      await withMount(
        <ArenaThemeScope theme="normal" preview>
          <TeamSaleCelebrationView
            item={item}
            name="Team Sigma"
            logoUrl="/teams/team-sigma.webp"
            color="#F5C451"
            accent="#7568FF"
            total={{ value: 12, period: "day" }}
            motionLevel="full"
          />
        </ArenaThemeScope>,
        (el) => {
          expect(el.querySelector('[data-testid="team-christmas-sale-banner"]')).toBeNull();
        },
      );

      await withMount(
        <ArenaThemeScope theme="christmas" preview>
          <TeamSaleCelebrationView
            item={item}
            name="Team Sigma"
            logoUrl="/teams/team-sigma.webp"
            color="#F5C451"
            accent="#7568FF"
            total={{ value: 12, period: "day" }}
            motionLevel="full"
          />
        </ArenaThemeScope>,
        (el) => {
          const banner = el.querySelector('[data-testid="team-christmas-sale-banner"]');
          expect(banner?.textContent).toContain("TEAM SIGMA — CHRISTMAS SALE!");
          expect(
            el.querySelector('[data-testid="team-celebration-headline"]')?.getAttribute("data-headline"),
          ).toBe("TEAM SIGMA GOT A SALE!");
        },
      );
    });
  });

  describe("3. Santa Arena Cub Mascot & Snowfall System", () => {
    it("renders Normal Arena Cub without Santa hat in Normal mode and Santa Arena Cub with Santa hat & suit in Christmas mode", async () => {
      await withMount(
        <ArenaThemeScope theme="normal" preview>
          <CubCharacter />
        </ArenaThemeScope>,
        (el) => {
          expect(el.querySelector('[data-testid="cub-santa-hat"]')).toBeNull();
          expect(el.querySelector('[data-testid="cub-santa-suit"]')).toBeNull();
        },
      );

      await withMount(
        <ArenaThemeScope theme="christmas" christmasSantaCub={true} preview>
          <CubCharacter />
        </ArenaThemeScope>,
        (el) => {
          expect(el.querySelector('[data-testid="cub-santa-hat"]')).toBeTruthy();
          expect(el.querySelector('[data-testid="cub-santa-suit"]')).toBeTruthy();
        },
      );
    });

    it("mounts ChristmasSnowfall only in Christmas mode when snowfall is not 'off'", async () => {
      await withMount(
        <ArenaThemeScope theme="normal" snowfall="light" preview>
          <ChristmasSnowfall contained />
        </ArenaThemeScope>,
        (el) => {
          expect(el.querySelector('[data-testid="christmas-snowfall"]')).toBeNull();
        },
      );

      await withMount(
        <ArenaThemeScope theme="christmas" snowfall="off" preview>
          <ChristmasSnowfall contained />
        </ArenaThemeScope>,
        (el) => {
          expect(el.querySelector('[data-testid="christmas-snowfall"]')).toBeNull();
        },
      );

      await withMount(
        <ArenaThemeScope theme="christmas" snowfall="light" preview>
          <ChristmasSnowfall contained />
        </ArenaThemeScope>,
        (el) => {
          const snow = el.querySelector('[data-testid="christmas-snowfall"]');
          expect(snow?.getAttribute("data-snowfall-intensity")).toBe("light");
        },
      );
    });
  });

  describe("4. Christmas Audio Profile & Synthesizers", () => {
    it("activates Christmas audio only when arenaTheme is 'christmas' and christmasSounds is enabled", () => {
      useSettingsStore.setState({ arenaTheme: "normal", christmasSounds: true });
      expect(isChristmasAudioActive()).toBe(false);

      useSettingsStore.setState({ arenaTheme: "christmas", christmasSounds: true });
      expect(isChristmasAudioActive()).toBe(true);

      useSettingsStore.setState({ arenaTheme: "christmas", christmasSounds: false });
      expect(isChristmasAudioActive()).toBe(false);
    });

    it("synthesizes non-empty valid WAV buffers for Christmas sales, Santa Ho Ho Ho, sleigh bells, and team stingers", () => {
      const saleSamples = CHRISTMAS_GENERATORS.sale!();
      expect(saleSamples.length).toBeGreaterThan(10000);
      expect(encodeWav(saleSamples).byteLength).toBe(44 + saleSamples.length * 2);

      const hohohoSamples = CHRISTMAS_CUB_SOUNDS.hohoho();
      expect(hohohoSamples.length).toBeGreaterThan(20000);

      const jingleSamples = CHRISTMAS_CUB_SOUNDS.jingle();
      expect(jingleSamples.length).toBeGreaterThan(15000);

      const royalSamples = CHRISTMAS_TEAM_STINGERS.royal();
      const electricSamples = CHRISTMAS_TEAM_STINGERS.electric();
      expect(royalSamples.length).toBeGreaterThan(20000);
      expect(electricSamples.length).toBeGreaterThan(20000);
    });
  });

  describe("5. Admin Appearance & Sound — Draft Selection, Local Preview & Apply Confirmation", () => {
    it("keeps theme card selection and Preview Theme local until Apply Theme is confirmed", async () => {
      const saveSpy = vi.spyOn(globalSettings, "saveSettings").mockResolvedValue(true);
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

      await withMount(<AppearanceSoundPage />, async (el) => {
        expect(el.querySelector('[data-testid="active-arena-theme"]')?.getAttribute("data-active-theme")).toBe(
          "normal",
        );

        // Selecting Christmas card updates draft selection but does NOT call saveSettings
        const christmasCard = el.querySelector('[data-testid="theme-card-christmas"]') as HTMLButtonElement;
        await act(async () => {
          christmasCard.click();
        });
        expect(el.querySelector('[data-testid="selected-draft-theme"]')?.textContent).toBe("Christmas Edition");
        expect(saveSpy).not.toHaveBeenCalled();

        // Clicking Preview Theme updates the 16:9 TV Preview to Christmas Edition without calling saveSettings
        const previewBtn = el.querySelector('[data-testid="preview-theme-btn"]') as HTMLButtonElement;
        await act(async () => {
          previewBtn.click();
        });
        expect(el.querySelector('[data-testid="preview-christmas-badge"]')).toBeTruthy();
        expect(el.querySelector('[data-testid="preview-cub-costume-label"]')?.textContent).toContain(
          "Santa Arena Cub",
        );
        expect(saveSpy).not.toHaveBeenCalled();

        // Clicking Apply Theme prompts confirmation and persists to global settings immediately
        const applyBtn = el.querySelector('[data-testid="apply-theme-btn"]') as HTMLButtonElement;
        await act(async () => {
          applyBtn.click();
        });
        expect(confirmSpy).toHaveBeenCalled();
        expect(saveSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            arenaTheme: "christmas",
            christmasSnowfall: "light",
            christmasSounds: true,
            christmasSantaCub: true,
            christmasEffectsIntensity: "standard",
          }),
          { immediate: true },
        );
      });

      saveSpy.mockRestore();
      confirmSpy.mockRestore();
    });
  });
});
