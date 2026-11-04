import type { NextRequest } from "next/server";
import { noStore } from "@/lib/server/security/http";
import { readJson } from "@/lib/server/spins/http";
import { jsonError } from "@/lib/server/auth/guard";
import { adminTeamsView, createTeam } from "@/lib/server/teams/repo";
import { teamAuth, teamErrorResponse } from "@/lib/server/teams/http";

export const dynamic = "force-dynamic";

/** Team Management: teams, current members and unassigned agents. */
export async function GET(req: NextRequest) {
  const auth = await teamAuth(req);
  if (!auth.ok) return auth.response;
  try {
    return noStore({ ok: true, ...(await adminTeamsView(auth.pool)) });
  } catch (err) {
    return teamErrorResponse(err);
  }
}

/** Create a team. Body: { name, color?, accentSecondary?, logoUrl?, displayOrder?, active? } */
export async function POST(req: NextRequest) {
  const auth = await teamAuth(req);
  if (!auth.ok) return auth.response;
  const body = await readJson(req);
  if (!body) return jsonError(400, "Invalid request.");
  try {
    return noStore({ ok: true, team: await createTeam(auth.pool, body, auth.actor) }, 201);
  } catch (err) {
    return teamErrorResponse(err);
  }
}
