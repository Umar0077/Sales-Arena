import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import type { Pool, PoolClient } from "pg";
import { getDbPool } from "../db/client";
import { csrfTokenFor, readSession, safeEqual, sessionCookieName, type SessionContext } from "./session";

/** Client IP as seen by nginx (X-Real-IP), falling back to the first X-Forwarded-For hop. */
export function requestIp(req: NextRequest): string | null {
  const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  return ip ? ip.slice(0, 45) : null;
}

export function requestUserAgent(req: NextRequest): string | null {
  return req.headers.get("user-agent")?.slice(0, 256) ?? null;
}

/** The origin this app is served from (APP_ORIGIN, else derived from the proxy headers). */
export function expectedOrigin(req: NextRequest): string {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/+$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  return `${proto}://${host}`;
}

/** Rejects cross-site requests: the Origin (or Referer) must be this app. */
export function isSameOrigin(req: NextRequest): boolean {
  const want = expectedOrigin(req);
  const origin = req.headers.get("origin");
  if (origin) return origin === want;
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === want;
    } catch {
      return false;
    }
  }
  return false;
}

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

export type AdminGuardResult = { ok: true; ctx: SessionContext; pool: Pool } | { ok: false; response: NextResponse };

/**
 * Authenticates an /api/admin request from its session cookie.
 * Mutating requests additionally need a same-origin Origin header and the session's CSRF token.
 */
export async function requireAdmin(req: NextRequest, opts: { mutating?: boolean } = {}): Promise<AdminGuardResult> {
  const pool = getDbPool();
  if (!pool) return { ok: false, response: jsonError(503, "Database is not configured; admin access is unavailable.") };
  const token = req.cookies.get(sessionCookieName())?.value;
  let ctx: SessionContext | null;
  try {
    ctx = await readSession(token);
  } catch {
    return { ok: false, response: jsonError(503, "Database is unavailable. Please try again shortly.") };
  }
  if (!ctx) return { ok: false, response: jsonError(401, "Authentication required.") };
  const mutating = opts.mutating ?? !["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (mutating) {
    if (!isSameOrigin(req)) return { ok: false, response: jsonError(403, "Cross-site request blocked.") };
    const sent = req.headers.get("x-csrf-token") ?? "";
    if (!sent || !safeEqual(sent, csrfTokenFor(ctx.token))) return { ok: false, response: jsonError(403, "Invalid or missing CSRF token.") };
  }
  return { ok: true, ctx, pool };
}

/** For server components/layouts: the signed-in admin, or null. */
export async function getCurrentAdmin(): Promise<SessionContext | null> {
  if (!getDbPool()) return null;
  const store = await cookies();
  try {
    return await readSession(store.get(sessionCookieName())?.value);
  } catch {
    return null;
  }
}

export interface AuditEntry {
  adminId?: string | null;
  actor?: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  details?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

/** Appends to audit_logs. Pass the transaction client so the audit row commits with the change. */
export async function writeAudit(db: Pool | PoolClient, e: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (actor, admin_id, action, target_type, target_id, details, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      e.actor ?? (e.adminId ? "admin" : "system"),
      e.adminId ?? null,
      e.action,
      e.targetType,
      e.targetId ?? null,
      JSON.stringify(e.details ?? {}),
      e.ip ?? null,
      e.userAgent ?? null,
    ],
  );
}
