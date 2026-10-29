import type { Agent, Sale } from "@/types";
import type { CloserRow, LeadCounts } from "@/features/sales/leads";
import type {
  SafeQuoteCloserItem,
  SafeQuoteSaleItem,
  SafeQuoteSummary,
  NormalizedSaleEvent,
} from "./schemas";
import { hashString } from "@/lib/utils";

/**
 * Extract closer name and userCode from the SafeQuote closer field
 */
export function extractCloserIdentity(closer: SafeQuoteSaleItem["closer"]): {
  userCode: string;
  name: string;
} {
  if (typeof closer === "string") {
    // Check if closer string contains code, e.g. "John Doe (CLS-123)" or "CLS-123"
    const match = closer.match(/^(.+?)\s*\((CLS-[A-Za-z0-9_-]+)\)$/i);
    if (match) {
      return { name: match[1].trim(), userCode: match[2].trim().toUpperCase() };
    }
    if (closer.toUpperCase().startsWith("CLS-")) {
      return { name: closer.trim(), userCode: closer.trim().toUpperCase() };
    }
    // Stable userCode derived from name hash if no code present
    const hash = (hashString(closer.toLowerCase().trim()) >>> 0).toString(16).toUpperCase().padStart(8, "0");
    return { name: closer.trim(), userCode: `CLS-${hash}` };
  }

  const name = closer.name?.trim() || "Unknown Closer";
  const rawObj = closer as { userCode?: string; code?: string; name?: string };
  let userCode = (rawObj.code || rawObj.userCode)?.trim().toUpperCase();
  if (!userCode) {
    const hash = (hashString(name.toLowerCase()) >>> 0).toString(16).toUpperCase().padStart(8, "0");
    userCode = `CLS-${hash}`;
  }

  return { name, userCode };
}

/**
 * Map a Safe Quote closer item to an Agent representation
 */
export function mapCloserToAgent(closer: SafeQuoteCloserItem): Agent {
  const userCode = closer.userCode || `CLS-${(hashString(closer.name) >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
  const id = `agt_${userCode.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
  const parts = closer.name.trim().split(/\s+/);
  const initials = parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase() : closer.name.slice(0, 2).toUpperCase();
  const hue = Math.abs(hashString(userCode)) % 360;

  return {
    id,
    name: closer.name,
    initials,
    teamId: "team_titans", // default or mapped team
    campaignId: "cmp_fiber",
    active: true,
    title: closer.rank <= 3 ? "Top Closer" : "Senior Closer",
    hue,
    joinedAt: new Date().toISOString(),
  };
}

/**
 * Map Safe Quote closers list into CloserRow domain objects for leaderboards
 */
export function mapClosersToCloserRows(closers: SafeQuoteCloserItem[]): CloserRow[] {
  return closers.map((c, index) => {
    const agent = mapCloserToAgent(c);
    const counts: LeadCounts = {
      submitted: c.submitted,
      validated: c.validated,
      pending: Math.max(0, c.submitted - c.validated - c.returned - c.rejected),
      rejected: c.rejected,
      duplicate: c.returned,
    };

    return {
      agent,
      code: c.userCode || `CLS-${index + 1}`,
      teamId: agent.teamId,
      counts,
      rate: c.closeRate,
      rank: c.rank > 0 ? c.rank : index + 1,
    };
  });
}

/**
 * Map Safe Quote recent sales to Sales Arena Sale domain objects
 */
export function mapRecentSaleToDomainSale(item: SafeQuoteSaleItem): Sale {
  const { userCode, name } = extractCloserIdentity(item.closer);
  const agentId = `agt_${userCode.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

  const carrierStr = item.carrier ? `${item.carrier}` : "";
  const stateStr = item.state ? ` (${item.state})` : "";
  const coverageStr = item.coverage ? ` · $${Number(item.coverage).toLocaleString()} cov.` : "";
  const product = carrierStr ? `${carrierStr} Policy${stateStr}${coverageStr}` : `Validated Policy${stateStr}`;

  return {
    id: `sale_${item.caseId}`,
    agentId,
    teamId: "team_titans",
    campaignId: "cmp_fiber",
    status: "approved",
    product,
    value: item.premium,
    createdAt: item.validatedAt,
    approvedAt: item.validatedAt,
    source: "safequote-api",
    carrier: item.carrier ?? undefined,
    state: item.state ?? undefined,
    coverage: item.coverage ?? undefined,
    closerName: name,
    closerCode: userCode,
  };
}

/**
 * Normalize SSE event into NormalizedSaleEvent
 */
export function parseSseSaleEvent(rawEventType: string, rawData: unknown): NormalizedSaleEvent | null {
  if (typeof rawData !== "object" || rawData === null) return null;

  const data = rawData as Record<string, unknown>;
  const eventType = rawEventType === "sale.validated" || data.event === "sale.validated"
    ? "sale.validated"
    : rawEventType === "sale.submitted" || data.event === "sale.submitted"
    ? "sale.submitted"
    : rawEventType === "sale.returned" || data.event === "sale.returned"
    ? "sale.returned"
    : rawEventType === "sale.rejected" || data.event === "sale.rejected"
    ? "sale.rejected"
    : rawEventType === "heartbeat" || data.type === "ping"
    ? "heartbeat"
    : "unknown";

  const caseId = String(data.caseId || data.id || data.leadId || "");
  if (!caseId && eventType !== "heartbeat") return null;

  const closerField = data.closer || data.agent || data.closerName;
  const { userCode, name } = extractCloserIdentity(
    typeof closerField === "object" && closerField !== null
      ? (closerField as { userCode?: string; name?: string })
      : String(closerField || "Unknown")
  );

  return {
    eventId: data.eventId ? String(data.eventId) : undefined,
    eventType,
    caseId,
    userCode,
    closerName: name,
    state: typeof data.state === "string" ? data.state : undefined,
    carrier: typeof data.carrier === "string" ? data.carrier : undefined,
    premium: typeof data.premium === "number" ? data.premium : Number(data.premium) || 0,
    coverage: (typeof data.coverage === "string" || typeof data.coverage === "number") ? data.coverage : undefined,
    timestamp: typeof data.validatedAt === "string" ? data.validatedAt : typeof data.timestamp === "string" ? data.timestamp : new Date().toISOString(),
    raw: data,
  };
}
