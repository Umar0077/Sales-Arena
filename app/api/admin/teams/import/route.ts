import type { NextRequest } from "next/server";
import { noStore } from "@/lib/server/security/http";
import { readJson } from "@/lib/server/spins/http";
import { jsonError } from "@/lib/server/auth/guard";
import { applyRoster, previewRoster } from "@/lib/server/teams/roster-import";
import { teamAuth, teamErrorResponse } from "@/lib/server/teams/http";

export const dynamic = "force-dynamic";

/** Read-only preview of the supplied roster matched against real agent identities (Owner). Writes nothing. */
export async function GET(req: NextRequest) {
  const auth = await teamAuth(req, { owner: true, what: "review the initial roster import" });
  if (!auth.ok) return auth.response;
  try {
    return noStore({ ok: true, ...(await previewRoster(auth.pool)) });
  } catch (err) {
    return teamErrorResponse(err);
  }
}

/** Applies the Owner's confirmed matches (one transaction, audited). Body: { confirm: true, effectiveFrom, members, leaders } */
export async function POST(req: NextRequest) {
  const auth = await teamAuth(req, { owner: true, what: "import the initial team roster" });
  if (!auth.ok) return auth.response;
  const body = await readJson(req);
  if (!body) return jsonError(400, "Invalid request.");
  try {
    return noStore({ ok: true, ...(await applyRoster(auth.pool, body, auth.actor)) }, 201);
  } catch (err) {
    return teamErrorResponse(err);
  }
}
