import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/server/auth/guard";
import { errorResponse, readJson } from "@/lib/server/spins/http";
import { ProgramError } from "@/lib/server/rewards/programs";
import { deleteCheck, deleteProgramPermanently } from "@/lib/server/rewards/program-admin";
import { noStore, requireOwner } from "@/lib/server/security/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Owner: what a permanent delete would affect (award counts, duplicate status). Read-only. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;
  try {
    return noStore({ ok: true, ...(await deleteCheck(auth.pool, (await params).id)) });
  } catch (err) {
    if (err instanceof ProgramError) return jsonError(err.status, err.message);
    return errorResponse(err);
  }
}

/** Owner: permanently delete a program with NO award history. Body: { confirm: true, revision }. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await requireOwner(req, true);
  if (!auth.ok) return auth.response;
  const body = await readJson(req);
  if (!body) return jsonError(400, "Invalid request.");
  try {
    return noStore({ ok: true, deleted: await deleteProgramPermanently(auth.pool, (await params).id, body, auth.actor) });
  } catch (err) {
    if (err instanceof ProgramError) return jsonError(err.status, err.message, err.status === 409 ? { code: "HAS_AWARDS_OR_CHANGED" } : {});
    return errorResponse(err);
  }
}
