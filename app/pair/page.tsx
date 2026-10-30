"use client";

import { useState } from "react";
import { MonitorCheck } from "lucide-react";
import { ArenaBackdrop } from "@/components/layout/ArenaBackdrop";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { inputClass } from "@/components/admin/ui";

/** Open this page on the office TV and enter the code from Admin → Spin Management → Displays. */
export default function PairDisplayPage() {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/arena/device/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
        credentials: "same-origin",
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        setMsg({ ok: true, text: `This display is paired as "${json.label}". Opening the Live Arena…` });
        setTimeout(() => window.location.assign("/"), 1500);
      } else setMsg({ ok: false, text: json.error ?? "Pairing failed." });
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <ArenaBackdrop variant="console" />
      <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-white/[0.08] bg-[#0B1122]/85 p-8 text-center backdrop-blur-xl">
        <div className="mb-6 flex justify-center"><BrandLogo size={48} subtitle="Display pairing" /></div>
        <MonitorCheck className="mx-auto h-10 w-10 text-secondary" />
        <h1 className="mt-3 font-heading text-2xl font-extrabold text-white">Pair this display</h1>
        <p className="mt-1 text-sm text-text-muted">Enter the 8-character code shown in Admin → Spin Management → Displays.</p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={9}
          autoComplete="off"
          className={`${inputClass} mt-6 text-center font-heading text-2xl tracking-[0.3em]`}
          aria-label="Pairing code"
          data-testid="pair-code"
        />
        <button disabled={busy || code.replace(/\W/g, "").length !== 8} className="mt-5 w-full rounded-xl bg-primary px-4 py-3 font-semibold text-white disabled:opacity-50" data-testid="pair-submit">
          {busy ? "Pairing…" : "Pair display"}
        </button>
        {msg && <p role="status" className={`mt-4 text-sm ${msg.ok ? "text-emerald-300" : "text-rose-300"}`}>{msg.text}</p>}
      </form>
    </div>
  );
}
