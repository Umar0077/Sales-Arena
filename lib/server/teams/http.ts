import type { NextRequest } from "next/server";
import { jsonError, requestIp, requestUserAgent, requireAdmin } from "../auth/guard";
import { errorResponse } from "../spins/http";
import { ProgramError } from "../rewards/programs";
import { TeamError, type Actor } from "./repo";

/** Admin session (+ same-origin and CSRF for writes); `owner` additionally requires the Owner role. */
export async function teamAuth(req: NextRequest, opts: { owner?: boolean; what?: string } = {}) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth;
  if (opts.owner && auth.ctx.admin.role !== "owner") return { ok: false as const, response: jsonError(403, `Only the Owner can ${opts.what ?? "do this"}.`) };
  const actor: Actor = { adminId: auth.ctx.admin.id, ip: requestIp(req), userAgent: requestUserAgent(req) };
  return { ...auth, actor };
}

export function teamErrorResponse(err: unknown) {
  if (err instanceof TeamError || err instanceof ProgramError) return jsonError(err.status, err.message);
  return errorResponse(err);
}
