import type { NextRequest } from "next/server";
import { noStore } from "@/lib/server/security/http";
import { readJson } from "@/lib/server/spins/http";
import { jsonError } from "@/lib/server/auth/guard";
import { applyAudience, previewAudience } from "@/lib/server/rewards/audience";
import { teamAuth, teamErrorResponse } from "@/lib/server/teams/http";

export const dynamic = "force-dynamic";

/** Read-only Senior / Junior eligibility review (Owner). Writes nothing. */
export async function GET(req: NextRequest) {
  const auth = await teamAuth(req, { owner: true, what: "review programme eligibility" });
  if (!auth.ok) return auth.response;
  try {
    return noStore({ ok: true, ...(await previewAudience(auth.pool)) });
  } catch (err) {
    return teamErrorResponse(err);
  }
}

/** Moves the chosen "all agents" programmes to Senior-only (Owner, audited). Body: { confirm: true, programIds, reason } */
export async function POST(req: NextRequest) {
  const auth = await teamAuth(req, { owner: true, what: "change programme eligibility" });
  if (!auth.ok) return auth.response;
  const body = await readJson(req);
  if (!body) return jsonError(400, "Invalid request.");
  try {
    return noStore({ ok: true, ...(await applyAudience(auth.pool, body, auth.actor)) });
  } catch (err) {
    return teamErrorResponse(err);
  }
}
