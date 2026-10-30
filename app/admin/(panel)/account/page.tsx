"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LogOut } from "lucide-react";
import { adminApi } from "@/components/admin/admin-api";
import { Section, Field, PrimaryButton, GhostButton, inputClass } from "@/components/admin/ui";
import { Notice } from "@/components/admin/spins/shared";

export default function AccountPage() {
  const router = useRouter();
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.next !== form.confirm) return setMsg({ kind: "error", text: "The new passwords do not match." });
    setBusy(true);
    const r = await adminApi<{ otherSessionsRevoked: number }>("/api/admin/auth/password", {
      method: "POST",
      body: { currentPassword: form.current, newPassword: form.next },
    });
    setBusy(false);
    setForm({ current: "", next: "", confirm: "" });
    setMsg(
      r.ok
        ? { kind: "ok", text: `Password changed.${r.data.otherSessionsRevoked ? ` Signed out ${r.data.otherSessionsRevoked} other session(s).` : ""}` }
        : { kind: "error", text: r.error },
    );
  };

  const signOut = async () => {
    await adminApi("/api/admin/auth/logout", { method: "POST" });
    router.replace("/admin/login");
    router.refresh();
  };

  return (
    <div className="max-w-3xl space-y-6">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <Section title="Change password" description="At least 12 characters. Changing it signs out your other sessions.">
        <form onSubmit={change} className="space-y-5">
          <Field label="Current password">
            <input type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} className={inputClass} />
          </Field>
          <Field label="New password">
            <input type="password" autoComplete="new-password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} className={inputClass} />
          </Field>
          <Field label="Confirm new password">
            <input type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} className={inputClass} />
          </Field>
          <PrimaryButton type="submit" disabled={busy || !form.current || form.next.length < 12}>
            <KeyRound className="h-4 w-4" /> {busy ? "Saving…" : "Change password"}
          </PrimaryButton>
        </form>
      </Section>
      <Section title="Session" description="Sessions expire after 2 hours of inactivity and always after 12 hours.">
        <GhostButton onClick={signOut}>
          <LogOut className="h-4 w-4" /> Sign out
        </GhostButton>
      </Section>
    </div>
  );
}
