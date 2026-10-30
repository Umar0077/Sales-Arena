"use client";

import { useEffect, useState } from "react";
import { Search, CheckCircle2 } from "lucide-react";
import { adminApi } from "@/components/admin/admin-api";
import { Section, Field, PrimaryButton, GhostButton, inputClass } from "@/components/admin/ui";
import { newRequestKey, Notice } from "./shared";
import { cn } from "@/lib/utils";

export interface AgentRow {
  user_code: string;
  name: string;
  spin_eligible: boolean;
  available: number;
  auto_earned: number;
  manual_earned: number;
  consumed: number;
  last_spin_at: string | null;
  validated_sales: number;
  eligible_sales: number;
}

export function useAgentSearch(q: string) {
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await adminApi<{ agents: AgentRow[] }>(`/api/admin/spins/agents?q=${encodeURIComponent(q)}&limit=100`);
      if (r.ok) {
        setRows(r.data.agents);
        setError(null);
      } else setError(r.error);
    }, 250);
    return () => clearTimeout(t);
  }, [q, tick]);
  return { rows, error, reload: () => setTick((n) => n + 1) };
}

export function AllocateTab() {
  const [q, setQ] = useState("");
  const { rows, error, reload } = useAgentSearch(q);
  const [agent, setAgent] = useState<AgentRow | null>(null);
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("");
  const [review, setReview] = useState<{ key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const valid = agent && Number.isInteger(qty) && qty >= 1 && reason.trim().length >= 3;

  const confirm = async () => {
    if (!agent || !review) return;
    setBusy(true);
    const r = await adminApi<{ balanceBefore: number; balanceAfter: number; replayed: boolean }>("/api/admin/spins/allocate", {
      method: "POST",
      body: { userCode: agent.user_code, quantity: qty, reason: reason.trim(), idempotencyKey: review.key },
    });
    setBusy(false);
    if (r.ok) {
      setMsg({ kind: "ok", text: `${qty} spin${qty > 1 ? "s" : ""} granted to ${agent.name}. Balance ${r.data.balanceBefore} → ${r.data.balanceAfter}.` });
      setAgent({ ...agent, available: r.data.balanceAfter, manual_earned: agent.manual_earned + (r.data.replayed ? 0 : qty) });
      setReview(null);
      setReason("");
      setQty(1);
      reload();
    } else setMsg({ kind: "error", text: r.error }); // keep the same key so a retry can't double-grant
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Section title="1. Find the agent" description="Search by name or Safe Quote userCode.">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or userCode" className={`${inputClass} pl-9`} data-testid="alloc-search" aria-label="Search agents" />
        </label>
        {error && <Notice kind="error">{error}</Notice>}
        <ul className="max-h-[420px] divide-y divide-white/[0.05] overflow-y-auto rounded-xl border border-white/[0.07]">
          {rows.length === 0 && <li className="px-4 py-6 text-center text-sm text-text-muted">No agents found. Agents appear once their sales are synced.</li>}
          {rows.map((a) => (
            <li key={a.user_code}>
              <button
                onClick={() => {
                  setAgent(a);
                  setReview(null);
                  setMsg(null);
                }}
                className={cn("flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-white/[0.04]", agent?.user_code === a.user_code && "bg-primary/10")}
                data-testid={`alloc-agent-${a.user_code}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-white">{a.name}</span>
                  <span className="text-xs text-text-muted tabular">{a.user_code}</span>
                </span>
                <span className="text-sm text-text-secondary tabular">{a.available} available</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="2. Allocate spins" description="Every allocation is recorded with your account, the reason and the balance before and after.">
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
        {!agent ? (
          <p className="text-sm text-text-muted">Select an agent first.</p>
        ) : (
          <>
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
              <div className="font-semibold text-white">{agent.name}</div>
              <div className="text-xs text-text-muted tabular">{agent.user_code} · {agent.available} spins available · {agent.validated_sales} validated sales</div>
            </div>
            <Field label="Spins to grant">
              <input type="number" min={1} value={qty} onChange={(e) => { setQty(Math.floor(Number(e.target.value))); setReview(null); }} className={`${inputClass} w-28`} data-testid="alloc-qty" />
            </Field>
            <Field label="Reason (required)" hint="Shown in the history and audit log.">
              <textarea value={reason} maxLength={500} rows={3} onChange={(e) => { setReason(e.target.value); setReview(null); }} className={inputClass} data-testid="alloc-reason" />
            </Field>
            {!review ? (
              <PrimaryButton disabled={!valid} onClick={() => setReview({ key: newRequestKey() })} data-testid="alloc-review">Review</PrimaryButton>
            ) : (
              <div className="space-y-3 rounded-xl border border-gold/30 bg-gold/[0.06] p-4" data-testid="alloc-preview">
                <p className="text-sm text-white">
                  Grant <b>{qty}</b> spin{qty > 1 ? "s" : ""} to <b>{agent.name}</b> ({agent.user_code}).
                </p>
                <p className="text-sm text-text-secondary">
                  Balance: <b className="text-white tabular">{agent.available}</b> → <b className="text-gold tabular">{agent.available + qty}</b>
                </p>
                <p className="text-sm text-text-secondary">Reason: “{reason.trim()}”</p>
                <div className="flex gap-2">
                  <PrimaryButton disabled={busy} onClick={confirm} data-testid="alloc-confirm">
                    <CheckCircle2 className="h-4 w-4" /> {busy ? "Saving…" : "Confirm allocation"}
                  </PrimaryButton>
                  <GhostButton disabled={busy} onClick={() => setReview(null)}>Back</GhostButton>
                </div>
              </div>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
