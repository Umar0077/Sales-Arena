import type { NextRequest } from "next/server";
import { noStore } from "@/backend/security/http";
import { readJson } from "@/backend/spins/http";
import { jsonError } from "@/backend/auth/guard";
import { assignMember, removeMember } from "@/backend/teams/repo";
import { teamAuth, teamErrorResponse } from "@/backend/teams/http";

export const dynamic = "force-dynamic";

/** Assign or transfer. Body: { userCode, teamId, effectiveFrom?, designation?, note? } */
export async function POST(req: NextRequest) {
  const auth = await teamAuth(req);
  if (!auth.ok) return auth.response;
  const body = await readJson(req);
  if (!body) return jsonError(400, "Invalid request.");
  try {
    return noStore({ ok: true, ...(await assignMember(auth.pool, body, auth.actor)) });
  } catch (err) {
    return teamErrorResponse(err);
  }
}

/** Remove from team. Body: { userCode, effectiveFrom?, note? } */
export async function DELETE(req: NextRequest) {
  const auth = await teamAuth(req);
  if (!auth.ok) return auth.response;
  const body = await readJson(req);
  if (!body) return jsonError(400, "Invalid request.");
  try {
    return noStore({ ok: true, ...(await removeMember(auth.pool, body, auth.actor)) });
  } catch (err) {
    return teamErrorResponse(err);
  }
}
