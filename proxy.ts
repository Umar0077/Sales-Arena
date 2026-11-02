import { NextResponse, type NextRequest } from "next/server";
import { deniedResponse, evaluateAccess } from "@/lib/server/security/enforce";
import { recordDenied } from "@/lib/server/security/ip-policy";

/**
 * Runs before every page and API request (Node.js runtime, Next.js 16 proxy).
 *
 * 1. IP perimeter security: the trusted client IP (from Nginx) is checked against the PostgreSQL
 *    whitelist policy (cached, revision-checked). Blocked → branded 403 page / JSON 403. Static
 *    assets are never blocked. See lib/server/security/.
 * 2. Fast admin gate: no session cookie → login page (pages) or 401 (APIs). The real session check
 *    runs in app/admin/(panel)/layout.tsx and in every /api/admin handler.
 */
const COOKIE_NAMES = ["__Host-sa_admin", "sa_admin"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const access = await evaluateAccess(pathname, req.headers);
  if (!access.decision.allowed) {
    recordDenied(access.ip, access.scope, access.decision.reason);
    return deniedResponse(pathname, access.decision.reason);
  }

  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/");
  if (!isAdmin) return NextResponse.next();
  if (pathname === "/admin/login" || pathname === "/api/admin/auth/login") return NextResponse.next();

  const hasCookie = COOKIE_NAMES.some((n) => req.cookies.get(n)?.value);
  if (hasCookie) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  }
  const login = new URL("/admin/login", req.url);
  if (pathname !== "/admin") login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next.js build assets (they carry no data and are needed to render allowed pages).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
