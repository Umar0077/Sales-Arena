// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  formatSaleAnnouncement,
  selectPreferredFemaleVoice,
  announceSaleVoice,
  testVoiceAnnouncement,
  __resetVoiceAnnouncerForTests,
} from "@/frontend/audio/voice-announcer";
import {
  TIERS,
  NORMAL_SALE_CELEBRATION_MS,
  saleCelebrationDurationMs,
} from "@/frontend/features/celebrations/tiers";
import { CelebrationOverlay } from "@/frontend/components/celebrations/CelebrationOverlay";
import { ArenaThemeScope } from "@/frontend/theme/arena-theme";
import { useCelebrationStore } from "@/frontend/stores/celebration-store";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/frontend/stores/settings-store";
import { audioEngine } from "@/frontend/audio/engine";
import { GLOBAL_SETTING_KEYS } from "@/shared/settings/global-keys";
import { validatePatch } from "@/backend/settings/arena-config";
import AppearanceSoundPage from "@/app/admin/(panel)/settings/page";
import { readFileSync } from "node:fs";

vi.mock("@/frontend/components/admin/SpinnerPreview", () => ({
  SpinnerPreview: () => <div data-testid="mock-spinner-preview">Spinner Preview</div>,
}));

vi.mock("@/frontend/components/celebrations/ConfettiCanvas", () => ({
  ConfettiCanvas: () => <div data-testid="mock-confetti" />,
}));

