import { NextResponse, type NextRequest } from "next/server";
import { getDbPool } from "@/lib/server/db/client";
import { deviceCookieName, redeemPairingCode } from "@/lib/server/auth/arena-device";
import { secureCookiesEnabled } from "@/lib/server/auth/session";
import { isSameOrigin, requestIp, writeAudit } from "@/lib/server/auth/guard";
import { isLoginBlocked, recordLoginAttempt } from "@/lib/server/auth/rate-limit";

export const dynamic = "force-dynamic";

/** Pairs this browser (an office TV) as a Live Arena display using a one-time admin code. */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json({ ok: false, error: "Cross-site request blocked." }, { status: 403 });
  const pool = getDbPool();
  if (!pool) return NextResponse.json({ ok: false, error: "Pairing is unavailable: the database is not configured." }, { status: 503 });
  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  const ip = requestIp(req);
  // Pairing codes share the login throttle (keyed by IP) to stop guessing.
  if (await isLoginBlocked(pool, "pairing", ip)) {
    return NextResponse.json({ ok: false, error: "Too many attempts. Please wait a few minutes." }, { status: 429 });
  }
  const paired = typeof body.code === "string" ? await redeemPairingCode(pool, body.code) : null;
  await recordLoginAttempt(pool, "pairing", ip, Boolean(paired));
  if (!paired) return NextResponse.json({ ok: false, error: "That code is invalid or has expired." }, { status: 400 });

  await writeAudit(pool, { actor: "display", action: "display.paired", targetType: "arena_device", targetId: paired.deviceId, details: { label: paired.label }, ip });
  const res = NextResponse.json({ ok: true, label: paired.label });
  res.cookies.set(deviceCookieName(), paired.token, {
    httpOnly: true,
    secure: secureCookiesEnabled(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
