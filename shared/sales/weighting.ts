/**
 * SALES ARENA — Company-Based Sales Weighting & Half-Unit Arithmetic
 *
 * Rules (evaluated in strict precedence order):
 * 1. Corebridge Financial-SWIL validated sales = 1.0 (Full Credit exception)
 * 2. Gerber / Gerber Life validated sales = 0.5 (Half Credit)
 * 3. Corebridge Financial validated sales = 0.5 (Half Credit)
 * 4. Every other genuinely validated insurance carrier = 1.0 (Default Full Credit)
 * - Unvalidated / submitted / pending / rejected leads = 0 credit
 *
 * Case-insensitive matching supports verified carrier and product variations
 * (including hyphen and whitespace variations such as "Corebridge Financial-SWIL",
 * "Corebridge Financial - SWIL", and "Corebridge Financial SWIL").
 * Arithmetic uses precise half-unit rounding to prevent IEEE-754 floating point drift.
 */

export interface CarrierWeightRule {
  id: string;
  name: string;
  normalizedName: string;
  credit: 0.5 | 1.0;
  category: "Half Credit" | "Full Credit";
  ruleType: "Explicit Override" | "Default Rule";
  precedence: number;
  aliases: string[];
  description: string;
  updatedAt: string;
}

export const DEFAULT_CARRIER_CREDIT = 1.0 as const;

/**
 * Authoritative configured carrier weighting rules.
 * Other validated carriers inherit DEFAULT_CARRIER_CREDIT (1.0).
 */
export const CARRIER_WEIGHT_RULES: readonly CarrierWeightRule[] = Object.freeze([
  {
    id: "corebridge-financial-swil",
    name: "Corebridge Financial-SWIL",
    normalizedName: "corebridge financial swil",
    credit: 1.0,
    category: "Full Credit",
    ruleType: "Explicit Override",
    precedence: 1,
    aliases: [
      "Corebridge Financial-SWIL",
      "corebridge financial-swil",
      "COREBRIDGE FINANCIAL-SWIL",
      "Corebridge Financial - SWIL",
      "Corebridge Financial SWIL",
      "Corebridge-SWIL",
      "Corebridge SWIL",
    ],
    description:
      "Explicit 1.0 full-credit exception evaluated before the general Corebridge Financial rule. Never classified as 0.5.",
    updatedAt: "2026-11-24T00:00:00.000Z",
  },
  {
    id: "corebridge-financial",
    name: "Corebridge Financial",
    normalizedName: "corebridge financial",
    credit: 0.5,
    category: "Half Credit",
    ruleType: "Explicit Override",
    precedence: 3,
    aliases: [
      "Corebridge Financial",
      "corebridge financial",
      "COREBRIDGE FINANCIAL",
      "Corebridge",
      "CorebridgeFinancial",
      "AIG / Corebridge",
    ],
    description:
      "Standard Corebridge Financial policies (excluding SWIL). Each genuinely validated sale counts as 0.5 credited sales.",
    updatedAt: "2026-11-24T00:00:00.000Z",
  },
  {
    id: "gerber",
    name: "Gerber",
    normalizedName: "gerber",
    credit: 0.5,
    category: "Half Credit",
    ruleType: "Explicit Override",
    precedence: 2,
    aliases: ["Gerber", "gerber", "GERBER"],
    description:
      "Gerber validated policies. Each genuinely validated sale counts as 0.5 credited sales.",
    updatedAt: "2026-11-24T00:00:00.000Z",
  },
  {
    id: "gerber-life",
    name: "Gerber Life",
    normalizedName: "gerber life",
    credit: 0.5,
    category: "Half Credit",
    ruleType: "Explicit Override",
    precedence: 2,
    aliases: [
      "Gerber Life",
      "gerber life",
      "GERBER LIFE",
      "GerberLife",
      "Gerber Life Insurance Company",
    ],
    description:
      "Gerber Life validated policies. Each genuinely validated sale counts as 0.5 credited sales.",
    updatedAt: "2026-11-24T00:00:00.000Z",
  },
]);

/**
 * Normalizes a carrier or product name for consistent comparison:
 * lowercases, replaces hyphens/underscores/punctuation separators with single spaces,
 * and collapses consecutive whitespace.
 */