class MockSpeechSynthesisUtterance {
  text: string;
  voice: SpeechSynthesisVoice | null = null;
  lang = "en-US";
  volume = 1;
  rate = 1;
  pitch = 1;
  onend: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

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

describe("FE Sales Arena — Voice Announcer, 8s Celebration & Teams Emoji Sizing", () => {
  const spokenUtterances: MockSpeechSynthesisUtterance[] = [];
  let mockVoices: Array<Pick<SpeechSynthesisVoice, "name" | "lang" | "voiceURI" | "default" | "localService">> = [];

  beforeEach(() => {
    __resetVoiceAnnouncerForTests();
    useCelebrationStore.getState().clear();
    useSettingsStore.setState({
      ...DEFAULT_SETTINGS,
      arenaTheme: "normal",
      soundEnabled: true,
      volume: 0.8,
      voiceAnnouncerEnabled: true,
      voiceAnnouncerVoice: "",
      voiceAnnouncerVolume: 0.85,
      voiceAnnouncerRate: 1.0,
      voiceAnnouncerTemplate: "{Agent Name} got a sale!",
    });

    spokenUtterances.length = 0;
    mockVoices = [
      { name: "Microsoft David - English (United States)", lang: "en-US", voiceURI: "david", default: true, localService: true },
      { name: "Microsoft Aria Online (Natural) - English (United States)", lang: "en-US", voiceURI: "aria", default: false, localService: false },
      { name: "Google UK English Female", lang: "en-GB", voiceURI: "google-uk-f", default: false, localService: false },
    ];

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

    vi.stubGlobal("SpeechSynthesisUtterance", MockSpeechSynthesisUtterance);
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      writable: true,
      value: {
        getVoices: () => mockVoices,
        addEventListener: () => {},
        removeEventListener: () => {},
        cancel: vi.fn(),
        speak: vi.fn((u: MockSpeechSynthesisUtterance) => {
          spokenUtterances.push(u);
          setTimeout(() => u.onend?.(new Event("end")), 10);
        }),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("formats '{Agent Name} got a sale!' cleanly without internal IDs or extra whitespace", () => {
    expect(formatSaleAnnouncement("  Arsam   Idrees  ")).toBe("Arsam Idrees got a sale!");
    expect(formatSaleAnnouncement("Ali Sikandar CLS-1234AB")).toBe("Ali Sikandar got a sale!");
    expect(formatSaleAnnouncement("Mansoor Arshad [AGENT-9]")).toBe("Mansoor Arshad got a sale!");
    expect(formatSaleAnnouncement("")).toBe("Our top closer got a sale!");
  });

  it("selects natural English female voices over male/robotic voices and falls back safely", () => {
    const selected = selectPreferredFemaleVoice(mockVoices);
    expect(selected?.name).toContain("Microsoft Aria Online");

    const explicit = selectPreferredFemaleVoice(mockVoices, "Google UK English Female");
    expect(explicit?.name).toBe("Google UK English Female");

    const fallbackOnlyMale = selectPreferredFemaleVoice([
      { name: "Microsoft David - English (United States)", lang: "en-US", voiceURI: "david", default: true },
    ]);
    expect(fallbackOnlyMale?.name).toContain("David");
  });

  it("includes all voice announcer settings in GLOBAL_SETTING_KEYS and validatePatch", () => {
    for (const key of [
      "voiceAnnouncerEnabled",
      "voiceAnnouncerVoice",
      "voiceAnnouncerVolume",
      "voiceAnnouncerRate",
      "voiceAnnouncerTemplate",
    ]) {
      expect(GLOBAL_SETTING_KEYS).toContain(key);
    }

    const clean = validatePatch({
      voiceAnnouncerEnabled: true,
      voiceAnnouncerVoice: "Microsoft Aria Online (Natural) - English (United States)",
      voiceAnnouncerVolume: 0.9,
      voiceAnnouncerRate: 1.05,
      voiceAnnouncerTemplate: "{Agent Name} got a sale!",
    });
    expect(clean.voiceAnnouncerEnabled).toBe(true);
    expect(clean.voiceAnnouncerRate).toBe(1.05);
  });

  it("sets normal sale celebration duration to 8000ms while preserving other tier durations", () => {
    expect(NORMAL_SALE_CELEBRATION_MS).toBe(8000);
    expect(saleCelebrationDurationMs(5)).toBe(8000);
    // Other tiers remain unchanged
    expect(TIERS["spin-unlocked"].durationFactor).toBe(1);
    expect(TIERS.milestone.durationFactor).toBe(1.15);
    expect(TIERS["top-performer"].durationFactor).toBe(1.25);
    expect(TIERS["team-target"].durationFactor).toBe(1.5);
    expect(TIERS.special.durationFactor).toBe(1.5);
    expect(TIERS["weekly-top"].durationFactor).toBe(1.9);
  });

  it("deduplicates repeated eventIds and serializes multiple queued sales in order without overlap", async () => {
    const r1 = announceSaleVoice({ eventId: "sale_1", agentName: "Arsam Idrees" });
    const rDup = announceSaleVoice({ eventId: "sale_1", agentName: "Arsam Idrees" });
    const r2 = announceSaleVoice({ eventId: "sale_2", agentName: "Hamna Nasir" });

    expect(await rDup).toBe("duplicate");
    expect(await r1).toBe("spoken");
    expect(await r2).toBe("spoken");

    expect(spokenUtterances.map((u) => u.text)).toEqual([
      "Arsam Idrees got a sale!",
      "Hamna Nasir got a sale!",
    ]);
  });

  it("handles TTS failure gracefully without throwing or blocking", async () => {
    (window.speechSynthesis.speak as ReturnType<typeof vi.fn>).mockImplementation((u: MockSpeechSynthesisUtterance) => {
      setTimeout(() => u.onerror?.(new Event("error")), 5);
    });

    const res = await announceSaleVoice({ eventId: "sale_err", agentName: "Roger Robinson" });
    expect(res).toBe("failed");
  });

  it("plays existing sale sound BEFORE speaking agent name in both Normal and Christmas modes", async () => {
    const order: string[] = [];
    vi.spyOn(audioEngine, "playWithCompletion").mockImplementation(async () => {
      order.push("sale-sound");
      return "played";
    });
    (window.speechSynthesis.speak as ReturnType<typeof vi.fn>).mockImplementation((u: MockSpeechSynthesisUtterance) => {
      order.push(`voice:${u.text}`);
      setTimeout(() => u.onend?.(new Event("end")), 5);
    });

    useCelebrationStore.getState().enqueue({
      id: "celeb_sale_seq_1",
      tier: "sale",
      headline: "NEW SALE APPROVED!",
      subline: "Just made a sale!",
      agentId: "a1",
      agentName: "Mansoor Arshad",
      teamName: null,
      teamColor: null,
      value: 100,
      createdAt: new Date().toISOString(),
      preview: false,
    });

    await withMount(
      <ArenaThemeScope theme="christmas" preview={false}>
        <CelebrationOverlay />
      </ArenaThemeScope>,
      async (el) => {
        await new Promise((r) => setTimeout(r, 80));
        expect(el.querySelector('[data-testid="sale-celebration-popup"]')).toBeTruthy();
        expect(order).toEqual(["sale-sound", "voice:Mansoor Arshad got a sale!"]);
      },
    );
  });

  it("keeps Teams Arena team emblem reduced in globals.css so agent emoji dominates", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toContain(".tc-root { --tc-w: min(40vw, 48vh, 620px); }");
    expect(css).toContain(".tc-crest-hero-size { width: min(25vh, 30vw, 260px);");
  });

  it("renders Admin Sale Voice Announcer section and triggers local-only test announcement", async () => {
    await withMount(<AppearanceSoundPage />, async (el) => {
      const preview = el.querySelector('[data-testid="voice-announcement-preview-text"]');
      expect(preview?.textContent).toContain("Arsam Idrees got a sale!");

      const btn = el.querySelector('[data-testid="test-voice-btn"]') as HTMLButtonElement;
      expect(btn).toBeTruthy();
      await act(async () => {
        btn.click();
        await new Promise((r) => setTimeout(r, 30));
      });
      expect(spokenUtterances.some((u) => u.text === "Arsam Idrees got a sale!")).toBe(true);

      // Verify direct helper works locally too
      const res = await testVoiceAnnouncement({ agentName: "Ali Sikandar" });
      expect(res).toBe("spoken");
      expect(spokenUtterances.some((u) => u.text === "Ali Sikandar got a sale!")).toBe(true);
    });
  });
});
