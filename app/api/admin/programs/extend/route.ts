import type { NextRequest } from "next/server";
import { jsonError } from "@/backend/auth/guard";
import { errorResponse, readJson } from "@/backend/spins/http";
import { ProgramError } from "@/backend/rewards/programs";
import { applyExtension } from "@/backend/rewards/program-admin";
import { noStore, requireOwner } from "@/backend/security/http";

export const dynamic = "force-dynamic";

/**
 * Owner: extend selected programs to the end of a future month (transactional, revision-checked, audited).
 * Body: { targetMonth, programIds, reactivateIds?, revisions?: { [id]: revision }, confirm: true }
 */
export async function POST(req: NextRequest) {
  const auth = await requireOwner(req, true);
  if (!auth.ok) return auth.response;
  const body = await readJson(req);
  if (!body) return jsonError(400, "Invalid request.");
  try {
    return noStore({ ok: true, ...(await applyExtension(auth.pool, body, auth.actor)) });
  } catch (err) {
    if (err instanceof ProgramError) return jsonError(err.status, err.message);
    return errorResponse(err);
  }
}
