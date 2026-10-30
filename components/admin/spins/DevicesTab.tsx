"use client";

import { useCallback, useEffect, useState } from "react";
import { MonitorCheck } from "lucide-react";
import { adminApi } from "@/components/admin/admin-api";
import { Section, Field, PrimaryButton, inputClass } from "@/components/admin/ui";
import { fmtDate, Notice, Table, td } from "./shared";

interface Device {
  id: string;
  label: string;
  paired_at: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
  awaiting_pairing: boolean;
  created_by_email: string | null;
}

export function DevicesTab() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [label, setLabel] = useState("");
  const [code, setCode] = useState<{ code: string; label: string } | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await adminApi<{ devices: Device[] }>("/api/admin/devices");
    if (r.ok) setDevices(r.data.devices);
    else setMsg({ kind: "error", text: r.error });
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const create = async () => {
    const r = await adminApi<{ code: string }>("/api/admin/devices", { method: "POST", body: { label } });
    if (r.ok) {
      setCode({ code: r.data.code, label });
      setLabel("");
      void load();
    } else setMsg({ kind: "error", text: r.error });
  };
  const revoke = async (d: Device) => {
    if (!confirm(`Revoke "${d.label}"? It will no longer be able to run spins.`)) return;
    const r = await adminApi(`/api/admin/devices/${d.id}`, { method: "DELETE" });
    setMsg(r.ok ? { kind: "ok", text: `"${d.label}" revoked.` } : { kind: "error", text: r.error });
    void load();
  };

  return (
    <div className="space-y-6">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <Section title="Pair a Live Arena display" description="Spins can only be run from a paired display (or by a signed-in admin). Pair each office TV once.">
        <Field label="Display name">
          <div className="flex gap-2">
            <input value={label} maxLength={64} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Floor TV 1" className={`${inputClass} max-w-xs`} />
            <PrimaryButton disabled={label.trim().length < 2} onClick={create}>Create pairing code</PrimaryButton>
          </div>
        </Field>
        {code && (
          <div className="rounded-xl border border-secondary/30 bg-secondary/10 p-4">
            <p className="flex items-center gap-2 text-sm text-white"><MonitorCheck className="h-4 w-4 text-secondary" /> On the TV for “{code.label}”, open <b>/pair</b> and enter:</p>
            <p className="mt-2 font-heading text-3xl font-extrabold tracking-[0.3em] text-secondary" data-testid="pairing-code">{code.code}</p>
            <p className="mt-1 text-xs text-text-muted">Valid for 10 minutes, once. It will not be shown again.</p>
          </div>
        )}
      </Section>
      <Section title="Displays">
        <Table head={["Display", "Status", "Paired", "Last seen", "Created by", ""]} empty={!devices.length}>
          {devices.map((d) => (
            <tr key={d.id}>
              <td className={`${td} font-medium text-white`}>{d.label}</td>
              <td className={td}>
                {d.revoked_at ? <span className="text-text-muted">Revoked</span> : d.paired_at ? <span className="text-emerald-300">Paired</span> : d.awaiting_pairing ? <span className="text-gold">Waiting for code</span> : <span className="text-text-muted">Code expired</span>}
              </td>
              <td className={td}>{fmtDate(d.paired_at)}</td>
              <td className={td}>{fmtDate(d.last_seen_at)}</td>
              <td className={td}>{d.created_by_email ?? "—"}</td>
              <td className={td}>{!d.revoked_at && <button onClick={() => revoke(d)} className="text-xs font-semibold text-rose-300 hover:underline">Revoke</button>}</td>
            </tr>
          ))}
        </Table>
      </Section>
    </div>
  );
}
