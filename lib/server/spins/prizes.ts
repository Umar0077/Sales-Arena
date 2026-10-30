/** Prize (spinner reward) validation shared by the catalog API routes. */

const ICONS = ["trophy", "gift", "package", "headphones", "badge", "sparkles", "coffee", "ticket", "star", "crown", "rocket", "medal"];

export interface PrizeInput {
  title: string;
  description: string;
  icon: string;
  color: string;
  active: boolean;
  quantity: number | null;
  weight: number;
  displayOrder: number;
}

/** Validates and normalises a prize; returns [prize, null] or [null, error]. */
export function parsePrize(b: Record<string, unknown>): [PrizeInput, null] | [null, string] {
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (title.length < 2 || title.length > 40) return [null, "Prize title must be 2–40 characters."];
  const description = typeof b.description === "string" ? b.description.trim().slice(0, 200) : "";
  const icon = typeof b.icon === "string" && ICONS.includes(b.icon) ? b.icon : null;
  if (!icon) return [null, "Choose a valid icon."];
  const color = typeof b.color === "string" && /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : null;
  if (!color) return [null, "Colour must be a hex value like #FFC857."];
  const quantity = b.quantity === null || b.quantity === "" || b.quantity === undefined ? null : Number(b.quantity);
  if (quantity !== null && (!Number.isInteger(quantity) || quantity < 0 || quantity > 1_000_000)) return [null, "Stock must be a whole number ≥ 0, or empty for unlimited."];
  const weight = Number(b.weight ?? 1);
  if (!Number.isFinite(weight) || weight <= 0 || weight > 1000) return [null, "Weight must be between 0.01 and 1000."];
  const displayOrder = Number(b.displayOrder ?? 0);
  if (!Number.isInteger(displayOrder) || displayOrder < 0 || displayOrder > 1000) return [null, "Order must be a whole number from 0 to 1000."];
  return [{ title, description, icon, color, active: b.active !== false, quantity, weight, displayOrder }, null];
}
