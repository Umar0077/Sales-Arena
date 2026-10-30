"use client";

import { useCallback, useEffect, useState } from "react";
import { Gauge, Save } from "lucide-react";
import { adminApi } from "@/components/admin/admin-api";
import { Notice, fmtDate } from "@/components/admin/spins/shared";
import { cn } from "@/lib/utils";

type Mode = "auto" | "high" | "performance";
interface Saved {
  performanceMode: Mode;
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

const OPTIONS: Array<{ id: Mode; label: string; text: string }> = [
  { id: "auto", label: "Auto", text: "Each screen measures its own hardware and picks a suitable quality. Same policy everywhere; the result can differ per device." },
  { id: "high", label: "High Quality", text: "Full premium effects on every screen (reduced-motion settings and hardware limits are still respected)." },
  { id: "performance", label: "Performance", text: "Lightest rendering for low-end laptops: no blur, glows or background loops, lighter 3D, minimal idle CPU." },
];

/** Settings → Global Display Performance. Saved in PostgreSQL and pushed to every Live Arena screen. */
export function GlobalPerformanceCard() {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [choice, setChoice] = useState<Mode>("auto");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await adminApi<Saved>("/api/admin/display-settings");
    if (r.ok) {
      setSaved(r.data);
      setChoice(r.data.performanceMode);
    } else setMsg({ kind: "error", text: r.error });
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const r = await adminApi<Saved>("/api/admin/display-settings", { method: "PUT", body: { performanceMode: choice } });
    setBusy(false);
    if (!r.ok) {
      setMsg({ kind: "error", text: r.error });
      if (saved) setChoice(saved.performanceMode); // show what is actually saved
      return;
    }
    setSaved(r.data);
    setMsg({ kind: "ok", text: `Saved. All connected FE Sales Arena screens are switching to ${OPTIONS.find((o) => o.id === r.data.performanceMode)!.label}.` });
  };

  return (
    <section className="rounded-2xl border border-white/[0.07] bg-[#0D1426]/70 p-5 space-y-4" data-testid="global-performance">
      <div>
        <h2 className="flex items-center gap-2 font-heading text-lg font-bold text-white">
          <Gauge className="h-5 w-5 text-secondary" /> Global Display Performance
        </h2>
        <p className="mt-1 text-sm text-text-secondary">Changes to Global Performance Mode apply automatically to all connected FE Sales Arena screens.</p>
      </div>
      <div role="radiogroup" aria-label="Global performance mode" className="grid gap-3 md:grid-cols-3">
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={choice === o.id}
            onClick={() => setChoice(o.id)}
            className={cn(
              "rounded-xl border p-4 text-left transition-colors",
              choice === o.id ? "border-primary/60 bg-primary/15" : "border-white/10 bg-white/[0.02] hover:border-white/20",
            )}
          >
            <span className="flex items-center justify-between font-heading font-bold text-white">
              {o.label}
              {saved?.performanceMode === o.id && <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">CURRENT</span>}
            </span>
            <span className="mt-1 block text-xs text-text-muted">{o.text}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button
          onClick={save}
          disabled={busy || !saved || choice === saved.performanceMode}
          data-testid="global-performance-save"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
        >
          <Save className="h-4 w-4" /> {busy ? "Saving…" : "Save changes"}
        </button>
        <p className="text-xs text-text-muted" data-testid="global-performance-meta">
          {saved?.updatedAt ? `Last changed ${fmtDate(saved.updatedAt)} by ${saved.updatedBy ?? "an admin"} (revision ${saved.revision}).` : "Not changed yet (default: Auto)."}
        </p>
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
    </section>
  );
}
