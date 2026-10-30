"use client";

import { cn } from "@/lib/utils";

export function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** "2026-10-29T14:30" (local) for <input type="datetime-local"> */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function newRequestKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function Notice({ kind, children }: { kind: "ok" | "error" | "info"; children: React.ReactNode }) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={cn(
        "rounded-xl border px-4 py-3 text-sm",
        kind === "ok" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
        kind === "error" && "border-rose-500/30 bg-rose-500/10 text-rose-200",
        kind === "info" && "border-secondary/30 bg-secondary/10 text-secondary",
      )}
    >
      {children}
    </div>
  );
}

export function Table({ head, children, empty, testId }: { head: string[]; children: React.ReactNode; empty?: boolean; testId?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.07]">
      <table className="w-full min-w-[720px] text-sm" data-testid={testId}>
        <thead className="bg-white/[0.04] text-left text-xs uppercase tracking-wider text-text-muted">
          <tr>
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-4 py-2.5 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.05]">
          {empty ? (
            <tr>
              <td colSpan={head.length} className="px-4 py-8 text-center text-text-muted">Nothing here yet.</td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

export const td = "px-4 py-2.5 align-top";
