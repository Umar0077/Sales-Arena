import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/server/auth/guard";
import { readJson } from "@/lib/server/spins/http";
import { saveSettings } from "@/lib/server/security/ip-admin";
import { ipSecurityError, noStore, requireOwner } from "@/lib/server/security/http";

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
