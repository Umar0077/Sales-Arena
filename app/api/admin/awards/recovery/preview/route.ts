import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/server/auth/guard";
import { errorResponse, readJson } from "@/lib/server/spins/http";
import { previewGroup, previewView, RecoveryError } from "@/lib/server/rewards/recovery";
import { noStore, requireOwner } from "@/lib/server/security/http";

export const dynamic = "force-dynamic";

/** Read-only recovery preview (Owner only). Body: { userCode, kind, rewardGroup, periodDate, notBefore?, notAfter?, includeBackfill? }. Writes nothing. */
export async function POST(req: NextRequest) {
  const auth = await requireOwner(req, true);
  if (!auth.ok) return auth.response;
  const body = await readJson(req);
  if (!body) return jsonError(400, "Invalid request.");
  try {
    return noStore({ ok: true, preview: previewView(await previewGroup(auth.pool, body)) });
  } catch (err) {
    if (err instanceof RecoveryError) return jsonError(err.status, err.message);
    return errorResponse(err);
  }
}
