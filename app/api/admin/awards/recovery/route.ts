import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/server/auth/guard";
import { errorResponse, readJson } from "@/lib/server/spins/http";
import { applyCatchUp, applyRecovery, RecoveryError } from "@/lib/server/rewards/recovery";
import { noStore, requireOwner } from "@/lib/server/security/http";

export const dynamic = "force-dynamic";

/**
 * Creates missing award(s) for ONE agent / program / period after an Owner preview (Owner only, CSRF,
 * audited, idempotent). New awards are "earned", never "paid".
 * Body: { mode: "recover" | "catchup", userCode, programId, periodDate, notBefore?, notAfter?, includeBackfill?,
 *         reason, confirm: true, announce? }
 *   recover: sales the automatic rule never counted (before program activation / cutoff)
 *   catchup: runs the automatic rule once for sales it counts but whose award was never issued
 */
export async function POST(req: NextRequest) {
  const auth = await requireOwner(req, true);
  if (!auth.ok) return auth.response;
  const body = await readJson<Record<string, unknown>>(req);
  if (!body) return jsonError(400, "Invalid request.");
  try {
    const result = body.mode === "catchup" ? await applyCatchUp(auth.pool, body, auth.actor) : body.mode === "recover" ? await applyRecovery(auth.pool, body, auth.actor) : null;
    if (!result) return jsonError(400, 'Choose mode "recover" or "catchup".');
    return noStore({ ok: true, ...result }, 201);
  } catch (err) {
    if (err instanceof RecoveryError) return jsonError(err.status, err.message);
    return errorResponse(err);
  }
}
