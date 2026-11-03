import type { CubAward, CubSale } from "./machine";

/**
 * Arena Cub dialogue. Short, encouraging, never about a specific person's low performance.
 * Names and amounts only ever come from the real sale / award payload.
 */
export const PHRASES = {
  intro: ["Hey team! I'm Arena Cub!", "Feed me validated sales!", "Let's make this Arena roar!"],
  hungry: ["I'm getting hungry!", "Who's bringing the next validated sale?", "Feed me a sale, team!", "I could really use a validated sale!"],
  angry: ["Hey team! Where did the sales go?", "Still waiting for my next snack!", "Come on, team! Let's get moving!"],
  sad: ["It's a quiet stretch. Cheer me up with a sale!", "One validated sale would make my day!", "I'm still hungry…"],
  feeding: ["YUM! A validated sale!", "Great job, team!", "That's the energy I needed!"],
  bonus: ["New bonus tier unlocked!", "What a milestone!"],
} as const;

export type PhraseCategory = keyof typeof PHRASES;

let rot = 0;
/** Rotates through a category (deterministic when a seed is given, e.g. a reminder key shared by all screens). */
export function phrase(cat: PhraseCategory, seed?: string): string {
  const list = PHRASES[cat];
  if (seed !== undefined) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return list[h % list.length];
  }
  return list[rot++ % list.length];
}

const firstName = (n: string) => n.trim().split(/\s+/)[0] || n;
const money = (amount: number, currency: string) => `${currency} ${Math.round(amount).toLocaleString("en-US")}`;
const KIND: Record<CubAward["kind"], string> = { daily: "daily", weekly: "weekly", monthly: "monthly" };

/** Feeding line: count is exact even when a burst is coalesced into one celebration. */
export function feedingLines(sales: CubSale[]): { title: string; detail: string | null } {
  if (sales.length > 1) return { title: `YUM! ${sales.length} validated sales!`, detail: "Great work, team!" };
  const s = sales[0];
  return { title: phrase("feeding"), detail: s?.agentName ? `Great work, ${firstName(s.agentName)}!` : null };
}

/**
 * Bonus line from the real bonus_awards payload. Highest-tier upgrades show the new TOTAL and the real
 * increase (never the sum of tiers). Non-cash prizes show their label, never an invented amount.
 */
export function bonusLines(awards: CubAward[]): { title: string; detail: string | null } {
  if (!awards.length) return { title: phrase("bonus"), detail: null };
  if (awards.length > 1) return { title: "What a milestone!", detail: `${awards.length} bonus tiers unlocked!` };
  const a = awards[0];
  const who = firstName(a.agentName);
  if ((a.rewardType ?? "cash") !== "cash") return { title: "New bonus tier unlocked!", detail: `${who} won ${a.prizeLabel || "a prize"}!` };
  if (a.upgrade && Number(a.incrementAmount) > 0)
    return { title: "Bonus upgraded!", detail: `${who}: ${money(a.amount, a.currency)} ${KIND[a.kind]} total (+${money(Number(a.incrementAmount), a.currency)})` };
  return { title: "New bonus tier unlocked!", detail: `${who} earned the ${money(a.amount, a.currency)} ${KIND[a.kind]} bonus!` };
}
