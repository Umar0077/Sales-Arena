"use client";

import { useSettingsStore } from "@/frontend/stores/settings-store";

export interface VoiceInfo {
  name: string;
  lang: string;
  voiceURI: string;
  localService: boolean;
  default: boolean;
}

export interface AnnounceSaleOptions {
  /** Stable celebration/sale event id for strict single-announcement deduplication. */
  eventId: string;
  /** Canonical agent display name (e.g. "Arsam Idrees"). */
  agentName: string | null | undefined;
  /** Optional scoped owner token so unmounting/skipping can cancel only its own pending request. */
  ownerToken?: string;
  /** True for local Admin test/preview (bypasses production event deduplication). */
  preview?: boolean;
  /** Optional explicit overrides (used in Admin test controls). */
  voiceOverride?: string;
  volumeOverride?: number;
  rateOverride?: number;
  templateOverride?: string;
}

export type VoiceAnnounceResult = "spoken" | "disabled" | "muted" | "duplicate" | "hidden" | "unsupported" | "cancelled" | "failed";

const SEEN_MAX = 300;
const SPEECH_TIMEOUT_MS = 5500;
const announcedEventIds: string[] = [];
const cancelledTokens = new Set<string>();
let activeOwnerToken: string | null = null;
let speechQueue: Promise<void> = Promise.resolve();

/**
 * Formats `{Agent Name} got a sale!` cleanly without internal IDs, carriers, or financial values.
 */
