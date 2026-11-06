import { describe, it, expect, afterEach } from "vitest";
import { ipInNetwork, networksOverlap, parseIp, parseNetwork, formatIp } from "@/shared/security/ip";
import { classifyPath, decide, type Policy, type PolicyRule } from "@/backend/security/ip-policy";
import { trustedClientIp } from "@/backend/security/client-ip";
import { lockoutProblem } from "@/backend/security/ip-admin";

const net = (s: string) => {
  const r = parseNetwork(s);
  if (!r.ok) throw new Error(r.error);
  return r.network;
};
let nextId = 1;
const rule = (cidr: string, o: Partial<PolicyRule> = {}): PolicyRule => ({ ...net(cidr), id: nextId++, label: cidr, active: true, allowManagement: false, expiresAt: null, ...o });
const policy = (rules: PolicyRule[], o: Partial<Policy> = {}): Policy => ({ enabled: true, protectArena: true, protectPairing: true, protectAdmin: false, revision: 1, rules, ...o });

describe("IP parsing and CIDR matching (numeric, IPv4 + IPv6)", () => {
  it("parses and normalises valid input", () => {
    expect(net("203.0.113.25").cidr).toBe("203.0.113.25/32");
    expect(net("192.0.2.0/24").cidr).toBe("192.0.2.0/24");
    expect(net("2001:DB8::/32").cidr).toBe("2001:db8::/32");
    expect(net("2001:db8:0:0:0:0:0:1").cidr).toBe("2001:db8::1/128");
    expect(formatIp(parseIp("::ffff:192.0.2.7")!)).toBe("192.0.2.7"); // IPv4-mapped → IPv4
    expect(formatIp(parseIp("::1")!)).toBe("::1");
  });
  it("rejects invalid input with a clear message", () => {
    for (const bad of ["", "300.1.1.1", "1.2.3", "01.2.3.4", "1.2.3.4/33", "2001:db8::/129", "abc", "1.2.3.4/24/1", "fe80::1%eth0", "1:2:3:4:5:6:7:8:9", "1::2::3"])
      expect(parseNetwork(bad).ok, bad).toBe(false);
    const hostBits = parseNetwork("192.0.2.5/24");
    expect(hostBits.ok).toBe(false);
    expect(!hostBits.ok && hostBits.error).toContain("192.0.2.0/24");
    expect(parseNetwork("0.0.0.0/0").ok).toBe(false); // never "allow everything"
  });
  it("matches subnets exactly, never by string prefix", () => {
    const n = net("10.1.0.0/16");
    expect(ipInNetwork(parseIp("10.1.255.255")!, n)).toBe(true);
    expect(ipInNetwork(parseIp("10.10.0.1")!, n)).toBe(false); // "10.1" string prefix would wrongly match
    expect(ipInNetwork(parseIp("10.2.0.1")!, n)).toBe(false);
    expect(ipInNetwork(parseIp("2001:db8:abcd::5")!, net("2001:db8::/32"))).toBe(true);
    expect(ipInNetwork(parseIp("2001:db9::5")!, net("2001:db8::/32"))).toBe(false);
    expect(ipInNetwork(parseIp("192.0.2.1")!, net("2001:db8::/32"))).toBe(false); // families never mix
    expect(networksOverlap(net("192.0.2.0/24"), net("192.0.2.128/25"))).toBe(true);
    expect(networksOverlap(net("192.0.2.0/25"), net("192.0.2.128/25"))).toBe(false);
  });
});

