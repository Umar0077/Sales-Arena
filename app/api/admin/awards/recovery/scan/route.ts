import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/server/auth/guard";
import { errorResponse, readJson } from "@/lib/server/spins/http";
import { RecoveryError, scanRecovery } from "@/lib/server/rewards/recovery";
import { noStore, requireOwner } from "@/lib/server/security/http";

export const dynamic = "force-dynamic";

/** Read-only: every missing award for an Owner-chosen business date range (e.g. November). Body: { from, to, includeBackfill? }. */
export async function POST(req: NextRequest) {
  const auth = await requireOwner(req, true);
  if (!auth.ok) return auth.response;
  const body = await readJson(req);
  if (!body) return jsonError(400, "Invalid request.");
  try {
    return noStore({ ok: true, ...(await scanRecovery(auth.pool, body)) });
  } catch (err) {
    if (err instanceof RecoveryError) return jsonError(err.status, err.message);
    return errorResponse(err);
  }
}
