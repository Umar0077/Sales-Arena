import type { Reward, RewardIcon } from "@/types";
import { HEX_COLOR } from "@/lib/utils";

export const REWARD_ICONS: RewardIcon[] = [
  "trophy", "gift", "package", "headphones", "badge", "sparkles",
  "coffee", "ticket", "star", "crown", "rocket", "medal",
];

export const MIN_SEGMENTS = 4;
export const MAX_SEGMENTS = 12;
export const MAX_TITLE = 22;

export type RewardDraft = Omit<Reward, "id" | "order"> & { id?: string };

export interface ValidationResult {
  valid: boolean;
  errors: Partial<Record<keyof RewardDraft | "form", string>>;
}

export function validateReward(draft: RewardDraft, existing: Reward[]): ValidationResult {
  const errors: ValidationResult["errors"] = {};
  const title = draft.title.trim();
  if (!title) errors.title = "Title is required.";
  else if (title.length > MAX_TITLE) errors.title = `Keep titles to ${MAX_TITLE} characters so they stay readable on the wheel.`;
  else if (existing.some((r) => r.id !== draft.id && r.title.trim().toLowerCase() === title.toLowerCase()))
    errors.title = "Another reward already uses this title.";
  if (draft.description.length > 120) errors.description = "Description must be 120 characters or fewer.";
  if (!HEX_COLOR.test(draft.color)) errors.color = "Use a 6-digit hex colour, e.g. #7568FF.";
  if (!REWARD_ICONS.includes(draft.icon)) errors.icon = "Choose an icon.";
  if (draft.quantity !== null && (!Number.isInteger(draft.quantity) || draft.quantity < 0))
    errors.quantity = "Quantity must be a whole number ≥ 0, or unlimited.";
  if (!Number.isFinite(draft.weight) || draft.weight <= 0 || draft.weight > 100)
    errors.weight = "Weight must be between 0.1 and 100.";

  // Wheel-level constraints after applying this change.
  if (Object.keys(errors).length === 0) {
    const next = draft.id
      ? existing.map((r) => (r.id === draft.id ? { ...r, ...draft, id: r.id } : r))
      : [...existing, { ...draft, id: "__new__", order: existing.length }];
    const wheel = validateWheel(next as Reward[]);
    if (!wheel.valid) errors.form = wheel.message;
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateWheel(rewards: Reward[]): { valid: boolean; message?: string } {
  const active = rewards.filter((r) => r.active);
  if (active.length < MIN_SEGMENTS)
    return { valid: false, message: `The wheel needs at least ${MIN_SEGMENTS} active rewards (currently ${active.length}).` };
  if (active.length > MAX_SEGMENTS)
    return { valid: false, message: `The wheel supports at most ${MAX_SEGMENTS} active rewards for legibility (currently ${active.length}).` };
  if (!active.some((r) => r.weight > 0 && (r.quantity === null || r.quantity > 0)))
    return { valid: false, message: "At least one active reward must have stock and a positive weight." };
  return { valid: true };
}
