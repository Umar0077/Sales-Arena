import { timingSafeEqual } from "node:crypto";
import { formatIp, parseIp } from "@/lib/security/ip";

/**
 * The real client IP, taken ONLY from the trusted reverse proxy (Nginx).
 *
 * Trust boundary (see docs/DEPLOYMENT.md, "IP perimeter security"):
 *  - Node listens on 127.0.0.1:3102 only, so every request comes through Nginx.
 *  - Nginx OVERWRITES `X-Real-IP` with `$remote_addr` (a client-sent value never survives).
 *  - Optional defence in depth: Nginx also sends `X-Sales-Arena-Proxy: <SALES_ARENA_PROXY_SECRET>`.
 *    When that secret is configured, a request without it (e.g. straight to the Node port) has no
 *    trusted IP at all and is treated as unknown.
 *  - `X-Forwarded-For` is never used: clients can prepend anything to it.
 * A future CDN / load balancer must be configured in Nginx (set_real_ip_from + real_ip_header) so that
 * `$remote_addr` is the visitor again; the application keeps reading only `X-Real-IP`.
 */

export const PROXY_SECRET_HEADER = "x-sales-arena-proxy";

function secretOk(got: string | null): boolean {
  const want = process.env.SALES_ARENA_PROXY_SECRET;
  if (!want) return true; // not configured: rely on the 127.0.0.1 binding
  if (!got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function trustedClientIp(headers: Headers): string | null {
  if (!secretOk(headers.get(PROXY_SECRET_HEADER))) return null;
  const raw = headers.get("x-real-ip");
  if (!raw || raw.includes(",")) return null; // Nginx sends exactly one address
  const ip = parseIp(raw);
  return ip ? formatIp(ip) : null; // canonical form; IPv4-mapped IPv6 becomes IPv4
}
