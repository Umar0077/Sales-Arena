import { NextResponse, type NextRequest } from "next/server";

/**
 * Fast first gate for admin routes: no session cookie → straight to the login page
 * (pages) or 401 (APIs). This is only an optimisation; the real check — the session
 * in PostgreSQL — runs in app/admin/(panel)/layout.tsx and in every /api/admin handler.
 */
const COOKIE_NAMES = ["__Host-sa_admin", "sa_admin"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isLoginPage = pathname === "/admin/login";
  const isLoginApi = pathname === "/api/admin/auth/login";
  if (isLoginPage || isLoginApi) return NextResponse.next();

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
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*"],
};
