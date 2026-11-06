import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requestIp, requestUserAgent, requireAdmin } from "../auth/guard";
import { errorResponse } from "../spins/http";
import { IpSecurityError, type Actor } from "./ip-admin";

/** IP perimeter management is Owner-only (role "owner"), on top of the normal session + CSRF checks. */
export async function requireOwner(req: NextRequest, mutating = false) {
  const auth = await requireAdmin(req, { mutating });
  if (!auth.ok) return auth;
  if (auth.ctx.admin.role !== "owner") return { ok: false as const, response: jsonError(403, "Only the Owner can manage IP perimeter security.") };
  const actor: Actor = { adminId: auth.ctx.admin.id, email: auth.ctx.admin.email, ip: requestIp(req), userAgent: requestUserAgent(req) };
  return { ...auth, actor };
}

export function ipSecurityError(err: unknown) {
  if (err instanceof IpSecurityError) return jsonError(err.status, err.message);
  return errorResponse(err);
}

export const noStore = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
