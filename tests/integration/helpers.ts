import { NextRequest } from "next/server";
import { closeDbPool, getDbPool } from "@/lib/server/db/client";
import { runMigrations } from "@/lib/server/db/migrate-core.mjs";
import { hashPassword } from "@/lib/server/auth/password";
import { csrfTokenFor, sessionCookieName } from "@/lib/server/auth/session";

export const ORIGIN = "http://arena.test";

export function pool() {
  const p = getDbPool();
  if (!p) throw new Error("no pool");
  return p;
}

/** Drops everything in the test database and applies all migrations. */
export async function resetDatabase() {
  const p = pool();
  await p.query("DROP SCHEMA public CASCADE");
  await p.query("CREATE SCHEMA public");
  await runMigrations(p);
}

export async function restartPool() {
  await closeDbPool();
  return pool();
}

export async function createAdmin(email = "owner@example.com", password = "Correct-Horse-Battery-9") {
  const hash = await hashPassword(password);
  const { rows } = await pool().query(
    `INSERT INTO admin_users (email, display_name, password_hash, role) VALUES ($1, 'Owner', $2, 'owner') RETURNING id`,
    [email, hash],
  );
  return { id: rows[0].id as string, email, password };
}

export async function createAgent(userCode: string, name = `Agent ${userCode}`) {
  await pool().query(
    `INSERT INTO agents (id, user_code, name, initials) VALUES ($1, $2, $3, 'AG') ON CONFLICT (user_code) DO NOTHING`,
    [`agt_${userCode}`, userCode, name],
  );
}

export async function setSetting(key: string, value: unknown) {
  await pool().query(
    `INSERT INTO admin_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)],
  );
}

export interface ReqOpts {
  method?: string;
  body?: unknown;
  cookie?: string | null;
  csrf?: string | null;
  origin?: string | null;
  headers?: Record<string, string>;
}

/** Builds a NextRequest as the browser would send it to this app. */
export function req(path: string, o: ReqOpts = {}) {
  const headers: Record<string, string> = { host: "arena.test", ...(o.headers ?? {}) };
  if (o.origin !== null) headers.origin = o.origin ?? ORIGIN;
  if (o.cookie) headers.cookie = o.cookie;
  if (o.csrf) headers["x-csrf-token"] = o.csrf;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`${ORIGIN}${path}`, {
    method: o.method ?? "GET",
    headers,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
}

/** Extracts "name=value" of the session cookie from a login response. */
export function sessionFrom(res: Response): { cookie: string; token: string; csrf: string } {
  const set = res.headers.get("set-cookie") ?? "";
  const m = set.match(new RegExp(`${sessionCookieName()}=([^;]+)`));
  if (!m) throw new Error("no session cookie");
  return { cookie: `${sessionCookieName()}=${m[1]}`, token: m[1], csrf: csrfTokenFor(m[1]) };
}
