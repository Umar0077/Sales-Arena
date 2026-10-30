import { redirect } from "next/navigation";
import { getCurrentAdmin } from "@/lib/server/auth/guard";
import { getDbPool } from "@/lib/server/db/client";
import { LoginForm } from "@/components/admin/LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin Sign In — FE Sales Arena" };

/** Only same-site admin paths are allowed as the post-login destination (no open redirect). */
function safeNext(next: string | string[] | undefined): string {
  const n = Array.isArray(next) ? next[0] : next;
  return n && /^\/admin(\/[A-Za-z0-9/_-]*)?$/.test(n) && !n.startsWith("/admin/login") ? n : "/admin";
}

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  const destination = safeNext(next);
  if (await getCurrentAdmin()) redirect(destination);
  return <LoginForm next={destination} dbConfigured={Boolean(getDbPool())} />;
}
