import { NextResponse } from "next/server";
import { SpinError } from "./ledger";

const STATUS: Record<SpinError["code"], number> = {
  agent_not_found: 404,
  insufficient_credits: 409,
  invalid_input: 400,
  no_prizes: 409,
  conflict: 409,
};

/** Maps known errors to clear responses; anything else becomes a safe 503 ("nothing was saved"). */
export function errorResponse(err: unknown, fallback = "The database is unavailable. Nothing was saved.") {
  if (err instanceof SpinError) return NextResponse.json({ ok: false, code: err.code, error: err.message }, { status: STATUS[err.code] });
  console.error("[admin api]", err instanceof Error ? err.message : err);
  return NextResponse.json({ ok: false, error: fallback }, { status: 503 });
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  try {
    const v = await req.json();
    return v && typeof v === "object" ? (v as T) : null;
  } catch {
    return null;
  }
}

/** Escapes LIKE wildcards in user search text. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
