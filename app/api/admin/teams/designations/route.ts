import type { NextRequest } from "next/server";
import { noStore } from "@/backend/security/http";
import { readJson } from "@/backend/spins/http";
import { jsonError } from "@/backend/auth/guard";
import { setDesignation } from "@/backend/teams/repo";
import { teamAuth, teamErrorResponse } from "@/backend/teams/http";

export const dynamic = "force-dynamic";

/** Set Senior / Junior from a date. Body: { userCode, designation: "senior" | "junior", effectiveFrom? } */
export async function POST(req: NextRequest) {
  const auth = await teamAuth(req);
  if (!auth.ok) return auth.response;
  const body = await readJson(req);
  if (!body) return jsonError(400, "Invalid request.");
  try {
    return noStore({ ok: true, ...(await setDesignation(auth.pool, body, auth.actor)) });
  } catch (err) {
    return teamErrorResponse(err);
  }
}
