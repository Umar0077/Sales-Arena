import type { NextRequest } from "next/server";
import { noStore } from "@/lib/server/security/http";
import { readJson } from "@/lib/server/spins/http";
import { jsonError } from "@/lib/server/auth/guard";
import { updateTeam } from "@/lib/server/teams/repo";
import { teamAuth, teamErrorResponse } from "@/lib/server/teams/http";

export const dynamic = "force-dynamic";

/** Edit a team: name, logo, colours, leader, display order, active. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await teamAuth(req);
  if (!auth.ok) return auth.response;
  const body = await readJson(req);
  if (!body) return jsonError(400, "Invalid request.");
  try {
    return noStore({ ok: true, team: await updateTeam(auth.pool, (await params).id, body, auth.actor) });
  } catch (err) {
    return teamErrorResponse(err);
  }
}
