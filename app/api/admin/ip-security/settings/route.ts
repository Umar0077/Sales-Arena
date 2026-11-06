import type { NextRequest } from "next/server";
import { jsonError } from "@/backend/auth/guard";
import { readJson } from "@/backend/spins/http";
import { saveSettings } from "@/backend/security/ip-admin";
import { ipSecurityError, noStore, requireOwner } from "@/backend/security/http";

export const dynamic = "force-dynamic";

/** Body: { enabled?, protectArena?, protectPairing?, protectAdmin?, confirm? }. Lockout-safe. */
export async function PUT(req: NextRequest) {
  const auth = await requireOwner(req, true);
  if (!auth.ok) return auth.response;
  const body = await readJson(req);
  if (!body) return jsonError(400, "Invalid request.");
  try {
    return noStore({ ok: true, settings: await saveSettings(auth.pool, body, auth.actor) });
  } catch (err) {
    return ipSecurityError(err);
  }
}