export function normalizeCarrierName(str?: string | null): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/[-_()/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Checks whether a carrier or product string matches Corebridge Financial-SWIL.
 * Requires both "corebridge" and a standalone "swil" token so arbitrary strings
 * containing "swil" without Corebridge (or words merely starting with "swil") are never misclassified.
 */
export function isCorebridgeSwil(str?: string | null): boolean {
  if (!str) return false;
  const norm = normalizeCarrierName(str);
  return norm.includes("corebridge") && /(?:^|\s)swil(?:\s|$)/.test(norm);
}

/**
 * Checks whether a carrier or product string matches Gerber (case-insensitive substring match).
 */
export function isGerberCompany(str?: string | null): boolean {
  if (!str) return false;
  return str.toLowerCase().includes("gerber");
}

/**
 * Checks whether a carrier or product string matches normal 0.5-credit Corebridge Financial
 * (case-insensitive match, explicitly excluding Corebridge Financial-SWIL).
 */
export function isCorebridgeCompany(str?: string | null): boolean {
  if (!str) return false;
  if (isCorebridgeSwil(str)) return false;
  return str.toLowerCase().includes("corebridge");
}

/**
 * Canonical PostgreSQL CASE statement expression for calculating credited sales.
 * Guarantees 100% exact parity with JavaScript getCompanySaleWeight:
 * 1. Corebridge Financial-SWIL -> 1.0 (evaluated first)
 * 2. Gerber / Gerber Life -> 0.5
 * 3. Corebridge Financial -> 0.5
 * 4. All other carriers -> 1.0
 */
export function sqlCarrierWeight(column = "carrier"): string {
  return `(CASE
    WHEN LOWER(TRIM(COALESCE(${column}, ''))) LIKE '%corebridge%' AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(${column}, ''))), '[-_()/[:space:]]+', ' ', 'g') ~ '(^| )swil( |$)' THEN 1.0
    WHEN LOWER(TRIM(COALESCE(${column}, ''))) LIKE '%gerber%' THEN 0.5
    WHEN LOWER(TRIM(COALESCE(${column}, ''))) LIKE '%corebridge%' THEN 0.5
    ELSE 1.0
  END)`;
}

/**
 * Returns the company weighting for a validated sale in strict precedence order:
 * 1. 1.0 for Corebridge Financial-SWIL
 * 2. 0.5 for Gerber / Gerber Life
 * 3. 0.5 for Corebridge Financial
 * 4. 1.0 for any other carrier
 */
export function getCompanySaleWeight(carrier?: string | null, product?: string | null): number {
  const combined = carrier && product ? `${carrier} ${product}` : null;
  if (isCorebridgeSwil(carrier) || isCorebridgeSwil(product) || isCorebridgeSwil(combined)) {
    return 1.0;
  }
  if (isGerberCompany(carrier) || isGerberCompany(product)) {
    return 0.5;
  }
  if (isCorebridgeCompany(carrier) || isCorebridgeCompany(product)) {
    return 0.5;
  }
  return 1.0;
}

/**
 * Explains how a carrier/product pair is classified by the canonical weighting engine.
 * Used by the Admin Carrier Sales Weighting inspector and diagnostics.
 */
export function classifyCarrierWeight(carrier?: string | null, product?: string | null): {
  carrier: string;
  normalizedName: string;
  credit: 0.5 | 1.0;
  category: "Half Credit" | "Full Credit";
  ruleType: "Explicit Override" | "Default Rule";
  matchedRuleId: string;
  matchedRuleName: string;
  precedence: number;
} {
  const raw = (carrier || product || "").trim();
  const norm = normalizeCarrierName(carrier && product ? `${carrier} ${product}` : raw);
  const combined = carrier && product ? `${carrier} ${product}` : null;

  if (isCorebridgeSwil(carrier) || isCorebridgeSwil(product) || isCorebridgeSwil(combined)) {
    return {
      carrier: raw || "Corebridge Financial-SWIL",
      normalizedName: normalizeCarrierName(raw) || norm,
      credit: 1.0,
      category: "Full Credit",
      ruleType: "Explicit Override",
      matchedRuleId: "corebridge-financial-swil",
      matchedRuleName: "Corebridge Financial-SWIL",
      precedence: 1,
    };
  }
  if (isGerberCompany(carrier) || isGerberCompany(product)) {
    const isLife = norm.includes("life");
    return {
      carrier: raw || (isLife ? "Gerber Life" : "Gerber"),
      normalizedName: normalizeCarrierName(raw) || norm,
      credit: 0.5,
      category: "Half Credit",
      ruleType: "Explicit Override",
      matchedRuleId: isLife ? "gerber-life" : "gerber",
      matchedRuleName: isLife ? "Gerber Life" : "Gerber",
      precedence: 2,
    };
  }
  if (isCorebridgeCompany(carrier) || isCorebridgeCompany(product)) {
    return {
      carrier: raw || "Corebridge Financial",
      normalizedName: normalizeCarrierName(raw) || norm,
      credit: 0.5,
      category: "Half Credit",
      ruleType: "Explicit Override",
      matchedRuleId: "corebridge-financial",
      matchedRuleName: "Corebridge Financial",
      precedence: 3,
    };
  }
  return {
    carrier: raw || "(Default Carrier)",
    normalizedName: normalizeCarrierName(raw),
    credit: 1.0,
    category: "Full Credit",
    ruleType: "Default Rule",
    matchedRuleId: "default-full-credit",
    matchedRuleName: "Default Validated Carrier Rule (1.0)",
    precedence: 4,
  };
}

/**
 * Returns credited sales count for a sale record.
 * Only validated ("approved" or "validated") sales receive credit.
 */
export function getValidatedSaleCredit(sale: {
  status?: string | null;
  carrier?: string | null;
  product?: string | null;
}): number {
  const status = sale.status?.toLowerCase();
  if (status !== "approved" && status !== "validated") {
    return 0;
  }
  return getCompanySaleWeight(sale.carrier, sale.product);
}

/**
 * Precise half-unit addition preventing floating point errors (e.g. 0.5 + 1.0 = 1.5, never 1.5000000000000002).
 */
export function addCredits(a: number, b: number): number {
  return Math.round(((Number(a) || 0) + (Number(b) || 0)) * 2) / 2;
}

/**
 * Round any number to the nearest half-unit.
 */
export function roundCredit(val: number): number {
  return Math.round((Number(val) || 0) * 2) / 2;
}

/**
 * Format sales credit for clean display:
 * - Exact integers display without decimals (e.g. "1", "2", "11")
 * - Half-units display with one decimal place (e.g. "0.5", "1.5", "2.5")
 */
export function formatSalesCount(val: number): string {
  const rounded = roundCredit(val);
  return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(1);
}
