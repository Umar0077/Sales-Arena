import type { NextRequest } from "next/server";
import { noStore } from "@/lib/server/security/http";
import { readJson } from "@/lib/server/spins/http";
import { jsonError } from "@/lib/server/auth/guard";
import { setDesignation } from "@/lib/server/teams/repo";
import { teamAuth, teamErrorResponse } from "@/lib/server/teams/http";

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
