import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/server/auth/guard";
import { readJson } from "@/lib/server/spins/http";
import { updateRule } from "@/lib/server/security/ip-admin";
import { ipSecurityError, noStore, requireOwner } from "@/lib/server/security/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const ruleId = async (params: Ctx["params"]) => {
  const n = Number((await params).id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Edit / activate / deactivate. Refused if it would lock administrators out. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await requireOwner(req, true);
  if (!auth.ok) return auth.response;
  const id = await ruleId(params);
  const body = await readJson(req);
  if (!id || !body) return jsonError(400, "Invalid request.");
  try {
    return noStore({ ok: true, rule: await updateRule(auth.pool, id, body, auth.actor) });
  } catch (err) {
    return ipSecurityError(err);
  }
}

/** Soft delete (archive). The rule stays in the audit trail. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = await requireOwner(req, true);
  if (!auth.ok) return auth.response;
  const id = await ruleId(params);
  if (!id) return jsonError(400, "Invalid request.");
  try {
    return noStore({ ok: true, rule: await updateRule(auth.pool, id, { archived: true }, auth.actor) });
  } catch (err) {
    return ipSecurityError(err);
  }
}
