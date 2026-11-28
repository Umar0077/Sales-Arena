import type { NextRequest } from "next/server";
import { noStore } from "@/backend/security/http";
import { readJson } from "@/backend/spins/http";
import { jsonError } from "@/backend/auth/guard";
import { syncVerifiedClosers } from "@/backend/safequote/agent-sync";
import { adminTeamsView, createTeam } from "@/backend/teams/repo";
import { teamAuth, teamErrorResponse } from "@/backend/teams/http";

export const dynamic = "force-dynamic";

/** Team Management: teams, current members (from team_memberships) and unassigned agents (including verified SafeQuote closers). */
export async function GET(req: NextRequest) {
  const auth = await teamAuth(req);
  if (!auth.ok) return auth.response;
  try {
    const fresh = req.nextUrl.searchParams.get("fresh") === "true";
    const sync = await syncVerifiedClosers(auth.pool, { fresh }).catch(() => null);
    return noStore({ ok: true, ...(await adminTeamsView(auth.pool)), sync });
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
