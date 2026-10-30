import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, requestIp, requestUserAgent, writeAudit } from "@/lib/server/auth/guard";
import { revokeSession, sessionCookieName, secureCookiesEnabled } from "@/lib/server/auth/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  const clear = (res: NextResponse) => {
    res.cookies.set(sessionCookieName(), "", { httpOnly: true, secure: secureCookiesEnabled(), sameSite: "lax", path: "/", maxAge: 0 });
    return res;
  };
  if (!auth.ok) return clear(auth.response);
  await revokeSession(auth.ctx.sessionId);
  await writeAudit(auth.pool, {
    adminId: auth.ctx.admin.id,
    action: "admin.logout",
    targetType: "admin_user",
    targetId: auth.ctx.admin.id,
    ip: requestIp(req),
    userAgent: requestUserAgent(req),
  });
  return clear(NextResponse.json({ ok: true }));
}
