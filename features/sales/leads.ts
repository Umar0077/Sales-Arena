import type { Agent, Sale, SaleStatus } from "@/types";
import type { ArenaData } from "@/lib/mock-api/schema";
import { hashString } from "@/lib/utils";

/**
 * Single source of truth for lead counts.
 * Every lead the dialer sends is a Sale record for today. Only "approved" leads are
 * validated sales; pending, rejected and duplicate leads are submitted but never
 * validated. Leaderboard, closed rate and spin eligibility all read these counts.
 */

export function isValidated(sale: Pick<Sale, "status">): boolean {
  return sale.status === "approved";
}

export interface LeadCounts {
  /** Every lead submitted today, whatever its status. */
  submitted: number;
  /** Approved / validated sales. The only leads that earn spins. */
  validated: number;
  pending: number;
  rejected: number;
  duplicate: number;
}

const empty = (): LeadCounts => ({ submitted: 0, validated: 0, pending: 0, rejected: 0, duplicate: 0 });

/** Per-agent lead counts. Records with a repeated id are counted once. */
export function leadCountsByAgent(sales: Sale[]): Map<string, LeadCounts> {
  const map = new Map<string, LeadCounts>();
  const seen = new Set<string>();
  for (const s of sales) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    let c = map.get(s.agentId);
    if (!c) map.set(s.agentId, (c = empty()));
    c.submitted++;
    const key: Exclude<SaleStatus, "approved"> | "validated" = s.status === "approved" ? "validated" : s.status;
    c[key]++;
  }
  return map;
}

/** Policy closed rate: validated ÷ submitted × 100 (0 when nothing was submitted). */
export function closedRate(c: Pick<LeadCounts, "submitted" | "validated">): number {
  return c.submitted > 0 ? (c.validated / c.submitted) * 100 : 0;
}

/** Stable, readable closer ID shown under the name, e.g. "CLS-FF485B25". */
export function closerCode(agent: Pick<Agent, "id">): string {
  const a = hashString(agent.id) >>> 0;
  const b = hashString(`${agent.id}:cls`) >>> 0;
  return `CLS-${((a ^ (b << 7)) >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

export interface CloserRow {
  agent: Agent;
  code: string;
  teamId: string;
  counts: LeadCounts;
  rate: number;
  rank: number;
}

export interface CloserFilter {
  teamId?: string | null;
  campaignId?: string | null;
  limit?: number;
}

/** Today's closers: validated sales first, then submitted leads, then name. Agents with no leads are left out. */
export function rankClosers(data: Pick<ArenaData, "agents" | "sales">, filter: CloserFilter = {}): CloserRow[] {
  const counts = leadCountsByAgent(data.sales);
  const rows = data.agents
    .filter(
      (a) =>
        a.active &&
        (!filter.teamId || a.teamId === filter.teamId) &&
        (!filter.campaignId || a.campaignId === filter.campaignId) &&
        (counts.get(a.id)?.submitted ?? 0) > 0,
    )
    .map((agent) => {
      const c = counts.get(agent.id)!;
      return { agent, code: closerCode(agent), teamId: agent.teamId, counts: c, rate: closedRate(c), rank: 0 };
    })
    .sort(
      (x, y) =>
        y.counts.validated - x.counts.validated ||
        y.counts.submitted - x.counts.submitted ||
        x.agent.name.localeCompare(y.agent.name),
    );
  rows.forEach((r, i) => (r.rank = i + 1));
  return filter.limit ? rows.slice(0, filter.limit) : rows;
}
