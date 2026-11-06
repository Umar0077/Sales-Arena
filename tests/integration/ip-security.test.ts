import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { proxy } from "@/proxy";
import { GET as overviewRoute } from "@/app/api/admin/ip-security/route";
import { PUT as settingsRoute } from "@/app/api/admin/ip-security/settings/route";
import { POST as createRuleRoute } from "@/app/api/admin/ip-security/rules/route";
import { PATCH as patchRuleRoute, DELETE as deleteRuleRoute } from "@/app/api/admin/ip-security/rules/[id]/route";
import { POST as currentIpRoute } from "@/app/api/admin/ip-security/rules/current/route";
import { GET as streamRoute } from "@/app/api/arena/stream/route";
import { POST as login } from "@/app/api/admin/auth/login/route";
import { __resetPolicyCache, getPolicy, decide, REVISION_CHECK_MS } from "@/backend/security/ip-policy";
import { deniedResponse } from "@/backend/security/enforce";
import { ipInNetwork, parseIp, parseNetwork } from "@/shared/security/ip";
import { createAdmin, pool, req, resetDatabase, restartPool, sessionFrom } from "./helpers";

const OFFICE = "192.0.2.10"; // owner's network (documentation range)
const FLOOR = "198.51.100.0/24";
const OUTSIDE = "203.0.113.99";
let owner: { cookie: string; csrf: string };
let plainAdmin: { cookie: string; csrf: string };

const as = (ip: string | null, s = owner, extra: Record<string, string> = {}) => ({ cookie: s.cookie, csrf: s.csrf, headers: { ...(ip ? { "x-real-ip": ip } : {}), ...extra } });
const visit = (path: string, ip: string | null, headers: Record<string, string> = {}) => proxy(req(path, { headers: { ...(ip ? { "x-real-ip": ip } : {}), ...headers } }));
const allowed = (r: Response) => r.status !== 403 && r.status !== 503;
const addRule = async (body: Record<string, unknown>, ip = OFFICE) => {
  const res = await createRuleRoute(req("/api/admin/ip-security/rules", { method: "POST", body, ...as(ip) }));
  return { status: res.status, body: await res.json() };
};
const settings = async (body: Record<string, unknown>, ip: string | null = OFFICE) => {
  const res = await settingsRoute(req("/api/admin/ip-security/settings", { method: "PUT", body, ...as(ip) }));
  return { status: res.status, body: await res.json() };
};
const patchRule = async (id: number, body: Record<string, unknown>, ip = OFFICE) => {
  const res = await patchRuleRoute(req(`/api/admin/ip-security/rules/${id}`, { method: "PATCH", body, ...as(ip) }), { params: Promise.resolve({ id: String(id) }) });
  return { status: res.status, body: await res.json() };
};

