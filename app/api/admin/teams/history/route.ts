import type { NextRequest } from "next/server";
import { noStore } from "@/lib/server/security/http";
import { teamHistory } from "@/lib/server/teams/repo";
import { teamAuth, teamErrorResponse } from "@/lib/server/teams/http";

export const dynamic = "force-dynamic";

/** Membership history (assignments, transfers, removals). Filters: userCode, teamId, limit. */
export async function GET(req: NextRequest) {
  const auth = await teamAuth(req);
  if (!auth.ok) return auth.response;
  const sp = req.nextUrl.searchParams;
  try {
    const history = await teamHistory(auth.pool, { userCode: sp.get("userCode") ?? undefined, teamId: sp.get("teamId") ?? undefined, limit: Number(sp.get("limit")) || 200 });
    return noStore({ ok: true, history });
  } catch (err) {
    return teamErrorResponse(err);
  }
}