export function formatSaleAnnouncement(
  agentName: string | null | undefined,
  template = "{Agent Name} got a sale!",
): string {
  const cleanName = (agentName ?? "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\bCLS-[A-Z0-9-]+\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const safeName = cleanName || "Our top closer";
  const tpl = (template || "{Agent Name} got a sale!").trim() || "{Agent Name} got a sale!";
  const replaced = tpl
    .replace(/\{agent\s*name\}/gi, safeName)
    .replace(/\{agent\}/gi, safeName);
  return replaced.replace(/\s+/g, " ").trim();
}

const PREFERRED_FEMALE_NAMES = [
  "microsoft aria online",
  "microsoft jenny online",
  "microsoft ava online",
  "microsoft emma online",
  "microsoft sonia online",
  "microsoft libby online",
  "microsoft zira",
  "microsoft hazel",
  "microsoft susan",
  "microsoft eva",
  "google us english",
  "google uk english female",
  "samantha",
  "victoria",
  "karen",
  "moira",
  "tessa",
  "serena",
  "natasha",
  "clara",
  "neerja",
  "aria",
  "jenny",
  "ava",
  "emma",
  "zira",
  "female",
];

const MALE_OR_ROBOTIC_PENALTY = [
  "david",
  "mark",
  "george",
  "daniel",
  "alex",
  "james",
  "ryan",
  "guy",
  "christopher",
  "eric",
  "steffan",
  "ravi",
  "prabhat",
  "male",
  "espeak",
  "festival",
  "albert",
  "bad news",
  "bahh",
  "bells",
  "boing",
  "bubbles",
  "cellos",
  "deranged",
  "good news",
  "hysterical",
  "pipe organ",
  "trinoids",
  "whisper",
  "zarvox",
];

/**
 * Scores installed browser voices to select a pleasant, natural English female voice,
 * falling back cleanly to any English voice or system default when needed.
 */
export function selectPreferredFemaleVoice<T extends Pick<SpeechSynthesisVoice, "name" | "lang" | "voiceURI" | "default">>(
  voices: readonly T[],
  preferredName?: string,
): T | null {
  if (!voices.length) return null;

  if (preferredName && preferredName.trim()) {
    const wanted = preferredName.trim().toLowerCase();
    const exact = voices.find(
      (v) => v.name.toLowerCase() === wanted || v.voiceURI.toLowerCase() === wanted,
    );
    if (exact) return exact;
  }

  let best: T | null = null;
  let bestScore = -Infinity;

  for (const voice of voices) {
    const name = voice.name.toLowerCase();
    const lang = (voice.lang || "").toLowerCase();
    let score = 0;

    if (lang.startsWith("en-us")) score += 50;
    else if (lang.startsWith("en-gb") || lang.startsWith("en-au") || lang.startsWith("en-ca")) score += 42;
    else if (lang.startsWith("en")) score += 35;
    else score -= 100;

    if (name.includes("online") || name.includes("natural") || name.includes("neural")) score += 30;
    if (name.includes("google")) score += 16;

    const femaleIdx = PREFERRED_FEMALE_NAMES.findIndex((p) => name.includes(p));
    if (femaleIdx !== -1) {
      score += 80 - femaleIdx;
    }

    if (MALE_OR_ROBOTIC_PENALTY.some((bad) => name.includes(bad))) {
      score -= 70;
    }

    if (voice.default) score += 3;

    if (score > bestScore) {
      bestScore = score;
      best = voice;
    }
  }

  return best ?? voices[0] ?? null;
}

function getSpeechSynthesisApi(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return null;
  return window.speechSynthesis;
}

/** Lists real voices installed in the current browser (never fabricates voices). */
export function listAvailableVoices(): VoiceInfo[] {
  const synth = getSpeechSynthesisApi();
  if (!synth) return [];
  try {
    return synth.getVoices().map((v) => ({
      name: v.name,
      lang: v.lang,
      voiceURI: v.voiceURI,
      localService: v.localService,
      default: v.default,
    }));
  } catch {
    return [];
  }
}

export function subscribeVoicesChanged(cb: () => void): () => void {
  const synth = getSpeechSynthesisApi();
  if (!synth) return () => {};
  const handler = () => cb();
  if (typeof synth.addEventListener === "function") {
    synth.addEventListener("voiceschanged", handler);
    return () => synth.removeEventListener("voiceschanged", handler);
  }
  return () => {};
}

async function resolveVoices(synth: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
  let voices = synth.getVoices();
  if (voices.length > 0) return voices;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (typeof synth.removeEventListener === "function") {
        synth.removeEventListener("voiceschanged", onChange);
      }
      resolve();
    };
    const onChange = () => {
      if (synth.getVoices().length > 0) finish();
    };
    const timer = setTimeout(finish, 250);
    if (typeof synth.addEventListener === "function") {
      synth.addEventListener("voiceschanged", onChange);
    }
  });
  voices = synth.getVoices();
  return voices;
}

/**
 * Cancels only a speech request owned by `ownerToken` (never interrupts unrelated audio).
 */
export function cancelVoiceAnnouncement(ownerToken: string): void {
  if (!ownerToken) return;
  cancelledTokens.add(ownerToken);
  if (activeOwnerToken === ownerToken) {
    const synth = getSpeechSynthesisApi();
    try {
      synth?.cancel();
    } catch {
      /* ignore */
    }
  }
}

function speakUtterance(
  synth: SpeechSynthesis,
  text: string,
  voice: SpeechSynthesisVoice | null,
  volume: number,
  rate: number,
  ownerToken: string,
): Promise<VoiceAnnounceResult> {
  return new Promise<VoiceAnnounceResult>((resolve) => {
    if (cancelledTokens.has(ownerToken)) {
      resolve("cancelled");
      return;
    }

    let settled = false;
    const finish = (res: VoiceAnnounceResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (activeOwnerToken === ownerToken) activeOwnerToken = null;
      resolve(res);
    };

    const timer = setTimeout(() => {
      try {
        if (activeOwnerToken === ownerToken) synth.cancel();
      } catch {
        /* ignore */
      }
      finish("spoken");
    }, SPEECH_TIMEOUT_MS);

    try {
      const utter = new SpeechSynthesisUtterance(text);
      if (voice) {
        utter.voice = voice;
        if (voice.lang) utter.lang = voice.lang;
      } else {
        utter.lang = "en-US";
      }
      utter.volume = Math.max(0, Math.min(1, volume));
      utter.rate = Math.max(0.7, Math.min(1.4, rate));
      utter.pitch = 1.04;

      utter.onend = () => finish("spoken");
      utter.onerror = () => finish("failed");

      activeOwnerToken = ownerToken;
      synth.speak(utter);
    } catch {
      finish("failed");
    }
  });
}

