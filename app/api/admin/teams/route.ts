import type { NextRequest } from "next/server";
import { noStore } from "@/backend/security/http";
import { readJson } from "@/backend/spins/http";
import { jsonError } from "@/backend/auth/guard";
import { adminTeamsView, createTeam } from "@/backend/teams/repo";
import { teamAuth, teamErrorResponse } from "@/backend/teams/http";

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
