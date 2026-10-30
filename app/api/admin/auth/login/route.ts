import { NextResponse, type NextRequest } from "next/server";
import { getDbPool } from "@/lib/server/db/client";
import { normalizeEmail, verifyAgainstDummy, verifyPassword } from "@/lib/server/auth/password";
import { createSession, csrfTokenFor, sessionCookieName, sha256, secureCookiesEnabled, SESSION_ABSOLUTE_MS } from "@/lib/server/auth/session";
import { isLoginBlocked, recordLoginAttempt } from "@/lib/server/auth/rate-limit";
import { isSameOrigin, jsonError, requestIp, requestUserAgent, writeAudit } from "@/lib/server/auth/guard";

export const dynamic = "force-dynamic";

const GENERIC = "Invalid email or password.";

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return jsonError(403, "Cross-site request blocked.");
  const pool = getDbPool();
  if (!pool) return jsonError(503, "Sign-in is unavailable: the database is not configured.");

  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid request.");
  }
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" && body.password.length <= 256 ? body.password : null;
  const ip = requestIp(req);
  const userAgent = requestUserAgent(req);
  // Even malformed input counts toward throttling and gets the generic answer.
  const emailHash = sha256(email ?? String(body.email ?? "").slice(0, 254).toLowerCase());

  try {
    if (await isLoginBlocked(pool, emailHash, ip)) {
      await recordLoginAttempt(pool, emailHash, ip, false);
      await writeAudit(pool, { action: "admin.login_throttled", targetType: "admin_user", details: { emailHash }, ip, userAgent });
      return jsonError(429, "Too many sign-in attempts. Please wait a few minutes and try again.");
    }

    const user =
      email && password
        ? (await pool.query(`SELECT id, password_hash, is_active FROM admin_users WHERE LOWER(email) = $1`, [email])).rows[0]
        : undefined;
    const valid = user && user.is_active && password ? await verifyPassword(user.password_hash, password) : await verifyAgainstDummy(password ?? "");

    await recordLoginAttempt(pool, emailHash, ip, valid);
    if (!valid) {
      await writeAudit(pool, { action: "admin.login_failed", targetType: "admin_user", details: { emailHash }, ip, userAgent });
      return jsonError(401, GENERIC);
    }

    const client = await pool.connect();
    let token: string;
    try {
      await client.query("BEGIN");
      ({ token } = await createSession(client, user.id, { ip, userAgent }));
      await client.query(`UPDATE admin_users SET last_login_at = NOW() WHERE id = $1`, [user.id]);
      await writeAudit(client, { adminId: user.id, action: "admin.login", targetType: "admin_user", targetId: user.id, ip, userAgent });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const res = NextResponse.json({ ok: true, csrfToken: csrfTokenFor(token) }, { headers: { "Cache-Control": "no-store" } });
    res.cookies.set(sessionCookieName(), token, {
      httpOnly: true,
      secure: secureCookiesEnabled(),
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(SESSION_ABSOLUTE_MS / 1000),
    });
    return res;
  } catch {
    return jsonError(503, "Sign-in is temporarily unavailable. Please try again shortly.");
  }
}
