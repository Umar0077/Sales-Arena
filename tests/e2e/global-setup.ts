import { request, type FullConfig } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const ADMIN_STATE = path.join(__dirname, ".auth", "admin.json");

/**
 * Admin pages now need a real sign-in. Credentials come from E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD,
 * or from the gitignored .env.dev-admin.local file for a local dev database. Never hardcoded.
 */
function credentials(): { email: string; password: string } {
  let email = process.env.E2E_ADMIN_EMAIL;
  let password = process.env.E2E_ADMIN_PASSWORD;
  const file = path.join(process.cwd(), ".env.dev-admin.local");
  if ((!email || !password) && existsSync(file)) {
    const vars = Object.fromEntries(
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
    );
    email ??= vars.DEV_ADMIN_EMAIL;
    password ??= vars.DEV_ADMIN_PASSWORD;
  }
  if (!email || !password) throw new Error("Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD (a test admin on a non-production database).");
  return { email, password };
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL ?? "http://127.0.0.1:3000";
  const ctx = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL).origin } });
  const res = await ctx.post("/api/admin/auth/login", { data: credentials() });
  if (!res.ok()) throw new Error(`E2E admin sign-in failed with HTTP ${res.status()}`);
  mkdirSync(path.dirname(ADMIN_STATE), { recursive: true });
  await ctx.storageState({ path: ADMIN_STATE });
  await ctx.dispose();
}
