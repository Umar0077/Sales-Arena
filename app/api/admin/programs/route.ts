import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, jsonError, requestIp, requestUserAgent } from "@/lib/server/auth/guard";
import { errorResponse, readJson } from "@/lib/server/spins/http";
import { createProgram, duplicateProgramGroups, listPrograms, ProgramError } from "@/lib/server/rewards/programs";

export const dynamic = "force-dynamic";

/** All reward programs from PostgreSQL (never built-in defaults). ?archived=1 includes archived ones. */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const sp = req.nextUrl.searchParams;
  try {
    const programs = await listPrograms(auth.pool, { includeArchived: sp.get("archived") === "1", kind: sp.get("kind") ?? undefined });
    // Duplicate active programs (same period, threshold, eligibility, reward type): only the oldest awards.
    const duplicates = duplicateProgramGroups(await listPrograms(auth.pool, { kind: sp.get("kind") ?? undefined }));
    return NextResponse.json({ ok: true, programs, duplicates }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err, "Reward programs are unavailable: the database could not be reached.");
  }
}

/** Creates ONE new program. Other programs are never touched. */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const body = await readJson(req);
  if (!body) return jsonError(400, "Invalid request.");
  try {
    const program = await createProgram(auth.pool, body, { adminId: auth.ctx.admin.id, ip: requestIp(req), userAgent: requestUserAgent(req) });
    return NextResponse.json({ ok: true, program }, { status: 201 });
  } catch (err) {
    if (err instanceof ProgramError) return jsonError(err.status, err.message);
    return errorResponse(err);
  }
}
