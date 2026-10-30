import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createAdmin, req, resetDatabase, sessionFrom } from "./helpers";
import { POST as login } from "@/app/api/admin/auth/login/route";

/**
 * Sweeps EVERY route file under app/api/admin and calls each exported method:
 * without a session it must answer 401; a mutating method with a session but no
 * CSRF token must answer 403. Only the login endpoint is public.
 */
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? routeFiles(p) : f === "route.ts" ? [p] : [];
  });
}

const ROOT = path.join(process.cwd(), "app", "api", "admin");
const files = routeFiles(ROOT).filter((f) => !f.includes(`${path.sep}auth${path.sep}login${path.sep}`));
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

describe("every /api/admin endpoint is protected", () => {
  let cookie = "";
  beforeAll(async () => {
    await resetDatabase();
    await createAdmin();
    cookie = sessionFrom(
      await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" } })),
    ).cookie;
  });

  it("finds the admin route files", () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  for (const file of files) {
    const rel = path.relative(ROOT, path.dirname(file)).replace(/\\/g, "/");
    const url = `/api/admin/${rel.replace(/\[id\]/, "00000000-0000-0000-0000-000000000000")}`;
    it(`${rel || "(root)"}`, async () => {
      const mod = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
      const ctx = { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) };
      let checked = 0;
      for (const m of METHODS) {
        const handler = mod[m] as ((r: unknown, c: unknown) => Promise<Response>) | undefined;
        if (typeof handler !== "function") continue;
        checked++;
        const anon = await handler(req(url, { method: m, body: m === "GET" ? undefined : {} }), ctx);
        expect(anon.status, `${m} ${url} without session`).toBe(401);
        if (m !== "GET") {
          const noCsrf = await handler(req(url, { method: m, cookie, body: {} }), ctx);
          expect(noCsrf.status, `${m} ${url} without CSRF`).toBe(403);
        }
      }
      expect(checked).toBeGreaterThan(0);
    });
  }
});