describe("protection scopes and decisions", () => {
  it("classifies routes; static assets are never blocked", () => {
    expect(classifyPath("/_next/static/chunks/a.js")).toBe("static");
    expect(classifyPath("/brand/logo-mark.webp")).toBe("static");
    expect(classifyPath("/")).toBe("arena");
    for (const p of ["/arena", "/spin", "/leaderboard", "/demo", "/api/arena/summary", "/api/arena/stream", "/api/arena/spin"]) expect(classifyPath(p), p).toBe("arena");
    expect(classifyPath("/pair")).toBe("pairing");
    expect(classifyPath("/api/arena/device/pair")).toBe("pairing");
    for (const p of ["/admin", "/admin/login", "/admin/ip-security", "/api/admin/auth/login", "/api/admin/ip-security"]) expect(classifyPath(p), p).toBe("admin");
    expect(classifyPath("/admin/x.js")).toBe("admin"); // no static loophole under /admin
  });
  it("allows matching active rules and blocks everything else", () => {
    const now = Date.now();
    const p = policy([rule("192.0.2.0/24"), rule("203.0.113.9", { active: false }), rule("198.51.100.7", { expiresAt: now - 1 }), rule("2001:db8::/32", { allowManagement: true })]);
    expect(decide(p, "arena", "192.0.2.77", now)).toMatchObject({ allowed: true, reason: "matched" });
    expect(decide(p, "arena", "203.0.113.9", now)).toMatchObject({ allowed: false, reason: "no_match" }); // inactive
    expect(decide(p, "arena", "198.51.100.7", now)).toMatchObject({ allowed: false }); // expired
    expect(decide(p, "arena", "2001:db8::42", now).allowed).toBe(true);
    expect(decide(p, "arena", null, now)).toMatchObject({ allowed: false, reason: "no_ip" });
    expect(decide(p, "static", null, now).allowed).toBe(true);
    // Admin scope: off by default; when on, only management rules count.
    expect(decide(p, "admin", "8.8.8.8", now)).toMatchObject({ allowed: true, reason: "scope_open" });
    const pa = { ...p, protectAdmin: true };
    expect(decide(pa, "admin", "192.0.2.77", now).allowed).toBe(false);
    expect(decide(pa, "admin", "2001:db8::42", now).allowed).toBe(true);
    // Master switch off: nothing is IP-restricted. Unknown policy (DB down, nothing cached): fail closed.
    expect(decide({ ...p, enabled: false }, "arena", "8.8.8.8", now).allowed).toBe(true);
    expect(decide(null, "arena", "192.0.2.77", now)).toMatchObject({ allowed: false, reason: "unavailable" });
    expect(decide({ ...p, protectArena: false }, "arena", "8.8.8.8", now)).toMatchObject({ allowed: true, reason: "scope_open" });
  });
});

describe("trusted client IP (spoofing)", () => {
  afterEach(() => {
    delete process.env.SALES_ARENA_PROXY_SECRET;
  });
  const h = (o: Record<string, string>) => new Headers(o);
  it("uses only X-Real-IP set by nginx; X-Forwarded-For is ignored", () => {
    expect(trustedClientIp(h({ "x-real-ip": "203.0.113.5" }))).toBe("203.0.113.5");
    expect(trustedClientIp(h({ "x-forwarded-for": "192.0.2.1" }))).toBeNull();
    expect(trustedClientIp(h({ "x-real-ip": "198.51.100.1", "x-forwarded-for": "192.0.2.1" }))).toBe("198.51.100.1");
    expect(trustedClientIp(h({ "x-real-ip": "192.0.2.1, 198.51.100.1" }))).toBeNull(); // nginx never sends a list
    expect(trustedClientIp(h({ "x-real-ip": "not-an-ip" }))).toBeNull();
    expect(trustedClientIp(h({ "x-real-ip": "::ffff:192.0.2.1" }))).toBe("192.0.2.1");
  });
  it("with a proxy secret, requests that did not come through nginx have no trusted IP", () => {
    process.env.SALES_ARENA_PROXY_SECRET = "s3cret-value-from-nginx";
    expect(trustedClientIp(h({ "x-real-ip": "203.0.113.5" }))).toBeNull();
    expect(trustedClientIp(h({ "x-real-ip": "203.0.113.5", "x-sales-arena-proxy": "wrong" }))).toBeNull();
    expect(trustedClientIp(h({ "x-real-ip": "203.0.113.5", "x-sales-arena-proxy": "s3cret-value-from-nginx" }))).toBe("203.0.113.5");
  });
});

describe("lockout protection", () => {
  const me = "192.0.2.10";
  it("refuses unsafe policies and accepts safe ones", () => {
    const off = policy([], { enabled: false });
    expect(lockoutProblem(off, me)).toBeNull();
    expect(lockoutProblem(policy([rule("192.0.2.0/24")]), me, { enabling: true })).toMatch(/Admin-access rule/);
    expect(lockoutProblem(policy([rule("192.0.2.0/24", { allowManagement: true, expiresAt: Date.now() + 60_000 })]), me, { enabling: true })).toMatch(/without an expiry/);
    expect(lockoutProblem(policy([rule("198.51.100.0/24", { allowManagement: true })]), me, { enabling: true })).toMatch(/Your current IP \(192\.0\.2\.10\)/);
    expect(lockoutProblem(policy([rule("192.0.2.0/24", { allowManagement: true })]), me, { enabling: true })).toBeNull();
    expect(lockoutProblem(policy([rule("192.0.2.0/24", { allowManagement: true })]), null, { enabling: true })).toMatch(/could not be verified/);
    // Already on, Admin scope off: an Owner elsewhere may still manage, but never remove the last management rule.
    expect(lockoutProblem(policy([rule("198.51.100.0/24", { allowManagement: true })]), me)).toBeNull();
    expect(lockoutProblem(policy([rule("198.51.100.0/24", { allowManagement: true, active: false })]), me)).toMatch(/Admin-access rule/);
    expect(lockoutProblem(policy([rule("198.51.100.0/24", { allowManagement: true })], { protectAdmin: true }), me)).toMatch(/lock yourself out/);
  });
});
