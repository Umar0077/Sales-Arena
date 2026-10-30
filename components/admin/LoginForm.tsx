"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Lock, Mail, LogIn, ShieldCheck } from "lucide-react";
import { ArenaBackdrop } from "@/components/layout/ArenaBackdrop";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { PoweredBy } from "@/components/brand/PoweredBy";
import { inputClass } from "@/components/admin/ui";

export function LoginForm({ next, dbConfigured }: { next: string; dbConfigured: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(dbConfigured ? null : "Sign-in is unavailable: the database is not configured on this server.");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "same-origin",
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Sign-in failed. Please try again.");
        setPassword("");
        setBusy(false);
        return;
      }
      setPassword("");
      router.replace(next);
      router.refresh();
    } catch {
      setError("Network error. Check the connection and try again.");
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center px-4 py-16">
      <ArenaBackdrop variant="console" />
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md rounded-3xl border border-white/[0.08] bg-[#0B1122]/85 p-8 shadow-[0_30px_80px_-30px_rgba(117,104,255,0.55)] backdrop-blur-xl"
        aria-labelledby="login-title"
        noValidate
      >
        <div className="mb-8 flex justify-center">
          <BrandLogo size={52} subtitle="Admin Panel" />
        </div>
        <h1 id="login-title" className="text-center font-heading text-2xl font-extrabold text-white">Administrator sign in</h1>
        <p className="mt-1 text-center text-sm text-text-muted">Use your FE Sales Arena admin account.</p>

        <div className="mt-7 space-y-4">
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-white"><Mail className="h-4 w-4 text-text-muted" /> Email</span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              disabled={!dbConfigured}
              data-testid="login-email"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-white"><Lock className="h-4 w-4 text-text-muted" /> Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              disabled={!dbConfigured}
              data-testid="login-password"
            />
          </label>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-200" data-testid="login-error">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !dbConfigured || !email || !password}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-[#8B5CFF] px-4 py-3 font-heading text-sm font-bold text-white shadow-lg shadow-primary/30 transition-all hover:brightness-110 disabled:opacity-50"
          data-testid="login-submit"
        >
          <LogIn className="h-4 w-4" /> {busy ? "Signing in…" : "Sign in"}
        </button>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-text-muted">
          <ShieldCheck className="h-3.5 w-3.5" /> Accounts are created by a server administrator.
        </p>
      </motion.form>
      <PoweredBy />
    </div>
  );
}
