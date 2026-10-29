import { NextRequest } from "next/server";

export function verifyAdminAuth(req: NextRequest): { authorized: boolean; reason?: string } {
  const adminKey = process.env.ADMIN_API_KEY;

  // In production, an admin key is strictly required
  if (process.env.NODE_ENV === "production" && !adminKey) {
    return { authorized: false, reason: "ADMIN_API_KEY must be configured in production" };
  }

  // If no adminKey is set in dev mode, allow local requests
  if (!adminKey) {
    return { authorized: true };
  }

  // Check Authorization header or x-admin-key header
  const authHeader = req.headers.get("authorization");
  const headerKey = req.headers.get("x-admin-key");

  if (headerKey && headerKey === adminKey) {
    return { authorized: true };
  }

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token === adminKey) {
      return { authorized: true };
    }
  }

  // Check admin session cookie
  const cookieToken = req.cookies.get("arena_admin_key")?.value;
  if (cookieToken && cookieToken === adminKey) {
    return { authorized: true };
  }

  return { authorized: false, reason: "Unauthorized: Invalid administrative credentials" };
}
