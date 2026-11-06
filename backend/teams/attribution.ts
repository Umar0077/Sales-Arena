import type { Pool, PoolClient } from "pg";
import { businessToday, type BusinessClock } from "@/shared/time/business";
import { calendarFrom, readArenaConfig } from "../settings/arena-config";

/**
 * Which team a validated sale belongs to (read-only; used only to choose the Teams Arena presentation).
 *
 * Policy (the same as the Teams Arena standings): the agent is identified by the sale's `user_code` (never by
 * a display name), and the team is the one the agent belonged to on the sale's BUSINESS DAY (the day of
 * `validated_at` in the configured business timezone, America/New_York by default). A transfer therefore never
 * moves a sale: a sale before the effective date stays with the old team, a sale on / after it goes to the new.
 *
 * Result:
 *  - a team (with `active`), or
 *  - null when the agent had no team that day (unassigned).
 * The caller treats a failed lookup as "unknown" and the display falls back to the existing sale popup.
 */

export interface SaleTeam {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  /** A static path (e.g. /teams/team-sigma.webp) only. Uploaded logos (data URLs, up to 300 KB) are not sent on
   *  every sale event: displays already have them from the standings (hasLogo tells them one exists). */
  logoUrl: string | null;
  hasLogo: boolean;
  color: string;
  accentSecondary: string | null;
  /** The business day the membership was resolved for (YYYY-MM-DD). */
  businessDate: string;
}

type Db = Pool | PoolClient;

const SQL = `
  SELECT q.ord, t.id, t.slug, t.name, t.active, CASE WHEN t.logo_url LIKE '/%' THEN t.logo_url END AS logo_path,
         (t.logo_url IS NOT NULL) AS has_logo, t.color, t.accent_secondary
    FROM unnest($1::text[], $2::date[]) WITH ORDINALITY AS q(user_code, day, ord)
    JOIN team_memberships m ON m.user_code = q.user_code AND m.effective_from <= q.day AND (m.effective_to IS NULL OR m.effective_to > q.day)
    JOIN teams t ON t.id = m.team_id AND t.slug IS NOT NULL`;

async function clockOf(db: Db, clock?: BusinessClock): Promise<BusinessClock> {
  return clock ?? calendarFrom((await readArenaConfig(db)).values);
}

/** Teams for several sales in ONE query. Index i of the result belongs to sales[i]. */
export async function teamsForSales(db: Db, sales: Array<{ userCode: string; validatedAt: string | Date }>, clock?: BusinessClock): Promise<Array<SaleTeam | null>> {
  if (!sales.length) return [];
  const c = await clockOf(db, clock);
  const codes = sales.map((s) => String(s.userCode).trim().toUpperCase());
  const days = sales.map((s) => businessToday(c, new Date(s.validatedAt)));
  const { rows } = await db.query(SQL, [codes, days]);
  const out: Array<SaleTeam | null> = sales.map(() => null);
  for (const r of rows) {
    const i = Number(r.ord) - 1;
    // Memberships never overlap (one open membership per agent, effective-dated); keep the first if they ever did.
    if (out[i]) continue;
    out[i] = {
      id: r.id,
      slug: r.slug,
      name: r.name,
      active: Boolean(r.active),
      logoUrl: r.logo_path ?? null,
      hasLogo: Boolean(r.has_logo),
      color: r.color,
      accentSecondary: r.accent_secondary ?? null,
      businessDate: days[i],
    };
  }
  return out;
}

export async function teamForSale(db: Db, userCode: string, validatedAt: string | Date, clock?: BusinessClock): Promise<SaleTeam | null> {
  return (await teamsForSales(db, [{ userCode, validatedAt }], clock))[0] ?? null;
}
