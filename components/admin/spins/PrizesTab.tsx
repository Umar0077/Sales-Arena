"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi } from "@/components/admin/admin-api";
import { RewardIconView } from "@/components/brand/RewardIconView";
import { Section, Field, Toggle, SelectField, PrimaryButton, GhostButton, inputClass } from "@/components/admin/ui";
import { Notice, Table, td } from "./shared";
import type { RewardIcon } from "@/types";

interface Prize {
  id: string;
  title: string;
  description: string;
  icon: RewardIcon;
  color: string;
  active: boolean;
  quantity: number | null;
  weight: string;
  display_order: number;
  times_won: number;
}
const ICONS: RewardIcon[] = ["trophy", "gift", "package", "headphones", "badge", "sparkles", "coffee", "ticket", "star", "crown", "rocket", "medal"];
const blank = { id: "", title: "", description: "", icon: "gift" as RewardIcon, color: "#FFC857", active: true, quantity: "", weight: "1", displayOrder: 0 };

export function PrizesTab() {
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [form, setForm] = useState(blank);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await adminApi<{ prizes: Prize[] }>("/api/admin/catalog");
    if (r.ok) setPrizes(r.data.prizes);
    else setMsg({ kind: "error", text: r.error });
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const save = async () => {
    setBusy(true);
    const body = {
      title: form.title,
      description: form.description,
      icon: form.icon,
      color: form.color,
      active: form.active,
      quantity: form.quantity === "" ? null : Number(form.quantity),
      weight: Number(form.weight),
      displayOrder: Number(form.displayOrder),
    };
    const r = form.id
      ? await adminApi(`/api/admin/catalog/${form.id}`, { method: "PATCH", body })
      : await adminApi("/api/admin/catalog", { method: "POST", body });
    setBusy(false);
    setMsg(r.ok ? { kind: "ok", text: form.id ? "Prize updated." : "Prize added to the wheel." } : { kind: "error", text: r.error });
    if (r.ok) {
      setForm(blank);
      void load();
    }
  };

  const remove = async (p: Prize) => {
    if (!confirm(`Remove "${p.title}"? Prizes already won are kept in history (the prize is deactivated instead).`)) return;
    const r = await adminApi<{ outcome: string }>(`/api/admin/catalog/${p.id}`, { method: "DELETE" });
    setMsg(r.ok ? { kind: "ok", text: r.data.outcome === "deleted" ? "Prize deleted." : "Prize deactivated (it has spin history)." } : { kind: "error", text: r.error });
    void load();
  };

  const active = prizes.filter((p) => p.active);
  return (
    <div className="space-y-6">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {active.length < 2 && <Notice kind="info">The wheel needs at least 2 active prizes before spins can run. ({active.length} active)</Notice>}
      <Section title="Eligible spin prizes" description="Stored in PostgreSQL. The server picks prizes by weight; prizes with stock 0 drop off the wheel.">
        <Table head={["", "Prize", "Stock", "Weight", "Order", "Won", "Status", ""]} empty={!prizes.length} testId="prizes">
          {prizes.map((p) => (
            <tr key={p.id}>
              <td className={td}>
                <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: `${p.color}33`, color: p.color }}>
                  <RewardIconView icon={p.icon} className="h-4 w-4" />
                </span>
              </td>
              <td className={td}>
                <span className="font-medium text-white">{p.title}</span>
                <span className="block text-xs text-text-muted">{p.description}</span>
              </td>
              <td className={`${td} tabular`}>{p.quantity === null ? "Unlimited" : p.quantity}</td>
              <td className={`${td} tabular`}>{Number(p.weight)}</td>
              <td className={`${td} tabular`}>{p.display_order}</td>
              <td className={`${td} tabular`}>{p.times_won}</td>
              <td className={td}>{p.active ? <span className="text-emerald-300">On wheel</span> : <span className="text-text-muted">Inactive</span>}</td>
              <td className={`${td} whitespace-nowrap`}>
                <button
                  className="mr-3 text-xs font-semibold text-secondary hover:underline"
                  onClick={() =>
                    setForm({ id: p.id, title: p.title, description: p.description, icon: p.icon, color: p.color, active: p.active, quantity: p.quantity === null ? "" : String(p.quantity), weight: String(Number(p.weight)), displayOrder: p.display_order })
                  }
                >
                  Edit
                </button>
                <button className="text-xs font-semibold text-rose-300 hover:underline" onClick={() => remove(p)}>Remove</button>
              </td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title={form.id ? "Edit prize" : "Add a prize"}>
        <Field label="Title"><input value={form.title} maxLength={40} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputClass} data-testid="prize-title" /></Field>
        <Field label="Description"><input value={form.description} maxLength={200} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} /></Field>
        <SelectField label="Icon" value={form.icon} options={ICONS.map((i) => ({ value: i, label: i }))} onChange={(v) => setForm({ ...form, icon: v })} />
        <Field label="Colour">
          <div className="flex items-center gap-3">
            <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-10 w-14 rounded-lg border border-white/10 bg-transparent" aria-label="Colour" />
            <span className="text-sm text-text-secondary tabular">{form.color.toUpperCase()}</span>
          </div>
        </Field>
        <Field label="Stock" hint="Empty = unlimited."><input type="number" min={0} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className={`${inputClass} w-32`} /></Field>
        <Field label="Weight" hint="Relative chance. 2 is twice as likely as 1."><input type="number" min={0.01} step={0.01} value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} className={`${inputClass} w-32`} /></Field>
        <Field label="Wheel order"><input type="number" min={0} value={form.displayOrder} onChange={(e) => setForm({ ...form, displayOrder: Number(e.target.value) })} className={`${inputClass} w-32`} /></Field>
        <Toggle label="On the wheel" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />
        <div className="flex gap-2">
          <PrimaryButton disabled={busy || form.title.trim().length < 2} onClick={save} data-testid="prize-save">{form.id ? "Save changes" : "Add prize"}</PrimaryButton>
          {form.id && <GhostButton onClick={() => setForm(blank)}>Cancel</GhostButton>}
        </div>
      </Section>
    </div>
  );
}
