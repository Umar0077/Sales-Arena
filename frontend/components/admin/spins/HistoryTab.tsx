"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi } from "@/frontend/components/admin/admin-api";
import { Section, Choice, GhostButton, PrimaryButton, inputClass } from "@/frontend/components/admin/ui";
import { FindMissingSpinsPanel } from "./ReconcileTab";
import { fmtDate, Notice, Table, td } from "./shared";

interface Tx {
  id: number;
  user_code: string;
  agent_name: string | null;
  kind: "automatic" | "manual" | "consume" | "expire";
  quantity: number;
  balance_before: number;
  balance_after: number;
  reason: string | null;
  rule_id: string | null;
  period_key: string | null;
  threshold_n: number | null;
  spin_result_id: string | null;
  reward_title?: string | null;
  created_at: string;
  admin_email: string | null;
}

interface SpinRow {
  id: string;
  user_code: string;
  agent_name: string | null;
  reward_title: string;
  reward_color: string;
  actor: string | null;
  created_at: string;
}

interface AuditRow {
  id: number;
  action: string;
  target_type: string;
  target_id: string;
  details: Record<string, unknown>;
  created_at: string;
  actor_label: string | null;
}

interface ExpireAuditRow {
  userCode: string;
  name: string;
  available: number;
  preCampaignAuto: number;
  preCampaignManual: number;
  campaignAuto: number;
  campaignManual: number;
  consumedTotal: number;
  expiredTotal: number;
  protectedNov27Credits: number;
  expirableCredits: number;
  ambiguous: boolean;
  note: string;
}

const KIND_STYLE: Record<Tx["kind"], string> = {
  automatic: "text-secondary",
  manual: "text-gold",
  consume: "text-rose-300",
  expire: "text-amber-300",
};

/**
 * Admin → Spin Management → Spin History:
 *  - Credit Ledger (manual, automatic, used, expired/adjusted, prize, approval info)
 *  - Spin Results (completed prizes)
 *  - Audit History
 *  - Find Missing Spins (per-agent missing spin approval)
 *  - Historical Credit Expiration (dry-run audit + explicit approval)
 */
