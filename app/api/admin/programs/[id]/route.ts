import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, requestUserAgent } from "@/backend/auth/guard";
import { errorResponse, readJson } from "@/backend/spins/http";
import { programHistory, ProgramError, updateProgram } from "@/backend/rewards/programs";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const actor = (req: NextRequest, adminId: string) => ({ adminId, ip: requestIp(req), userAgent: requestUserAgent(req) });

/** Revision history of one program. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ ok: true, history: await programHistory(auth.pool, (await params).id) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Edit, activate / pause (enabled), show / hide (showOnArena), archive / restore (archived). */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const body = await readJson(req);
  if (!body) return jsonError(400, "Invalid request.");
  try {
    return NextResponse.json({ ok: true, program: await updateProgram(auth.pool, (await params).id, body, actor(req, auth.ctx.admin.id)) });
  } catch (err) {
    if (err instanceof ProgramError) return jsonError(err.status, err.message);
    return errorResponse(err);
  }
}

/** Programs are never hard-deleted: DELETE archives them (earned awards and history stay). */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ ok: true, program: await updateProgram(auth.pool, (await params).id, { archived: true }, actor(req, auth.ctx.admin.id)) });
  } catch (err) {
    if (err instanceof ProgramError) return jsonError(err.status, err.message);
    return errorResponse(err);
  }
}
