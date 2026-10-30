import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/server/auth/guard";
import { getMigrationStatus } from "@/lib/server/db/migrations";

export const dynamic = "force-dynamic";

/**
 * Read-only migration status. Applying migrations over HTTP is intentionally not
 * supported: run `npm run db:migrate -- up` from a shell (see docs/DEPLOYMENT.md).
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const status = await getMigrationStatus();
  return NextResponse.json(status, { status: status.ok ? 200 : 503 });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;
  return NextResponse.json(
    { ok: false, error: "Migrations are applied from the server shell only: npm run db:migrate -- up" },
    { status: 405 },
  );
}
