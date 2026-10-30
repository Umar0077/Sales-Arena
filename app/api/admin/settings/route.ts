import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth/guard";
import { dbQuery } from "@/lib/server/db/client";
import { DEFAULT_SETTINGS } from "@/store/settings-store";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  try {
    const res = await dbQuery("SELECT value FROM admin_settings WHERE key = 'display_settings'");
    if (res && res.rowCount && res.rowCount > 0) {
      return NextResponse.json({ ok: true, settings: res.rows[0].value, source: "database" });
    }
  } catch (err) {
    console.warn("[Admin Settings] Falling back to default settings", err);
  }

  return NextResponse.json({ ok: true, settings: DEFAULT_SETTINGS, source: "defaults" });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req, { mutating: true });
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Invalid settings payload" }, { status: 400 });
    }

    await dbQuery(
      `INSERT INTO admin_settings (key, value, updated_at)
       VALUES ('display_settings', $1, NOW())
       ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(body)]
    );

    // Audit log
    await dbQuery(
      `INSERT INTO audit_logs (actor, admin_id, action, target_type, target_id, details)
       VALUES ('admin', $2, 'update_settings', 'display_settings', 'display_settings', $1)`,
      [JSON.stringify({ updatedKeys: Object.keys(body) }), auth.ctx.admin.id]
    );

    return NextResponse.json({ ok: true, message: "Settings persisted successfully" });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to update settings" },
      { status: 500 }
    );
  }
}
