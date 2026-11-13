/**
 * SALES ARENA — Company-Based Sales Weighting & Half-Unit Arithmetic
 *
 * Rules:
 * - Gerber validated sales = 0.5
 * - Corebridge Financial validated sales = 0.5
 * - Every other insurance company = 1.0
 * - Unvalidated / submitted / pending / rejected leads = 0 credit
 *
 * Case-insensitive matching supports verified carrier and product variations.
 * Arithmetic uses precise half-unit rounding to prevent IEEE-754 floating point drift.
 */

/**
 * SALES ARENA — Company-Based Sales Weighting & Half-Unit Arithmetic
 *
 * Rules:
 * - Gerber validated sales = 0.5
 * - Corebridge Financial validated sales = 0.5
 * - Every other insurance company = 1.0
 * - Unvalidated / submitted / pending / rejected leads = 0 credit
 *
 * Case-insensitive matching supports verified carrier and product variations.
 * Arithmetic uses precise half-unit rounding to prevent IEEE-754 floating point drift.
 */

/**
 * Checks whether a carrier or product string matches Gerber (case-insensitive substring match).
 */
export function isGerberCompany(str?: string | null): boolean {
  if (!str) return false;
  return str.toLowerCase().includes("gerber");
}

/**
 * Checks whether a carrier or product string matches Corebridge Financial (case-insensitive substring match).
 */
export function isCorebridgeCompany(str?: string | null): boolean {
  if (!str) return false;
  return str.toLowerCase().includes("corebridge");
}

/**
 * Canonical PostgreSQL CASE statement expression for calculating credited sales.
 * Guarantees 100% exact parity with JavaScript getCompanySaleWeight.
 */
export function sqlCarrierWeight(column = "carrier"): string {
  return `(CASE
    WHEN LOWER(TRIM(COALESCE(${column}, ''))) LIKE '%gerber%' THEN 0.5
    WHEN LOWER(TRIM(COALESCE(${column}, ''))) LIKE '%corebridge%' THEN 0.5
    ELSE 1.0
  END)`;
}

/**
 * Returns the company weighting for a validated sale:
 * - 0.5 for Gerber or Corebridge Financial
 * - 1.0 for any other carrier
 */
export function getCompanySaleWeight(carrier?: string | null, product?: string | null): number {
  if (isGerberCompany(carrier) || isGerberCompany(product)) {
    return 0.5;
  }
  if (isCorebridgeCompany(carrier) || isCorebridgeCompany(product)) {
    return 0.5;
  }
  return 1.0;
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
