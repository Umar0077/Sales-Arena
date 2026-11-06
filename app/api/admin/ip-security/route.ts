import type { NextRequest } from "next/server";
import { overview } from "@/backend/security/ip-admin";
import { ipSecurityError, noStore, requireOwner } from "@/backend/security/http";

export const dynamic = "force-dynamic";

/** Dashboard: settings, rules, this connection's status, counts and recent changes (Owner only). */
export async function GET(req: NextRequest) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;
  try {
    return noStore({ ok: true, admin: { email: auth.actor.email, role: auth.ctx.admin.role }, ...(await overview(auth.pool, auth.actor.ip)) });
  } catch (err) {
    return ipSecurityError(err);
  }
}
