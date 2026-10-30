import { randomBytes, randomInt } from "crypto";
import type { NextRequest } from "next/server";
import type { Pool } from "pg";
import { getDbPool } from "../db/client";
import { readSession, sessionCookieName, sha256, secureCookiesEnabled } from "./session";
import { isSameOrigin } from "./guard";

/**
 * Live Arena display authorisation.
 * Spins are consumed from the office TV, which has no admin login. An admin pairs a
 * display once (one-time code, 10 minutes); the display then holds a random device
 * token in an HttpOnly cookie. A spin is accepted only from a paired display or a
 * signed-in admin — never from a bare userCode.
 */

export const PAIRING_TTL_MS = 10 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export function deviceCookieName(): string {
  return secureCookiesEnabled() ? "__Host-sa_display" : "sa_display";
}

export function generatePairingCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

export function newDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Consumes a pairing code and returns a fresh device token (or null if the code is wrong/expired/used). */
export async function redeemPairingCode(pool: Pool, code: string): Promise<{ token: string; deviceId: string; label: string } | null> {
  const clean = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (clean.length !== 8) return null;
  const token = newDeviceToken();
  const { rows } = await pool.query(
    `UPDATE arena_devices
        SET token_hash = $2, pairing_code_hash = NULL, pairing_expires_at = NULL, paired_at = NOW(), last_seen_at = NOW()
      WHERE pairing_code_hash = $1 AND pairing_expires_at > NOW() AND revoked_at IS NULL
      RETURNING id, label`,
    [sha256(clean), sha256(token)],
  );
  return rows[0] ? { token, deviceId: rows[0].id, label: rows[0].label } : null;
}

export type SpinActor = { kind: "admin"; id: string; label: string } | { kind: "device"; id: string; label: string };

/** Who may run a spin: a signed-in admin or a paired, unrevoked Live Arena display. */
export async function resolveSpinActor(req: NextRequest): Promise<SpinActor | null> {
  const pool = getDbPool();
  if (!pool) return null;
  const admin = await readSession(req.cookies.get(sessionCookieName())?.value);
  if (admin) return { kind: "admin", id: admin.admin.id, label: admin.admin.email };
  const token = req.cookies.get(deviceCookieName())?.value;
  if (!token || token.length < 20 || token.length > 100) return null;
  const { rows } = await pool.query(
    `UPDATE arena_devices SET last_seen_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL RETURNING id, label`,
    [sha256(token)],
  );
  return rows[0] ? { kind: "device", id: rows[0].id, label: rows[0].label } : null;
}

/** Spin requests must also come from this site (blocks cross-site form/fetch abuse). */
export function spinRequestAllowed(req: NextRequest): boolean {
  return isSameOrigin(req);
}