describe("IP perimeter security (PostgreSQL + proxy enforcement)", () => {
  beforeAll(async () => {
    await resetDatabase();
    await createAdmin();
    await createAdmin("staff@example.com");
    await pool().query(`UPDATE admin_users SET role = 'admin' WHERE email = 'staff@example.com'`);
    owner = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "owner@example.com", password: "Correct-Horse-Battery-9" } })));
    plainAdmin = sessionFrom(await login(req("/api/admin/auth/login", { method: "POST", body: { email: "staff@example.com", password: "Correct-Horse-Battery-9" } })));
  });
  beforeEach(async () => {
    await pool().query(`TRUNCATE ip_whitelist_rules RESTART IDENTITY`);
    await pool().query(`UPDATE ip_security_settings SET enabled = FALSE, protect_arena = TRUE, protect_pairing = TRUE, protect_admin = FALSE, revision = revision + 1`);
    __resetPolicyCache();
  });
  afterEach(() => {
    delete process.env.SALES_ARENA_PROXY_SECRET;
  });

  async function standardSetup() {
    const office = await addRule({ network: OFFICE, label: "Head Office", allowManagement: true });
    const floor = await addRule({ network: FLOOR, label: "FE Floor" });
    const v6 = await addRule({ network: "2001:db8::/32", label: "IPv6 branch" });
    expect([office.status, floor.status, v6.status]).toEqual([201, 201, 201]);
    expect((await settings({ enabled: true, confirm: true })).status).toBe(200);
    return { office: office.body.rule, floor: floor.body.rule, v6: v6.body.rule };
  }

  it("Tests 1–6: authorised IPs, CIDR subnets and IPv6 pass; others, inactive and expired rules get 403", async () => {
    // Restriction off (default after migration): nobody is IP-blocked.
    expect(allowed(await visit("/", OUTSIDE))).toBe(true);
    const { floor } = await standardSetup();
    expect(allowed(await visit("/", OFFICE))).toBe(true);
    expect(allowed(await visit("/arena", "198.51.100.200"))).toBe(true); // inside the /24
    expect(allowed(await visit("/", "2001:db8:1::5"))).toBe(true);
    const denied = await visit("/", OUTSIDE);
    expect(denied.status).toBe(403);
    const html = await denied.text();
    expect(html).toContain("ACCESS RESTRICTED");
    expect(html).toContain("This network is not authorized to access FE Sales Arena. Please contact your administrator.");
    for (const secret of ["Head Office", "FE Floor", "198.51.100", OFFICE]) expect(html).not.toContain(secret); // no whitelist details
    expect((await visit("/api/arena/summary", OUTSIDE)).status).toBe(403);
    expect(await (await visit("/api/arena/summary", OUTSIDE)).json()).toMatchObject({ ok: false, code: "IP_NOT_ALLOWED" });
    expect(allowed(await visit("/_next/static/chunks/main.js", OUTSIDE))).toBe(true); // static assets are not data

    expect((await patchRule(floor.id, { active: false })).status).toBe(200); // inactive
    expect((await visit("/", "198.51.100.200")).status).toBe(403);
    expect((await patchRule(floor.id, { active: true })).status).toBe(200);
    await pool().query(`UPDATE ip_whitelist_rules SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [floor.id]); // expired
    await pool().query(`UPDATE ip_security_settings SET revision = revision + 1`);
    __resetPolicyCache();
    expect((await visit("/", "198.51.100.200")).status).toBe(403);
  });

  it("Test 7: changes apply without a restart (this process at once, other processes within the revision check)", async () => {
    await standardSetup();
    expect((await visit("/", OUTSIDE)).status).toBe(403);
    expect((await addRule({ network: OUTSIDE, label: "Remote Office" })).status).toBe(201);
    expect(allowed(await visit("/", OUTSIDE))).toBe(true); // same process: immediately
    // Another process (or the console script) changes the database directly:
    await getPolicy();
    await pool().query(`UPDATE ip_whitelist_rules SET active = FALSE WHERE label = 'Remote Office'`);
    await pool().query(`UPDATE ip_security_settings SET revision = revision + 1`);
    await new Promise((r) => setTimeout(r, REVISION_CHECK_MS + 300));
    expect((await visit("/", OUTSIDE)).status).toBe(403);
  });

  it("Test 8: the restriction survives an application restart", async () => {
    await standardSetup();
    await restartPool();
    __resetPolicyCache();
    expect((await visit("/", OUTSIDE)).status).toBe(403);
    expect(allowed(await visit("/", OFFICE))).toBe(true);
  });

  it("Test 9: forged forwarding headers are ignored; without the nginx proxy secret there is no trusted IP", async () => {
    await standardSetup();
    expect((await visit("/", OUTSIDE, { "x-forwarded-for": OFFICE })).status).toBe(403);
    expect((await visit("/", null, { "x-forwarded-for": OFFICE })).status).toBe(403);
    expect((await visit("/", `${OFFICE}, ${OUTSIDE}`)).status).toBe(403);
    process.env.SALES_ARENA_PROXY_SECRET = "from-nginx-only";
    expect((await visit("/", OFFICE)).status).toBe(403); // straight to the Node port: no secret
    expect(allowed(await visit("/", OFFICE, { "x-sales-arena-proxy": "from-nginx-only" }))).toBe(true);
    // "Whitelist my current IP" never trusts an IP from the request body.
    delete process.env.SALES_ARENA_PROXY_SECRET;
    const r = await currentIpRoute(req("/api/admin/ip-security/rules/current", { method: "POST", body: { label: "Me", confirm: true, ip: "8.8.8.8", network: "8.8.8.8" }, ...as("198.18.0.5") }));
    expect((await r.json()).rule.network).toBe("198.18.0.5");
  });

  it("Test 10: only a signed-in Owner (with CSRF) can view or manage rules", async () => {
    const body = { network: OUTSIDE, label: "x" };
    expect((await createRuleRoute(req("/api/admin/ip-security/rules", { method: "POST", body, headers: { "x-real-ip": OFFICE } }))).status).toBe(401);
    expect((await createRuleRoute(req("/api/admin/ip-security/rules", { method: "POST", body, cookie: owner.cookie, headers: { "x-real-ip": OFFICE } }))).status).toBe(403); // no CSRF
    expect((await createRuleRoute(req("/api/admin/ip-security/rules", { method: "POST", body, ...as(OFFICE, plainAdmin) }))).status).toBe(403); // not Owner
    expect((await settingsRoute(req("/api/admin/ip-security/settings", { method: "PUT", body: { enabled: false }, ...as(OFFICE, plainAdmin) }))).status).toBe(403);
    expect((await overviewRoute(req("/api/admin/ip-security", { ...as(OFFICE, plainAdmin) }))).status).toBe(403);
    expect((await overviewRoute(req("/api/admin/ip-security"))).status).toBe(401);
    expect((await pool().query(`SELECT COUNT(*)::int AS n FROM ip_whitelist_rules`)).rows[0].n).toBe(0);
  });

  it("Test 11: lockout protection — cannot enable unsafely or remove the last management rule", async () => {
    const floor = (await addRule({ network: FLOOR, label: "FE Floor" })).body.rule;
    expect((await settings({ enabled: true })).status).toBe(428); // explicit confirmation required
    expect((await settings({ enabled: true, confirm: true })).body.error).toMatch(/Admin-access rule/);
    const office = (await addRule({ network: OFFICE, label: "Head Office", allowManagement: true })).body.rule;
    expect((await settings({ enabled: true, confirm: true }, OUTSIDE)).body.error).toMatch(/Your current IP \(203\.0\.113\.99\)/);
    expect((await settings({ enabled: true, confirm: true }, null)).body.error).toMatch(/could not be verified/);
    expect((await settings({ enabled: true, confirm: true })).status).toBe(200);

    expect((await patchRule(office.id, { active: false })).body.error).toMatch(/Admin-access rule/);
    expect((await patchRule(office.id, { allowManagement: false })).status).toBe(409);
    expect((await patchRule(office.id, { expiresAt: new Date(Date.now() + 3600_000).toISOString() })).body.error).toMatch(/without an expiry/);
    const del = await deleteRuleRoute(req(`/api/admin/ip-security/rules/${office.id}`, { method: "DELETE", ...as(OFFICE) }), { params: Promise.resolve({ id: String(office.id) }) });
    expect(del.status).toBe(409);
    // With the Admin scope on, an Owner can't cut off their own network.
    expect((await settings({ protectAdmin: true })).status).toBe(200);
    expect((await patchRule(office.id, { network: "192.0.3.0/24" })).body.error).toMatch(/lock yourself out/);
    // Harmless changes still work.
    expect((await patchRule(floor.id, { active: false })).status).toBe(200);
    expect((await settings({ protectArena: false, protectPairing: false, protectAdmin: false })).body.error).toMatch(/at least one area/);
    // Turning it off is always possible.
    expect((await settings({ enabled: false })).status).toBe(200);
    expect((await patchRule(office.id, { active: false })).status).toBe(200);
  });

  it("validates networks (frontend rules = backend rules = PostgreSQL cidr) and refuses overlaps", async () => {
    expect((await addRule({ network: "192.0.2.5/24", label: "x" })).body.error).toMatch(/192\.0\.2\.0\/24/);
    expect((await addRule({ network: "999.1.1.1", label: "x" })).status).toBe(400);
    expect((await addRule({ network: OFFICE, label: "" })).body.error).toMatch(/label/i);
    expect((await addRule({ network: OFFICE, label: "x", expiresAt: "2001-01-01T00:00:00Z" })).body.error).toMatch(/future/);
    expect((await addRule({ network: "192.0.2.0/24", label: "Office LAN" })).status).toBe(201);
    const dup = await addRule({ network: "192.0.2.128/25", label: "Overlap" });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toContain("Office LAN");
    // Database-level guarantee too (exclusion constraint), even if the API check were bypassed.
    await expect(pool().query(`INSERT INTO ip_whitelist_rules (network, label) VALUES ('192.0.2.10/32', 'raw')`)).rejects.toThrow();
    // JS matching agrees with PostgreSQL's own `<<=` operator.
    const cases: Array<[string, string]> = [["10.1.2.3", "10.1.0.0/16"], ["10.10.0.1", "10.1.0.0/16"], ["2001:db8::1", "2001:db8::/32"], ["2001:db9::1", "2001:db8::/32"], ["192.0.2.255", "192.0.2.128/25"], ["192.0.2.127", "192.0.2.128/25"], ["::ffff:192.0.2.1", "192.0.2.0/24"]];
    for (const [ip, cidr] of cases) {
      const pg = (await pool().query(`SELECT host(($1::inet))::inet <<= $2::cidr AS m, family($1::inet) AS f`, [ip, cidr])).rows[0];
      const n = parseNetwork(cidr);
      const js = n.ok && ipInNetwork(parseIp(ip)!, n.network);
      if (ip.startsWith("::ffff:")) expect(js).toBe(true); // mapped IPv4 is treated as IPv4 by design
      else expect(js, `${ip} in ${cidr}`).toBe(pg.m);
    }
  });

  it("Test 12: database outage keeps the last verified policy; with nothing cached it fails closed (503)", async () => {
    await standardSetup();
    await getPolicy();
    const broken = { query: () => Promise.reject(new Error("connection refused")) };
    const cached = await getPolicy({ db: broken, now: Date.now() + REVISION_CHECK_MS + 10 });
    expect(decide(cached, "arena", OUTSIDE).allowed).toBe(false); // still enforced, not opened up
    expect(decide(cached, "arena", OFFICE).allowed).toBe(true);
    __resetPolicyCache();
    const cold = await getPolicy({ db: broken });
    expect(cold).toBeNull();
    expect(decide(cold, "arena", OFFICE)).toMatchObject({ allowed: false, reason: "unavailable" });
    expect(deniedResponse("/", "unavailable").status).toBe(503);
  });

  it("Test 13: admin login is covered by the Admin scope (management networks only) and stays session-protected", async () => {
    await standardSetup();
    expect(allowed(await visit("/admin/login", OUTSIDE))).toBe(true); // Admin scope off: sign-in still required
    expect((await settings({ protectAdmin: true })).status).toBe(200);
    expect((await visit("/admin/login", OUTSIDE)).status).toBe(403);
    expect((await visit("/api/admin/auth/login", "198.51.100.200")).status).toBe(403); // arena-only rule
    expect(allowed(await visit("/admin/login", OFFICE))).toBe(true);
    const r = await visit("/admin", OFFICE); // allowed network, no session → still sent to the login page
    expect(r.status).toBe(307);
  });

  it("Test 15: the live stream, public APIs and pairing obey the policy; open streams are cut when access is removed", async () => {
    const { floor } = await standardSetup();
    expect((await visit("/api/arena/stream", OUTSIDE)).status).toBe(403);
    expect((await streamRoute(req("/api/arena/stream", { headers: { "x-real-ip": OUTSIDE } }))).status).toBe(403); // defence in depth
    expect((await visit("/pair", OUTSIDE)).status).toBe(403);
    expect((await visit("/api/arena/device/pair", OUTSIDE)).status).toBe(403);
    expect((await visit("/api/arena/spin", OUTSIDE)).status).toBe(403);

    const ctl = new AbortController();
    const live = await streamRoute(new (await import("next/server")).NextRequest("http://arena.test/api/arena/stream", { headers: { "x-real-ip": "198.51.100.200" }, signal: ctl.signal }));
    expect(live.status).toBe(200);
    const reader = live.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("event: ready");
    expect((await patchRule(floor.id, { active: false })).status).toBe(200); // remove this network's access
    let text = "";
    let done = false;
    const until = Date.now() + 5000;
    while (!done && Date.now() < until) {
      const r = await reader.read();
      done = r.done;
      if (r.value) text += new TextDecoder().decode(r.value);
    }
    expect(text).toContain("event: access.revoked");
    expect(done).toBe(true);
    ctl.abort();

    // A signed-in admin's panel may read Live Arena APIs (not pages) when the Admin scope allows it.
    expect(allowed(await visit("/api/arena/mode", OUTSIDE, { cookie: owner.cookie }))).toBe(true);
    expect((await visit("/", OUTSIDE, { cookie: owner.cookie })).status).toBe(403);
    expect((await visit("/api/arena/mode", OUTSIDE, { cookie: "sa_admin=forged-token-value-123456789" })).status).toBe(403);
  });

  it("Test 13/14: every change is audited with the Owner, source IP and old/new values; overview reflects this connection", async () => {
    const created = await addRule({ network: OFFICE, label: "Head Office", allowManagement: true });
    await patchRule(created.body.rule.id, { label: "HQ" });
    await settings({ enabled: true, confirm: true });
    const rows = (await pool().query(`SELECT a.action, a.ip_address, a.details, u.email FROM audit_logs a JOIN admin_users u ON u.id = a.admin_id WHERE a.action LIKE 'ip_security.%' ORDER BY a.id`)).rows;
    expect(rows.slice(-3).map((r) => r.action)).toEqual(["ip_security.rule.created", "ip_security.rule.updated", "ip_security.restriction.enabled"]);
    expect(rows.at(-1)).toMatchObject({ ip_address: OFFICE, email: "owner@example.com" });
    expect(rows.at(-2)!.details).toMatchObject({ old: { label: "Head Office" }, new: { label: "HQ" } });

    const ov = await (await overviewRoute(req("/api/admin/ip-security", { ...as(OFFICE) }))).json();
    expect(ov.current).toMatchObject({ ip: OFFICE, arenaAllowedNow: true, adminAllowedWhenOn: true, matchedRule: { label: "HQ" } });
    expect(ov.stats).toMatchObject({ enabled: true, activeRules: 1, managementRules: 1, totalRules: 1 });
    const other = await (await overviewRoute(req("/api/admin/ip-security", { ...as(OUTSIDE) }))).json();
    expect(other.current).toMatchObject({ ip: OUTSIDE, arenaAllowedNow: false, matchedRule: null });

    // Soft delete keeps the row for the audit trail.
    await addRule({ network: FLOOR, label: "Temp" });
    const temp = (await pool().query(`SELECT id FROM ip_whitelist_rules WHERE label = 'Temp'`)).rows[0].id;
    expect((await deleteRuleRoute(req(`/api/admin/ip-security/rules/${temp}`, { method: "DELETE", ...as(OFFICE) }), { params: Promise.resolve({ id: String(temp) }) })).status).toBe(200);
    expect((await pool().query(`SELECT archived_at IS NOT NULL AS a FROM ip_whitelist_rules WHERE id = $1`, [temp])).rows[0].a).toBe(true);
    expect((await addRule({ network: FLOOR, label: "Re-added" })).status).toBe(201); // archived rules don't block re-adding
  });
});
