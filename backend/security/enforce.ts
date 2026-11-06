import { readSession } from "../auth/session";
import { trustedClientIp } from "./client-ip";
import { classifyPath, decide, getPolicy, type Decision, type Scope } from "./ip-policy";

const COOKIE_NAMES = ["__Host-sa_admin", "sa_admin"];

export interface Access {
  decision: Decision;
  ip: string | null;
  scope: Scope;
}

function cookieToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (COOKIE_NAMES.includes(k)) return decodeURIComponent(v.join("="));
  }
  return null;
}

/**
 * Server-side access decision for one request (used by proxy.ts and re-checked by the SSE stream).
 * A signed-in administrator's panel reads a few Live Arena APIs (/api/arena/*); those are allowed for
 * a valid session only when that admin may reach the Admin scope from this IP. Pages are never exempt.
 */
export async function evaluateAccess(pathname: string, headers: Headers): Promise<Access> {
  const scope = classifyPath(pathname);
  if (scope === "static") return { decision: { allowed: true, reason: "static" }, ip: null, scope };
  const ip = trustedClientIp(headers);
  const policy = await getPolicy();
  const decision = decide(policy, scope, ip);
  if (!decision.allowed && decision.reason !== "unavailable" && scope === "arena" && pathname.startsWith("/api/arena/")) {
    const token = cookieToken(headers.get("cookie"));
    if (token && decide(policy, "admin", ip).allowed) {
      const session = await readSession(token).catch(() => null);
      if (session) return { decision: { allowed: true, reason: "admin_session" }, ip, scope };
    }
  }
  return { decision, ip, scope };
}

const MESSAGE = "This network is not authorized to access FE Sales Arena. Please contact your administrator.";
const UNAVAILABLE = "FE Sales Arena cannot verify network access right now. Please try again in a moment.";

/** Branded 403 (or 503 while the policy cannot be verified). No data, no whitelist details, no 3D. */
export function deniedResponse(pathname: string, reason: string): Response {
  const unavailable = reason === "unavailable";
  const status = unavailable ? 503 : 403;
  const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff" };
  if (pathname.startsWith("/api/"))
    return Response.json({ ok: false, error: unavailable ? UNAVAILABLE : MESSAGE, code: unavailable ? "ACCESS_UNVERIFIED" : "IP_NOT_ALLOWED" }, { status, headers });
  return new Response(page(unavailable ? "ACCESS TEMPORARILY UNAVAILABLE" : "ACCESS RESTRICTED", unavailable ? UNAVAILABLE : MESSAGE), {
    status,
    headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'" },
  });
}

function page(title: string, text: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Access restricted · FE Sales Arena</title><meta name="robots" content="noindex">
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:radial-gradient(1200px 600px at 50% -10%,#2a1f6b 0%,#0a0e1a 55%,#060912 100%);color:#e8ebff;
font-family:Sora,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:grid;place-items:center;padding:24px}
.card{width:100%;max-width:520px;text-align:center;border:1px solid rgba(255,255,255,.08);border-radius:24px;padding:40px 28px;
background:linear-gradient(180deg,rgba(22,18,58,.85),rgba(10,15,34,.9));box-shadow:0 0 80px -20px rgba(117,104,255,.55)}
.logo{width:56px;height:56px;border-radius:14px;margin:0 auto 18px;display:block}
.brand{font-size:13px;font-weight:800;letter-spacing:.32em;color:#a8b0d8}
.shield{width:64px;height:64px;margin:22px auto 6px;border-radius:18px;display:grid;place-items:center;
border:1px solid rgba(255,107,129,.35);background:rgba(255,107,129,.08)}
h1{margin:14px 0 10px;font-size:28px;font-weight:800;letter-spacing:.06em;color:#fff}
p{margin:0;color:#b9bfdc;font-size:16px;line-height:1.55}
.code{margin-top:24px;font-size:12px;color:#6f789d;letter-spacing:.12em}
</style></head><body><main class="card" role="main">
<img class="logo" src="/brand/logo-mark.webp" alt="" width="56" height="56">
<div class="brand">FE SALES ARENA</div>
<div class="shield" aria-hidden="true"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#ff6b81" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/></svg></div>
<h1>${title}</h1><p>${text}</p><div class="code">ERROR ${title.startsWith("ACCESS RESTRICTED") ? "403" : "503"}</div>
</main></body></html>`;
}
