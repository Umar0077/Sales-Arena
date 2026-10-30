import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { POST as login } from "@/app/api/admin/auth/login/route";
import { POST as logout } from "@/app/api/admin/auth/logout/route";
import { GET as me } from "@/app/api/admin/auth/me/route";
import { POST as changePassword } from "@/app/api/admin/auth/password/route";
import { createAdmin, pool, req, resetDatabase, sessionFrom } from "./helpers";

const goodLogin = (email = "owner@example.com", password = "Correct-Horse-Battery-9", ip = "10.0.0.1") =>
  login(req("/api/admin/auth/login", { method: "POST", body: { email, password }, headers: { "x-real-ip": ip } }));

describe("admin authentication", () => {
  beforeAll(resetDatabase);
  beforeEach(async () => {
    await pool().query(`TRUNCATE admin_sessions, admin_login_attempts, audit_logs RESTART IDENTITY`);
    await pool().query(`DELETE FROM admin_users`);
    await createAdmin();
  });

  it("logs in with correct credentials: HttpOnly session cookie, hashed session in DB, audit", async () => {
    const res = await goodLogin();
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    const { token, cookie: c } = sessionFrom(res);
    const s = await pool().query(`SELECT id FROM admin_sessions`);
    expect(s.rowCount).toBe(1);
    expect(s.rows[0].id).not.toBe(token); // only the hash is stored
    expect(s.rows[0].id).toMatch(/^[0-9a-f]{64}$/);
    const m = await me(req("/api/admin/auth/me", { cookie: c }));
    expect(m.status).toBe(200);
    expect((await m.json()).admin.email).toBe("owner@example.com");
    const audit = await pool().query(`SELECT action FROM audit_logs`);
    expect(audit.rows.map((r) => r.action)).toContain("admin.login");
  });

  it("rejects a wrong password and an unknown email with the same generic message", async () => {
    const wrong = await goodLogin("owner@example.com", "wrong-password-123");
    const unknown = await goodLogin("nobody@example.com", "wrong-password-123");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect((await wrong.json()).error).toBe("Invalid email or password.");
    expect((await unknown.json()).error).toBe("Invalid email or password.");
    expect(wrong.headers.get("set-cookie")).toBeNull();
    const audit = await pool().query(`SELECT details FROM audit_logs WHERE action = 'admin.login_failed'`);
    expect(audit.rowCount).toBe(2);
    expect(JSON.stringify(audit.rows)).not.toContain("nobody@example.com"); // email stored only as a hash
  });

  it("rate-limits repeated failures, even when the right password follows", async () => {
    for (let i = 0; i < 5; i++) expect((await goodLogin("owner@example.com", "bad-password-xx", "10.0.0.9")).status).toBe(401);
    const blocked = await goodLogin("owner@example.com", "Correct-Horse-Battery-9", "10.0.0.9");
    expect(blocked.status).toBe(429);
  });

  it("blocks cross-site login posts", async () => {
    const res = await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "x" }, origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("requires a session for admin APIs, and CSRF + same origin for changes", async () => {
    expect((await me(req("/api/admin/auth/me"))).status).toBe(401);
    const { cookie, csrf } = sessionFrom(await goodLogin());
    const noCsrf = await logout(req("/api/admin/auth/logout", { method: "POST", cookie }));
    expect(noCsrf.status).toBe(403);
    const crossSite = await logout(req("/api/admin/auth/logout", { method: "POST", cookie, csrf, origin: "https://evil.example" }));
    expect(crossSite.status).toBe(403);
    const wrongCsrf = await logout(req("/api/admin/auth/logout", { method: "POST", cookie, csrf: "x".repeat(43) }));
    expect(wrongCsrf.status).toBe(403);
  });

  it("logout revokes the session", async () => {
    const { cookie, csrf } = sessionFrom(await goodLogin());
    const out = await logout(req("/api/admin/auth/logout", { method: "POST", cookie, csrf }));
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
    expect((await me(req("/api/admin/auth/me", { cookie }))).status).toBe(401);
    const s = await pool().query(`SELECT revoked_at FROM admin_sessions`);
    expect(s.rows[0].revoked_at).not.toBeNull();
  });

  it("expired sessions (absolute or idle) are rejected", async () => {
    const a = sessionFrom(await goodLogin());
    await pool().query(`UPDATE admin_sessions SET expires_at = NOW() - INTERVAL '1 second'`);
    expect((await me(req("/api/admin/auth/me", { cookie: a.cookie }))).status).toBe(401);

    const b = sessionFrom(await goodLogin());
    await pool().query(`UPDATE admin_sessions SET idle_expires_at = NOW() - INTERVAL '1 second' WHERE revoked_at IS NULL AND expires_at > NOW()`);
    expect((await me(req("/api/admin/auth/me", { cookie: b.cookie }))).status).toBe(401);
  });

  it("deactivated admins lose access immediately", async () => {
    const { cookie } = sessionFrom(await goodLogin());
    await pool().query(`UPDATE admin_users SET is_active = FALSE`);
    expect((await me(req("/api/admin/auth/me", { cookie }))).status).toBe(401);
  });

  it("changes the password securely and signs out other sessions", async () => {
    const one = sessionFrom(await goodLogin());
    const two = sessionFrom(await goodLogin("owner@example.com", "Correct-Horse-Battery-9", "10.0.0.2"));
    const bad = await changePassword(
      req("/api/admin/auth/password", { method: "POST", cookie: one.cookie, csrf: one.csrf, body: { currentPassword: "nope", newPassword: "Another-Strong-Pass-77" } }),
    );
    expect(bad.status).toBe(400);
    const weak = await changePassword(
      req("/api/admin/auth/password", { method: "POST", cookie: one.cookie, csrf: one.csrf, body: { currentPassword: "Correct-Horse-Battery-9", newPassword: "short" } }),
    );
    expect(weak.status).toBe(400);
    const ok = await changePassword(
      req("/api/admin/auth/password", {
        method: "POST",
        cookie: one.cookie,
        csrf: one.csrf,
        body: { currentPassword: "Correct-Horse-Battery-9", newPassword: "Another-Strong-Pass-77" },
      }),
    );
    expect(ok.status).toBe(200);
    expect((await me(req("/api/admin/auth/me", { cookie: one.cookie }))).status).toBe(200);
    expect((await me(req("/api/admin/auth/me", { cookie: two.cookie }))).status).toBe(401);
    expect((await goodLogin("owner@example.com", "Correct-Horse-Battery-9", "10.0.0.3")).status).toBe(401);
    expect((await goodLogin("owner@example.com", "Another-Strong-Pass-77", "10.0.0.3")).status).toBe(200);
    const h = await pool().query(`SELECT password_hash FROM admin_users`);
    expect(h.rows[0].password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });
});
