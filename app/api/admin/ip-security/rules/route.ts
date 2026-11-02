import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/server/auth/guard";
import { readJson } from "@/lib/server/spins/http";
import { createRule } from "@/lib/server/security/ip-admin";
import { ipSecurityError, noStore, requireOwner } from "@/lib/server/security/http";

export const dynamic = "force-dynamic";

/** Body: { network, label, description?, notes?, active?, allowManagement?, expiresAt? }. */
export async function POST(req: NextRequest) {
  const auth = await requireOwner(req, true);
  if (!auth.ok) return auth.response;
  const body = await readJson(req);
  if (!body) return jsonError(400, "Invalid request.");
  try {
    return noStore({ ok: true, rule: await createRule(auth.pool, body, auth.actor) }, 201);
  } catch (err) {
    return ipSecurityError(err);
  }
}
