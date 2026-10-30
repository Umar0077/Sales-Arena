"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/components/admin/admin-api";
import { Section, Choice, GhostButton, inputClass } from "@/components/admin/ui";
import { fmtDate, Notice, Table, td } from "./shared";

interface Tx {
  id: number;
  user_code: string;
  agent_name: string | null;
  kind: "automatic" | "manual" | "consume";
  quantity: number;
  balance_before: number;
  balance_after: number;
  reason: string | null;
  rule_id: string | null;
  period_key: string | null;
  threshold_n: number | null;
  spin_result_id: string | null;
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

const KIND_STYLE = { automatic: "text-secondary", manual: "text-gold", consume: "text-rose-300" } as const;

export function HistoryTab({ initialUserCode = "" }: { initialUserCode?: string }) {
  const [type, setType] = useState<"ledger" | "spins">("ledger");
  const [userCode, setUserCode] = useState(initialUserCode);
  const [tx, setTx] = useState<Tx[]>([]);
  const [spins, setSpins] = useState<SpinRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const qs = `type=${type}&limit=300${userCode.trim() ? `&userCode=${encodeURIComponent(userCode.trim())}` : ""}`;
      const r = await adminApi<{ transactions?: Tx[]; spins?: SpinRow[] }>(`/api/admin/spins/history?${qs}`);
      if (!alive) return;
      if (!r.ok) return setError(r.error);
      setError(null);
      if (type === "ledger") setTx(r.data.transactions ?? []);
      else setSpins(r.data.spins ?? []);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [type, userCode]);

  return (
    <Section title="Spin credit history" description="Immutable ledger: every grant and every spin, with the balance before and after.">
      <div className="flex flex-wrap items-end gap-3">
        <Choice label="Show" value={type} options={[{ value: "ledger", label: "Credit ledger" }, { value: "spins", label: "Spin results" }]} onChange={setType} />
        <input value={userCode} onChange={(e) => setUserCode(e.target.value)} placeholder="Filter by userCode" className={`${inputClass} max-w-[220px]`} aria-label="Filter by userCode" />
        {userCode && <GhostButton onClick={() => setUserCode("")}>Clear filter</GhostButton>}
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {type === "ledger" ? (
        <Table head={["#", "When", "Agent", "Type", "Spins", "Balance", "Details"]} empty={!tx.length} testId="ledger">
          {tx.map((t) => (
            <tr key={t.id}>
              <td className={`${td} text-text-muted tabular`}>{t.id}</td>
              <td className={td}>{fmtDate(t.created_at)}</td>
              <td className={td}>
                <span className="text-white">{t.agent_name ?? t.user_code}</span>
                <span className="block text-xs text-text-muted tabular">{t.user_code}</span>
              </td>
              <td className={`${td} font-semibold capitalize ${KIND_STYLE[t.kind]}`}>{t.kind === "consume" ? "spin used" : t.kind}</td>
              <td className={`${td} font-semibold tabular`}>{t.quantity > 0 ? `+${t.quantity}` : t.quantity}</td>
              <td className={`${td} tabular`}>{t.balance_before} → {t.balance_after}</td>
              <td className={`${td} text-text-secondary`}>
                {t.kind === "manual" && <>“{t.reason}” — {t.admin_email ?? "admin"}</>}
                {t.kind === "automatic" && <>Rule {t.rule_id}, {t.period_key}, threshold #{t.threshold_n}</>}
                {t.kind === "consume" && <>Spin {t.spin_result_id?.slice(0, 13)}…</>}
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <Table head={["When", "Agent", "Prize", "Run by"]} empty={!spins.length} testId="spin-results">
          {spins.map((s) => (
            <tr key={s.id}>
              <td className={td}>{fmtDate(s.created_at)}</td>
              <td className={td}>
                <span className="text-white">{s.agent_name ?? s.user_code}</span>
                <span className="block text-xs text-text-muted tabular">{s.user_code}</span>
              </td>
              <td className={td}>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.reward_color }} />
                  {s.reward_title}
                </span>
              </td>
              <td className={`${td} text-text-muted`}>{s.actor ?? "—"}</td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}
