import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/server/auth/guard";
import { csrfTokenFor } from "@/lib/server/auth/session";
import AdminShell from "@/components/admin/AdminShell";

// Every request re-checks the database session; nothing about admin access is cached.
export const dynamic = "force-dynamic";

/** Server-side guard for every /admin page except /admin/login. */
export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCurrentAdmin();
  if (!ctx) redirect("/admin/login");
  return (
    <AdminShell admin={{ email: ctx.admin.email, displayName: ctx.admin.displayName, role: ctx.admin.role }} csrfToken={csrfTokenFor(ctx.token)}>
      {children}
    </AdminShell>
  );
}