export function HistoryTab({ initialUserCode = "" }: { initialUserCode?: string }) {
  const [view, setView] = useState<"ledger" | "spins" | "audit" | "missing" | "expire">("ledger");
  const [userCode, setUserCode] = useState(initialUserCode);
  const [tx, setTx] = useState<Tx[]>([]);
  const [spins, setSpins] = useState<SpinRow[]>([]);
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [expireRows, setExpireRows] = useState<ExpireAuditRow[]>([]);
  const [expireMeta, setExpireMeta] = useState<{ campaignStartAt: string; resetAt: string | null; totalAvailable: number; totalExpirable: number } | null>(null);
  const [selectedExpire, setSelectedExpire] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);

  const loadHistory = useCallback(async () => {
    if (view === "missing") return;
    if (view === "expire") {
      const r = await adminApi<{ campaignStartAt: string; resetAt: string | null; totalAvailable: number; totalExpirable: number; rows: ExpireAuditRow[] }>("/api/admin/spins/expire");
      if (r.ok) {
        setExpireRows(r.data.rows);
        setExpireMeta({ campaignStartAt: r.data.campaignStartAt, resetAt: r.data.resetAt, totalAvailable: r.data.totalAvailable, totalExpirable: r.data.totalExpirable });
        setSelectedExpire(new Set());
        setMsg(null);
      } else setMsg({ kind: "error", text: r.error });
      return;
    }
    const qs = `type=${view}&limit=300${userCode.trim() ? `&userCode=${encodeURIComponent(userCode.trim())}` : ""}`;
    const r = await adminApi<{ transactions?: Tx[]; spins?: SpinRow[]; audits?: AuditRow[] }>(`/api/admin/spins/history?${qs}`);
    if (!r.ok) return setMsg({ kind: "error", text: r.error });
    setMsg(null);
    if (view === "ledger") setTx(r.data.transactions ?? []);
    else if (view === "spins") setSpins(r.data.spins ?? []);
    else if (view === "audit") setAudits(r.data.audits ?? []);
  }, [view, userCode]);

  useEffect(() => {
    const t = setTimeout(() => void loadHistory(), 150);
    return () => clearTimeout(t);
  }, [loadHistory]);

  const toggleExpire = (uc: string) =>
    setSelectedExpire((prev) => {
      const next = new Set(prev);
      next.has(uc) ? next.delete(uc) : next.add(uc);
      return next;
    });

  const approveExpiration = async () => {
    if (selectedExpire.size === 0) return;
    if (!confirm(`Expire unused pre-campaign spin credits for ${selectedExpire.size} agent(s)? Completed prizes and Nov 27+ credits are preserved.`)) return;
    setBusy(true);
    const r = await adminApi<{ expired: Array<{ userCode: string; expiredCount: number }> }>("/api/admin/spins/expire", {
      method: "POST",
      body: { dryRun: false, userCodes: Array.from(selectedExpire) },
    });
    setBusy(false);
    if (r.ok) {
      const total = r.data.expired.reduce((s, e) => s + e.expiredCount, 0);
      setMsg({ kind: "ok", text: `Expired ${total} unused pre-campaign spin credit(s) across ${r.data.expired.length} agent(s).` });
      void loadHistory();
    } else setMsg({ kind: "error", text: r.error });
  };

  const executeFreshReset = async () => {
    if (!expireMeta || expireMeta.totalAvailable === 0) return;
    if (!confirm(`Execute ONE-TIME Fresh Campaign Reset? This expires all ${expireMeta.totalAvailable} currently available spin credit(s) to 0 so the Nov 27 campaign starts clean. Completed prizes, sales, and cash bonuses are untouched.`)) return;
    setBusy(true);
    const r = await adminApi<{ alreadyExecuted: boolean; expired: Array<{ userCode: string; expiredCount: number }> }>("/api/admin/spins/expire", {
      method: "POST",
      body: { dryRun: false, mode: "fresh_campaign_reset", resetMarker: "nov27_fresh_reset_v1" },
    });
    setBusy(false);
    if (r.ok) {
      if (r.data.alreadyExecuted) {
        setMsg({ kind: "info", text: "One-time fresh campaign reset was already executed (idempotent no-op)." });
      } else {
        const total = r.data.expired.reduce((s, e) => s + e.expiredCount, 0);
        setMsg({ kind: "ok", text: `Fresh campaign reset complete: expired ${total} spin credit(s) across ${r.data.expired.length} agent(s). Use Find Missing Spins to grant Nov 27 entitlements.` });
      }
      void loadHistory();
    } else setMsg({ kind: "error", text: r.error });
  };

  return (
    <div className="space-y-6">
      <Section title="Spin History" description="Complete immutable spin ledger, prize results, audit trail, missing spin finder, and pre-campaign credit expiration.">
        <div className="flex flex-wrap items-end gap-3">
          <Choice
            label="Section"
            value={view}
            options={[
              { value: "ledger", label: "Credit Ledger" },
              { value: "spins", label: "Spin Results" },
              { value: "audit", label: "Audit History" },
              { value: "missing", label: "Find Missing Spins" },
              { value: "expire", label: "Historical Reset" },
            ]}
            onChange={setView}
          />
          {view !== "missing" && view !== "expire" && (
            <>
              <input value={userCode} onChange={(e) => setUserCode(e.target.value)} placeholder="Filter by userCode" className={`${inputClass} max-w-[220px]`} aria-label="Filter by userCode" />
              {userCode && <GhostButton onClick={() => setUserCode("")}>Clear filter</GhostButton>}
            </>
          )}
        </div>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

        {view === "ledger" && (
          <Table head={["#", "When", "Agent", "Source / Type", "Spins", "Balance", "Prize / Approval / Details"]} empty={!tx.length} testId="ledger">
            {tx.map((t) => (
              <tr key={t.id}>
                <td className={`${td} text-text-muted tabular`}>{t.id}</td>
                <td className={td}>{fmtDate(t.created_at)}</td>
                <td className={td}>
                  <span className="text-white">{t.agent_name ?? t.user_code}</span>
                  <span className="block text-xs text-text-muted tabular">{t.user_code}</span>
                </td>
                <td className={`${td} font-semibold capitalize ${KIND_STYLE[t.kind]}`}>
                  {t.kind === "consume" ? "spin used" : t.kind === "expire" ? "expired" : t.kind}
                </td>
                <td className={`${td} font-semibold tabular`}>{t.quantity > 0 ? `+${t.quantity}` : t.quantity}</td>
                <td className={`${td} tabular`}>{t.balance_before} → {t.balance_after}</td>
                <td className={`${td} text-text-secondary`}>
                  {t.kind === "manual" && <>“{t.reason}” — Approved by {t.admin_email ?? "admin"}</>}
                  {t.kind === "automatic" && <>Rule {t.rule_id}, {t.period_key}, threshold #{t.threshold_n}{t.admin_email ? ` · Approved by ${t.admin_email}` : ""}</>}
                  {t.kind === "consume" && <>{t.reward_title ? <span className="text-gold font-semibold">{t.reward_title}</span> : "Spin"} · {t.spin_result_id?.slice(0, 14)}</>}
                  {t.kind === "expire" && <>“{t.reason}” — {t.admin_email ?? "admin"}</>}
                </td>
              </tr>
            ))}
          </Table>
        )}

        {view === "spins" && (
          <Table head={["When", "Agent", "Prize Awarded", "Run by"]} empty={!spins.length} testId="spin-results">
            {spins.map((s) => (
              <tr key={s.id}>
                <td className={td}>{fmtDate(s.created_at)}</td>
                <td className={td}>
                  <span className="text-white">{s.agent_name ?? s.user_code}</span>
                  <span className="block text-xs text-text-muted tabular">{s.user_code}</span>
                </td>
                <td className={td}>
                  <span className="inline-flex items-center gap-2 font-medium text-white">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.reward_color }} />
                    {s.reward_title}
                  </span>
                </td>
                <td className={`${td} text-text-muted`}>{s.actor ?? "—"}</td>
              </tr>
            ))}
          </Table>
        )}

        {view === "audit" && (
          <Table head={["When", "Action", "Target", "Actor", "Details"]} empty={!audits.length} testId="spin-audits">
            {audits.map((a) => (
              <tr key={a.id}>
                <td className={td}>{fmtDate(a.created_at)}</td>
                <td className={`${td} font-mono text-xs text-secondary`}>{a.action}</td>
                <td className={`${td} tabular text-white`}>{a.target_id}</td>
                <td className={td}>{a.actor_label ?? "system"}</td>
                <td className={`${td} max-w-md truncate font-mono text-xs text-text-muted`}>{JSON.stringify(a.details)}</td>
              </tr>
            ))}
          </Table>
        )}

        {view === "expire" && (
          <div className="space-y-4">
            {expireMeta && (
              <Notice kind="info">
                Campaign start: <b>{fmtDate(expireMeta.campaignStartAt)}</b> · Currently available credits across all agents: <b>{expireMeta.totalAvailable}</b> · Fresh reset status:{" "}
                <b>{expireMeta.resetAt ? `Executed at ${fmtDate(expireMeta.resetAt)}` : "Not yet executed"}</b>.
              </Notice>
            )}
            <div className="flex flex-wrap gap-2">
              {expireMeta && !expireMeta.resetAt && expireMeta.totalAvailable > 0 && (
                <PrimaryButton disabled={busy} onClick={executeFreshReset} data-testid="fresh-campaign-reset-btn">
                  {busy ? "Resetting…" : `Execute One-Time Fresh Campaign Reset (${expireMeta.totalAvailable} credits → 0)`}
                </PrimaryButton>
              )}
              {expireRows.some((r) => r.expirableCredits > 0) && (
                <>
                  <GhostButton
                    onClick={() => {
                      const eligible = expireRows.filter((r) => r.expirableCredits > 0).map((r) => r.userCode);
                      setSelectedExpire((prev) => (prev.size === eligible.length ? new Set() : new Set(eligible)));
                    }}
                  >
                    Toggle all pre-Nov27 expirable
                  </GhostButton>
                  <GhostButton disabled={busy || selectedExpire.size === 0} onClick={approveExpiration}>
                    {busy ? "Expiring…" : `Expire Selected Pre-Nov27 Only (${selectedExpire.size})`}
                  </GhostButton>
                </>
              )}
            </div>
            <Table
              head={["", "Agent", "Available", "Pre-Nov27 (Auto/Manual)", "Nov27+ (Auto/Manual)", "Used", "Protected", "Expirable", "Notes"]}
              empty={!expireRows.length}
              testId="expire-table"
            >
              {expireRows.map((r) => (
                <tr key={r.userCode}>
                  <td className={td}>
                    {r.expirableCredits > 0 && (
                      <input type="checkbox" checked={selectedExpire.has(r.userCode)} onChange={() => toggleExpire(r.userCode)} className="h-4 w-4 accent-[#7568FF]" aria-label={`Expire ${r.name}`} />
                    )}
                  </td>
                  <td className={td}>
                    <span className="font-medium text-white">{r.name}</span>
                    <span className="block text-xs text-text-muted tabular">{r.userCode}</span>
                  </td>
                  <td className={`${td} tabular font-bold text-gold`}>{r.available}</td>
                  <td className={`${td} tabular`}>{r.preCampaignAuto} / {r.preCampaignManual}</td>
                  <td className={`${td} tabular`}>{r.campaignAuto} / {r.campaignManual}</td>
                  <td className={`${td} tabular`}>{r.consumedTotal}</td>
                  <td className={`${td} tabular text-emerald-300`}>{r.protectedNov27Credits}</td>
                  <td className={`${td} tabular font-bold ${r.expirableCredits > 0 ? "text-amber-300" : "text-text-muted"}`}>{r.expirableCredits}</td>
                  <td className={`${td} text-xs text-text-secondary`}>{r.note}</td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </Section>

      {view === "missing" && <FindMissingSpinsPanel onAllocated={() => void loadHistory()} />}
    </div>
  );
}