/**
 * Queues a friendly female voice announcement for a validated sale celebration.
 * - Deduplicates by `eventId` for live events.
 * - Serializes multiple rapid sales so announcements never overlap or mix names.
 * - Never blocks the celebration queue if TTS is unavailable, muted, or fails.
 */
export function announceSaleVoice(opts: AnnounceSaleOptions): Promise<VoiceAnnounceResult> {
  const s = useSettingsStore.getState();
  if (!opts.preview && s.voiceAnnouncerEnabled === false) {
    return Promise.resolve("disabled");
  }
  if (!opts.preview && s.soundEnabled === false) {
    return Promise.resolve("muted");
  }
  if (typeof document !== "undefined" && document.visibilityState === "hidden" && !opts.preview) {
    return Promise.resolve("hidden");
  }
  if (!opts.preview) {
    if (announcedEventIds.includes(opts.eventId)) {
      return Promise.resolve("duplicate");
    }
    announcedEventIds.push(opts.eventId);
    if (announcedEventIds.length > SEEN_MAX) announcedEventIds.shift();
  }

  const synth = getSpeechSynthesisApi();
  if (!synth) return Promise.resolve("unsupported");

  const ownerToken = opts.ownerToken || `voice_${opts.eventId}_${Date.now()}`;
  const text = formatSaleAnnouncement(
    opts.agentName,
    opts.templateOverride ?? s.voiceAnnouncerTemplate ?? "{Agent Name} got a sale!",
  );
  const voiceVol = opts.volumeOverride ?? s.voiceAnnouncerVolume ?? 0.85;
  const masterVol = opts.preview ? 1 : (s.volume ?? 0.7);
  const effectiveVolume = Math.max(0, Math.min(1, voiceVol * masterVol));
  const rate = opts.rateOverride ?? s.voiceAnnouncerRate ?? 1.0;
  const preferredVoice = opts.voiceOverride ?? s.voiceAnnouncerVoice ?? "";

  const run = async (): Promise<VoiceAnnounceResult> => {
    if (cancelledTokens.has(ownerToken)) return "cancelled";
    const voices = await resolveVoices(synth);
    if (cancelledTokens.has(ownerToken)) return "cancelled";
    const chosen = selectPreferredFemaleVoice(voices, preferredVoice);
    return speakUtterance(synth, text, chosen, effectiveVolume, rate, ownerToken);
  };

  const resultPromise = speechQueue.then(run, run);
  speechQueue = resultPromise.then(
    () => undefined,
    () => undefined,
  );
  return resultPromise;
}

/** Local Admin test helper (plays only in Admin browser, never mutates sales/SSE/DB). */
export function testVoiceAnnouncement(opts: {
  agentName: string;
  voiceName?: string;
  volume?: number;
  rate?: number;
  template?: string;
}): Promise<VoiceAnnounceResult> {
  return announceSaleVoice({
    eventId: `admin_voice_test_${Date.now()}`,
    agentName: opts.agentName,
    ownerToken: `admin_voice_test_${Date.now()}`,
    preview: true,
    voiceOverride: opts.voiceName,
    volumeOverride: opts.volume,
    rateOverride: opts.rate,
    templateOverride: opts.template,
  });
}

/** Test-only reset hook. */
export function __resetVoiceAnnouncerForTests(): void {
  announcedEventIds.length = 0;
  cancelledTokens.clear();
  activeOwnerToken = null;
  speechQueue = Promise.resolve();
}
