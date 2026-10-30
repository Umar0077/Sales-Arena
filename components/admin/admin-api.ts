"use client";

/**
 * Client helper for /api/admin calls. The CSRF token is kept in memory only
 * (handed over by the server layout), never in localStorage. A 401 sends the
 * admin back to the login page.
 */
let csrfToken: string | null = null;

export function setCsrfToken(token: string) {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export async function adminApi<T = unknown>(
  url: string,
  init: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    if (csrfToken) headers["x-csrf-token"] = csrfToken;
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, error: "Network error. Check the connection and try again." };
  }
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = `/admin/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  let json: Record<string, unknown> = {};
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok || json.ok === false) {
    return { ok: false, status: res.status, error: typeof json.error === "string" ? json.error : `Request failed (${res.status}).` };
  }
  return { ok: true, data: json as T };
}
