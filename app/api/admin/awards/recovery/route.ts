import type { NextRequest } from "next/server";
import { jsonError } from "@/backend/auth/guard";
import { errorResponse, readJson } from "@/backend/spins/http";
import { applyGroup, RecoveryError } from "@/backend/rewards/recovery";
import { noStore, requireOwner } from "@/backend/security/http";

export const dynamic = "force-dynamic";

/**
 * Applies ONE previewed highest-tier upgrade for an agent / kind / reward group / period (Owner only, CSRF,
 * audited, idempotent). The new tier supersedes the previous one; nothing is paid automatically.
 * Body: { userCode, kind, rewardGroup, periodDate, notBefore?, notAfter?, includeBackfill?, expectProgramId?,
 *         reason, confirm: true, announce? }
 */
export async function POST(req: NextRequest) {
  const auth = await requireOwner(req, true);
  if (!auth.ok) return auth.response;
  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return jsonError(400, "Invalid request.");
  try {
    return noStore({ ok: true, ...(await applyGroup(auth.pool, body, auth.actor)) }, 201);
  } catch (err) {
    if (err instanceof RecoveryError) return jsonError(err.status, err.message);
    return errorResponse(err);
  }
}
