import type { NextRequest } from "next/server";
import { noStore } from "@/backend/security/http";
import { readJson } from "@/backend/spins/http";
import { jsonError } from "@/backend/auth/guard";
import { updateTeam } from "@/backend/teams/repo";
import { teamAuth, teamErrorResponse } from "@/backend/teams/http";

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
