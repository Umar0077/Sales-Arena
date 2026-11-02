import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/server/auth/guard";
import { errorResponse, readJson } from "@/lib/server/spins/http";
import { ProgramError } from "@/lib/server/rewards/programs";
import { previewExtension } from "@/lib/server/rewards/program-admin";
import { noStore, requireOwner } from "@/lib/server/security/http";

export const dynamic = "force-dynamic";

/** Owner, read-only. Body: { targetMonth?: "YYYY-MM", kinds?: string[], programIds?: string[] }. Without a month it returns the allowed range. */
export async function POST(req: NextRequest) {
  const auth = await requireOwner(req, true);
  if (!auth.ok) return auth.response;
  const body = await readJson(req);
  if (!body) return jsonError(400, "Invalid request.");
  try {
    return noStore({ ok: true, ...(await previewExtension(auth.pool, body)) });
  } catch (err) {
    if (err instanceof ProgramError) return jsonError(err.status, err.message);
    return errorResponse(err);
  }
}
